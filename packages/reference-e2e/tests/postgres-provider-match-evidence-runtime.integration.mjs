import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Pool } from 'pg';

import { CANONICAL_PROVIDER_MATCH_EVIDENCE_SCHEMA_VERSION } from '../../intelligence-engine/src/real-provider-match-evidence-ingestion.mjs';
import {
  attestProviderMatchEvidencePersistence,
  POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_VERSION,
  prepareProviderMatchEvidenceBatchPersistence,
  runProviderMatchEvidencePersistence
} from '../src/postgres-provider-match-evidence-runtime.mjs';

const execFileAsync = promisify(execFile);
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const CAPTURED = '2026-09-02T11:00:00.000Z';
const OBSERVED = '2026-09-02T10:55:00.000Z';
const AVAILABLE = '2026-09-02T10:56:00.000Z';
const CUTOFF = '2026-09-02T11:30:00.000Z';
const KICKOFF = '2026-09-02T12:00:00.000Z';

function historicalMatch(id, goalsFor = 1, goalsAgainst = 0) {
  return {
    matchId: id,
    playedAt: '2026-08-24T12:00:00.000Z',
    goalsFor,
    goalsAgainst,
    opponentStrength: 0.5
  };
}

function providerEvent(suffix, overrides = {}) {
  return {
    schemaVersion: CANONICAL_PROVIDER_MATCH_EVIDENCE_SCHEMA_VERSION,
    eventId: 'RUNTIME-EVENT-' + suffix,
    providerEventId: 'RUNTIME-PROVIDER-EVENT-' + suffix,
    evidenceSnapshotId: 'RUNTIME-EVIDENCE-SNAPSHOT-' + suffix,
    kickoffAt: KICKOFF,
    homeTeam: 'HOME FC',
    awayTeam: 'AWAY FC',
    sourceReference: 'provider://runtime/event/' + suffix,
    evidence: {},
    model: null,
    ...overrides
  };
}

function providerBatch(suffix, events) {
  return {
    batchId: 'RUNTIME-BATCH-' + suffix,
    provider: 'STATS_PROVIDER_RUNTIME',
    sourceType: 'PROVIDER_API',
    sourceReference: 'provider://runtime/batch/' + suffix,
    capturedAt: CAPTURED,
    verified: true,
    events
  };
}

function timingByEvent(events) {
  return Object.fromEntries(events.map((event) => [event.eventId, {
    observedAt: OBSERVED,
    availableAt: AVAILABLE,
    predictionCutoff: CUTOFF
  }]));
}

test('batch preparation is deterministic, deduplicates exact replay, and preserves governance', () => {
  const event = providerEvent('PREPARE');
  const input = {
    providerBatch: providerBatch('PREPARE', [event, event]),
    timingByEvent: timingByEvent([event])
  };
  const first = prepareProviderMatchEvidenceBatchPersistence(input);
  const second = prepareProviderMatchEvidenceBatchPersistence(input);
  assert.deepEqual(first, second);
  assert.equal(first.version, POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_VERSION);
  assert.equal(first.eventsReceived, 2);
  assert.equal(first.uniqueEventCount, 1);
  assert.equal(first.duplicateReplayCount, 1);
  assert.equal(first.observations.length, 1);
  assert.ok(first.featureLineage.length > 20);
  assert.equal(first.governance.strictBatch, true);
  assert.equal(first.governance.p002Unchanged, true);
  assert.equal(first.governance.capitalState, 'LOCKED');
  assert.equal(first.governance.realMoney, 'NO');
  assert.equal(Object.isFrozen(first), true);
});

