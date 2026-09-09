import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Pool } from 'pg';

import {
  prepareProviderMatchEvidenceBatchPersistence,
  runProviderMatchEvidencePersistence
} from '../src/postgres-provider-match-evidence-runtime.mjs';
import { prepareIngestionObservation } from '../src/postgres-ingestion-provenance.mjs';

const execFileAsync = promisify(execFile);
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const CAPTURED = '2026-09-10T12:00:00.000Z';
const KICKOFF = '2026-09-10T15:00:00.000Z';
const CUTOFF = '2026-09-10T14:45:00.000Z';

function fixtureRow(id, date, homeId, homeName, awayId, awayName, homeGoals, awayGoals, status = 'FT') {
  return {
    fixture: { id, date, status: { short: status } },
    league: { id: 39, season: 2026 },
    teams: {
      home: { id: homeId, name: homeName },
      away: { id: awayId, name: awayName }
    },
    goals: { home: homeGoals, away: awayGoals }
  };
}

function response(...rows) {
  return { errors: {}, response: rows };
}

function target() {
  return {
    eventId: 'API-FOOTBALL-RUNTIME-EVENT-1001',
    providerFixtureId: 1001,
    kickoffAt: KICKOFF,
    predictionCutoff: CUTOFF,
    homeTeamId: 10,
    homeTeam: 'HOME FC',
    awayTeamId: 20,
    awayTeam: 'AWAY FC'
  };
}

function rawPackage() {
  return {
    provider: 'API_FOOTBALL',
    acquiredAt: CAPTURED,
    events: [{
      providerFixtureId: 1001,
      targetFixture: response(
        fixtureRow(1001, KICKOFF, 10, 'HOME FC', 20, 'AWAY FC', null, null, 'NS')
      ),
      homeHistory: response(
        fixtureRow(901, '2026-09-01T15:00:00Z', 10, 'HOME FC', 30, 'OPP A', 2, 0),
        fixtureRow(902, '2026-08-25T15:00:00Z', 31, 'OPP B', 10, 'HOME FC', 1, 1)
      ),
      awayHistory: response(
        fixtureRow(911, '2026-09-02T15:00:00Z', 32, 'OPP C', 20, 'AWAY FC', 0, 2),
        fixtureRow(912, '2026-08-24T15:00:00Z', 20, 'AWAY FC', 33, 'OPP D', 1, 2)
      ),
      h2h: response(
        fixtureRow(921, '2026-08-01T15:00:00Z', 10, 'HOME FC', 20, 'AWAY FC', 1, 0)
      )
    }]
  };
}

async function buildEnvelope(directory, suffix, providerPackage) {
  const targetFile = path.join(directory, 'targets-' + suffix + '.json');
  const packageFile = path.join(directory, 'provider-' + suffix + '.json');
  const outputFile = path.join(directory, 'envelope-' + suffix + '.json');
  const script = fileURLToPath(
    new URL('../../../scripts/run_api_football_match_evidence_ingestion.py', import.meta.url)
  );
  await writeFile(targetFile, JSON.stringify({ targets: [target()] }));
  await writeFile(packageFile, JSON.stringify(providerPackage));
  await execFileAsync('python', [
    script,
    targetFile,
    outputFile,
    '--package-file',
    packageFile,
    '--captured-at',
    CAPTURED
  ]);
  return JSON.parse(await readFile(outputFile, 'utf8'));
}