test('strict batch rejects invalid events, empty batches, and non-exact timing before persistence', () => {
  const good = providerEvent('STRICT-GOOD');
  const bad = providerEvent('STRICT-BAD', { provider: 'DIFFERENT_PROVIDER' });
  assert.throws(
    () => prepareProviderMatchEvidenceBatchPersistence({
      providerBatch: providerBatch('STRICT', [good, bad]),
      timingByEvent: timingByEvent([good, bad])
    }),
    /POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_BATCH_REJECTED:EVENT_PROVIDER_MISMATCH/
  );
  assert.throws(
    () => prepareProviderMatchEvidenceBatchPersistence({
      providerBatch: providerBatch('EMPTY', []),
      timingByEvent: {}
    }),
    /POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_EMPTY_BATCH/
  );
  assert.throws(
    () => prepareProviderMatchEvidenceBatchPersistence({
      providerBatch: providerBatch('MISSING-TIMING', [good]),
      timingByEvent: {}
    }),
    /POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_TIMING_SET_NOT_EXACT/
  );
  assert.throws(
    () => prepareProviderMatchEvidenceBatchPersistence({
      providerBatch: providerBatch('EXTRA-TIMING', [good]),
      timingByEvent: {
        ...timingByEvent([good]),
        'RUNTIME-EVENT-NOT-IN-BATCH': {
          observedAt: OBSERVED,
          availableAt: AVAILABLE,
          predictionCutoff: CUTOFF
        }
      }
    }),
    /POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_TIMING_SET_NOT_EXACT/
  );
});

test('runtime persists and attests a multi-event batch using one dedicated PoolClient', {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  const events = [providerEvent('MULTI-A'), providerEvent('MULTI-B')];
  let connectCount = 0;
  let releaseCount = 0;
  const guardedPool = {
    async connect() {
      connectCount += 1;
      const client = await pool.connect();
      return {
        query: (...args) => client.query(...args),
        release() {
          releaseCount += 1;
          client.release();
        }
      };
    }
  };
  try {
    const input = {
      pool: guardedPool,
      providerBatch: providerBatch('MULTI', events),
      timingByEvent: timingByEvent(events)
    };
    const first = await runProviderMatchEvidencePersistence(input);
    assert.equal(first.status, 'DURABLY_ARCHIVED_AND_ATTESTED');
    assert.equal(first.persistedEventCount, 2);
    assert.equal(first.attestations.length, 2);
    assert.equal(first.attestations.every((row) => row.status === 'ATTESTED'), true);
    assert.equal(first.attestations.every((row) => row.archivedFingerprintsRecomputed), true);
    assert.equal(first.attestations.every((row) => row.providerPayloadFingerprintRecomputed === false), true);
    assert.equal(first.attestations.every((row) => row.exactFeatureSet), true);
    assert.equal(first.operational.oneDedicatedPoolClient, true);
    assert.equal(first.operational.rawProviderPayloadReturned, false);
    assert.equal(JSON.stringify(first).includes('"snapshot"'), false);
    assert.equal(connectCount, 1);
    assert.equal(releaseCount, 1);

    const replay = await runProviderMatchEvidencePersistence({
      pool,
      providerBatch: input.providerBatch,
      timingByEvent: input.timingByEvent
    });
    assert.equal(replay.batchFingerprint, first.batchFingerprint);
    assert.equal(replay.archive.bundleFingerprint, first.archive.bundleFingerprint);

    const counts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM reference_ingestion_observations_v01 WHERE event_id=ANY($1)) observations,
         (SELECT count(*)::int FROM reference_feature_provenance_lineage_v01 WHERE event_id=ANY($1)) features`,
      [events.map((event) => event.eventId)]
    );
    assert.equal(counts.rows[0].observations, 2);
    assert.equal(
      counts.rows[0].features,
      first.attestations.reduce((sum, row) => sum + row.featureCount, 0)
    );
  } finally {
    await pool.end();
  }
});

test('changed content using the same snapshot identity is rejected and original evidence remains exact', {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  const original = providerEvent('CHANGED');
  const changed = providerEvent('CHANGED', {
    evidence: { homeRecentMatches: [historicalMatch('runtime-changed', 4, 0)] }
  });
  try {
    const originalResult = await runProviderMatchEvidencePersistence({
      pool,
      providerBatch: providerBatch('CHANGED', [original]),
      timingByEvent: timingByEvent([original])
    });
    await assert.rejects(
      runProviderMatchEvidencePersistence({
        pool,
        providerBatch: providerBatch('CHANGED', [changed]),
        timingByEvent: timingByEvent([changed])
      }),
      /POSTGRES_INGESTION_OBSERVATION_IMMUTABILITY_CONFLICT/
    );
    const attested = await pool.connect();
    try {
      const readback = await attestProviderMatchEvidencePersistence({
        client: attested,
        sourceProvenanceId: originalResult.events[0].sourceProvenanceId
      });
      assert.equal(
        readback.evidenceSnapshotFingerprint,
        originalResult.events[0].evidenceSnapshotFingerprint
      );
    } finally {
      attested.release();
    }
  } finally {
    await pool.end();
  }
});

test('failure while writing the second event rolls back the whole runtime batch', {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  const events = [providerEvent('ROLLBACK-A'), providerEvent('ROLLBACK-B')];
  let rollbackSeen = false;
  const failingPool = {
    async connect() {
      const client = await pool.connect();
      return {
        async query(text, params) {
          if (typeof text === 'string' &&
              text.includes('INSERT INTO reference_ingestion_observations_v01') &&
              params?.[2] === events[1].eventId) {
            throw new Error('INJECTED_SECOND_EVENT_WRITE_FAILURE');
          }
          if (text === 'ROLLBACK') rollbackSeen = true;
          return client.query(text, params);
        },
        release: () => client.release()
      };
    }
  };
  try {
    await assert.rejects(
      runProviderMatchEvidencePersistence({
        pool: failingPool,
        providerBatch: providerBatch('ROLLBACK', events),
        timingByEvent: timingByEvent(events)
      }),
      /POSTGRES_INGESTION_PROVENANCE_TRANSACTION_FAILED/
    );
    assert.equal(rollbackSeen, true);
    const counts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM reference_ingestion_observations_v01 WHERE event_id=ANY($1)) observations,
         (SELECT count(*)::int FROM reference_feature_provenance_lineage_v01 WHERE event_id=ANY($1)) features`,
      [events.map((event) => event.eventId)]
    );
    assert.deepEqual(counts.rows[0], { observations: 0, features: 0 });
  } finally {
    await pool.end();
  }
});

test('readback fails closed for an unknown provenance identity', {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await assert.rejects(
      attestProviderMatchEvidencePersistence({
        client,
        sourceProvenanceId: 'PROV-MATCH-EVIDENCE-DOES-NOT-EXIST'
      }),
      /POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_ATTESTATION_MISSING/
    );
  } finally {
    client.release();
    await pool.end();
  }
});

test('operational CLI writes a sanitized attested receipt', {
  skip: !connectionString
}, async () => {
  const event = providerEvent('CLI');
  const envelope = {
    providerBatch: providerBatch('CLI', [event]),
    timingByEvent: timingByEvent([event])
  };
  const directory = await mkdtemp(path.join(tmpdir(), 'sports-provider-evidence-'));
  const inputFile = path.join(directory, 'input.json');
  const outputFile = path.join(directory, 'output.json');
  const script = fileURLToPath(new URL('../scripts/run-provider-match-evidence-persistence.mjs', import.meta.url));
  const environment = { ...process.env, TEST_DATABASE_URL: connectionString };
  delete environment.DATABASE_URL;
  try {
    await writeFile(inputFile, JSON.stringify(envelope));
    await execFileAsync(process.execPath, [script, inputFile, outputFile], { env: environment });
    const output = JSON.parse(await readFile(outputFile, 'utf8'));
    assert.equal(output.status, 'DURABLY_ARCHIVED_AND_ATTESTED');
    assert.equal(output.persistedEventCount, 1);
    assert.equal(output.attestations[0].status, 'ATTESTED');
    assert.equal(output.operational.rawProviderPayloadReturned, false);
    assert.equal(JSON.stringify(output).includes('"snapshot"'), false);
    assert.equal(JSON.stringify(output).includes('homeRecentMatches'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