test('API-Football prematch evidence maps into the existing immutable PostgreSQL runtime', {
  skip: !connectionString
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sports-api-football-evidence-'));
  const pool = new Pool({ connectionString });
  try {
    const envelope = await buildEnvelope(directory, 'original', rawPackage());
    assert.equal(envelope.runtimeVersion, 'API_FOOTBALL_PREMATCH_EVIDENCE_RUNTIME_V0_1');
    assert.equal(envelope.providerBatch.provider, 'API_FOOTBALL');
    assert.equal(envelope.providerBatch.sourceType, 'PROVIDER_API_REPLAY');
    assert.equal(envelope.providerBatch.verified, false);
    assert.equal(envelope.governance.offlineReplay, true);
    assert.equal(envelope.governance.packageAcquiredAtBoundToCapture, true);
    assert.equal(envelope.providerBatch.events[0].model, null);
    assert.equal(envelope.providerBatch.events[0].evidence.xG, null);
    assert.equal(envelope.providerBatch.events[0].evidence.lineups, null);
    assert.equal(envelope.governance.rawProviderPayloadPersisted, false);
    assert.equal(envelope.governance.capitalState, 'LOCKED');
    assert.equal(envelope.governance.realMoney, 'NO');
    assert.equal(JSON.stringify(envelope).includes('"errors"'), false);
    assert.equal(JSON.stringify(envelope).includes('"response"'), false);

    const forgedAuthenticatedSource = {
      ...envelope.providerBatch,
      sourceType: 'PROVIDER_API',
      verified: true
    };
    assert.throws(
      () => prepareProviderMatchEvidenceBatchPersistence({
        providerBatch: forgedAuthenticatedSource,
        timingByEvent: envelope.timingByEvent
      }),
      /API_FOOTBALL_ACQUISITION_ATTESTATION_REQUIRED/
    );

    const forgedVerifiedReplay = {
      ...envelope.providerBatch,
      verified: true,
      independentlyVerified: true
    };
    const forgedPrepared = prepareProviderMatchEvidenceBatchPersistence({
      providerBatch: forgedVerifiedReplay,
      timingByEvent: envelope.timingByEvent
    });
    const forcedReplayObservations = forgedPrepared.observations.map(prepareIngestionObservation);
    assert.ok(forcedReplayObservations.every((row) => row.isVerified === false));
    assert.ok(forcedReplayObservations.every((row) => row.preMatchEligible === false));

    const prepared = prepareProviderMatchEvidenceBatchPersistence({
      providerBatch: {
        ...envelope.providerBatch,
        events: [
          envelope.providerBatch.events[0],
          envelope.providerBatch.events[0]
        ]
      },
      timingByEvent: envelope.timingByEvent
    });
    assert.equal(prepared.duplicateReplayCount, 1);

    const first = await runProviderMatchEvidencePersistence({
      pool,
      providerBatch: forgedVerifiedReplay,
      timingByEvent: envelope.timingByEvent
    });
    assert.equal(first.status, 'DURABLY_ARCHIVED_AND_ATTESTED');
    assert.equal(first.persistedEventCount, 1);
    assert.equal(first.attestations[0].status, 'ATTESTED');
    assert.equal(first.attestations[0].exactFeatureSet, true);
    assert.equal(first.attestations[0].preMatchEligible, false);
    assert.ok(first.attestations[0].featureCount > 20);

    const replay = await runProviderMatchEvidencePersistence({
      pool,
      providerBatch: envelope.providerBatch,
      timingByEvent: envelope.timingByEvent
    });
    assert.equal(replay.batchFingerprint, first.batchFingerprint);
    assert.equal(replay.archive.bundleFingerprint, first.archive.bundleFingerprint);

    const eventId = target().eventId;
    const persisted = await pool.query(
      `SELECT source,payload_json,is_verified,pre_match_eligible,capital_state,real_money
         FROM reference_ingestion_observations_v01
        WHERE event_id=$1`,
      [eventId]
    );
    assert.equal(persisted.rowCount, 1);
    assert.match(persisted.rows[0].source, /^api-football:\/\/prematch-evidence\/1001\/bundle\/[0-9a-f]{64}$/);
    assert.equal(persisted.rows[0].is_verified, false);
    assert.equal(persisted.rows[0].pre_match_eligible, false);
    assert.equal(persisted.rows[0].capital_state, 'LOCKED');
    assert.equal(persisted.rows[0].real_money, 'NO');
    assert.equal(JSON.stringify(persisted.rows[0].payload_json).includes('targetFixture'), false);

    await assert.rejects(
      pool.query(
        `INSERT INTO reference_ingestion_observations_v01(
           provenance_id,observation_id,event_id,entity_type,entity_id,evidence_kind,provider,source,
           source_type,source_url,observed_at,available_at,captured_at,prediction_cutoff,is_verified,
           pre_match_eligible,source_payload_fingerprint,evidence_fingerprint,payload_json,persisted_at,
           capital_state,real_money
         )
         SELECT provenance_id || '-FORGED',observation_id || '-FORGED',event_id,entity_type,entity_id,
                evidence_kind,provider,source,'PROVIDER_API_REPLAY',source_url,observed_at,available_at,
                captured_at,prediction_cutoff,true,true,source_payload_fingerprint,evidence_fingerprint,
                jsonb_set(payload_json, '{snapshot,source,verified}', 'true'::jsonb),
                persisted_at,capital_state,real_money
           FROM reference_ingestion_observations_v01
          WHERE event_id=$1`,
        [eventId]
      ),
      (error) => error?.code === '23514' &&
        error?.constraint === 'reference_ingestion_replay_unverified_ck'
    );

    await assert.rejects(
      pool.query(
        `INSERT INTO reference_ingestion_observations_v01(
           provenance_id,observation_id,event_id,entity_type,entity_id,evidence_kind,provider,source,
           source_type,source_url,observed_at,available_at,captured_at,prediction_cutoff,is_verified,
           pre_match_eligible,source_payload_fingerprint,evidence_fingerprint,payload_json,persisted_at,
           capital_state,real_money
         )
         SELECT provenance_id || '-INDEPENDENT',observation_id || '-INDEPENDENT',event_id,entity_type,
                entity_id,evidence_kind,provider,source,'PROVIDER_API_REPLAY',source_url,observed_at,
                available_at,captured_at,prediction_cutoff,false,false,source_payload_fingerprint,
                evidence_fingerprint,
                jsonb_set(payload_json, '{snapshot,source,independently_verified}', 'true'::jsonb),
                persisted_at,capital_state,real_money
           FROM reference_ingestion_observations_v01
          WHERE event_id=$1`,
        [eventId]
      ),
      (error) => error?.code === '23514' &&
        error?.constraint === 'reference_ingestion_replay_unverified_ck'
    );

    await assert.rejects(
      pool.query(
        `INSERT INTO reference_ingestion_observations_v01(
           provenance_id,observation_id,event_id,entity_type,entity_id,evidence_kind,provider,source,
           source_type,source_url,observed_at,available_at,captured_at,prediction_cutoff,is_verified,
           pre_match_eligible,source_payload_fingerprint,evidence_fingerprint,payload_json,persisted_at,
           capital_state,real_money
         )
         SELECT provenance_id || '-MISSING-INDEPENDENT',observation_id || '-MISSING-INDEPENDENT',
                event_id,entity_type,entity_id,evidence_kind,provider,source,'PROVIDER_API_REPLAY',
                source_url,observed_at,available_at,captured_at,prediction_cutoff,false,false,
                source_payload_fingerprint,evidence_fingerprint,
                payload_json #- '{snapshot,source,independently_verified}',
                persisted_at,capital_state,real_money
           FROM reference_ingestion_observations_v01
          WHERE event_id=$1`,
        [eventId]
      ),
      (error) => error?.code === '23514' &&
        error?.constraint === 'reference_ingestion_replay_unverified_ck'
    );

    const constraintClient = await pool.connect();
    try {
      await constraintClient.query('SET session_replication_role=replica');
      await assert.rejects(
        constraintClient.query(
          `INSERT INTO reference_ingestion_observations_v01(
             provenance_id,observation_id,event_id,entity_type,entity_id,evidence_kind,provider,source,
             source_type,source_url,observed_at,available_at,captured_at,prediction_cutoff,is_verified,
             pre_match_eligible,source_payload_fingerprint,evidence_fingerprint,payload_json,persisted_at,
             capital_state,real_money
           )
           SELECT provenance_id || '-SELF-VERIFIED',observation_id || '-SELF-VERIFIED',event_id,
                  entity_type,entity_id,evidence_kind,provider,source,'PROVIDER_API_REPLAY',source_url,
                  observed_at,available_at,captured_at,prediction_cutoff,false,false,
                  source_payload_fingerprint,evidence_fingerprint,
                  jsonb_set(payload_json, '{snapshot,source,verified}', 'true'::jsonb),
                  persisted_at,capital_state,real_money
             FROM reference_ingestion_observations_v01
            WHERE event_id=$1`,
          [eventId]
        ),
        (error) => error?.code === '23514' &&
          error?.constraint === 'reference_ingestion_replay_unverified_ck'
      );
    } finally {
      await constraintClient.query('SET session_replication_role=origin');
      constraintClient.release();
    }

    const counts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM reference_ingestion_observations_v01 WHERE event_id=$1) observations,
         (SELECT count(*)::int FROM reference_feature_provenance_lineage_v01 WHERE event_id=$1) features`,
      [eventId]
    );
    assert.deepEqual(counts.rows[0], {
      observations: 1,
      features: first.attestations[0].featureCount
    });

    const changedPackage = rawPackage();
    changedPackage.events[0].homeHistory.response[0].goals.home = 3;
    const changed = await buildEnvelope(directory, 'changed', changedPackage);
    const originalEvent = envelope.providerBatch.events[0];
    const changedEvent = changed.providerBatch.events[0];
    assert.equal(changedEvent.evidenceSnapshotId, originalEvent.evidenceSnapshotId);
    assert.notEqual(changedEvent.providerSourceFingerprint, originalEvent.providerSourceFingerprint);
    assert.throws(
      () => prepareProviderMatchEvidenceBatchPersistence({
        providerBatch: {
          ...envelope.providerBatch,
          events: [originalEvent, changedEvent]
        },
        timingByEvent: envelope.timingByEvent
      }),
      /POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_BATCH_REJECTED:PROVIDER_EVIDENCE_IDENTITY_PAYLOAD_CONFLICT/
    );
  } finally {
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
