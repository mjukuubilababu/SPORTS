import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';

import {
  CANONICAL_PROVIDER_MATCH_EVIDENCE_SCHEMA_VERSION,
  ingestRealProviderMatchEvidenceBatch
} from '../../intelligence-engine/src/real-provider-match-evidence-ingestion.mjs';
import {
  archiveFeatureModelSignalBundle,
  prepareModelSnapshot
} from '../src/postgres-feature-model-signal-lineage.mjs';
import {
  archiveIngestionProvenanceBundle,
  prepareFeatureProvenanceLineage,
  prepareIngestionObservation
} from '../src/postgres-ingestion-provenance.mjs';
import {
  archiveProviderMatchEvidencePersistence,
  POSTGRES_PROVIDER_MATCH_EVIDENCE_PERSISTENCE_VERSION,
  prepareProviderMatchEvidencePersistence
} from '../src/postgres-provider-match-evidence-persistence.mjs';

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const CAPTURED = '2026-09-01T10:00:00.000Z';
const CUTOFF = '2026-09-01T10:30:00.000Z';
const KICKOFF = '2026-09-01T11:00:00.000Z';
const OBSERVED = '2026-09-01T09:55:00.000Z';
const AVAILABLE = '2026-09-01T09:56:00.000Z';

function historicalMatch(id, goalsFor = 1, goalsAgainst = 0) {
  return {
    matchId: id,
    playedAt: '2026-08-25T11:00:00.000Z',
    goalsFor,
    goalsAgainst,
    opponentStrength: 0.5
  };
}

function providerRow(suffix, {
  eventId = 'MATCH-PG-PROVIDER-EVIDENCE-' + suffix,
  snapshotId = 'EVIDENCE-SNAPSHOT-' + suffix,
  providerEventId = 'PROVIDER-EVENT-' + suffix,
  evidence = {},
  sourceType = 'PROVIDER_API',
  verified = true,
  independentlyVerified = false
} = {}) {
  const batch = {
    batchId: 'PROVIDER-BATCH-' + suffix,
    provider: sourceType === 'MANUAL_SCREENSHOT_CAPTURE' ? 'HUMAN_RESEARCHER' : 'STATS_PROVIDER_A',
    sourceType,
    sourceReference: 'provider://batch/' + suffix,
    capturedAt: CAPTURED,
    verified,
    independentlyVerified,
    events: [{
      schemaVersion: CANONICAL_PROVIDER_MATCH_EVIDENCE_SCHEMA_VERSION,
      eventId,
      providerEventId,
      evidenceSnapshotId: snapshotId,
      kickoffAt: KICKOFF,
      homeTeam: 'HOME FC',
      awayTeam: 'AWAY FC',
      sourceReference: 'provider://event/' + suffix,
      evidence,
      model: null
    }]
  };
  const row = ingestRealProviderMatchEvidenceBatch(batch).events[0];
  assert.notEqual(row.state, 'REJECTED');
  return row;
}

function persistenceInput(row) {
  return {
    providerEventRow: row,
    observedAt: OBSERVED,
    availableAt: AVAILABLE,
    predictionCutoff: CUTOFF
  };
}

async function insertObservationDirect(pool, prepared) {
  return pool.query(
    `INSERT INTO reference_ingestion_observations_v01(
       provenance_id,observation_id,event_id,entity_type,entity_id,evidence_kind,provider,source,
       source_type,source_url,observed_at,available_at,captured_at,prediction_cutoff,is_verified,
       pre_match_eligible,source_payload_fingerprint,evidence_fingerprint,payload_json,capital_state,real_money
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,'LOCKED','NO')`,
    [
      prepared.provenanceId, prepared.observationId, prepared.eventId, prepared.entityType,
      prepared.entityId, prepared.evidenceKind, prepared.provider, prepared.source,
      prepared.sourceType, prepared.sourceUrl, prepared.observedAt, prepared.availableAt,
      prepared.capturedAt, prepared.predictionCutoff, prepared.isVerified,
      prepared.preMatchEligible, prepared.sourcePayloadFingerprint, prepared.evidenceFingerprint,
      JSON.stringify(prepared.payload)
    ]
  );
}

async function insertLineageDirect(pool, prepared) {
  return pool.query(
    `INSERT INTO reference_feature_provenance_lineage_v01(
       lineage_id,feature_id,event_id,feature_name,feature_version,feature_fingerprint,feature_payload,
       source_provenance_id,source_evidence_fingerprint,lineage_fingerprint,created_at,capital_state,real_money
     ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,'LOCKED','NO')`,
    [
      prepared.lineageId, prepared.featureId, prepared.eventId, prepared.featureName,
      prepared.featureVersion, prepared.featureFingerprint, JSON.stringify(prepared.featurePayload),
      prepared.sourceProvenanceId, prepared.sourceEvidenceFingerprint,
      prepared.lineageFingerprint, prepared.createdAt
    ]
  );
}

test('canonical provider snapshot and every inferred feature use the existing exact immutable lineage stores', {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  const row = providerRow('ARCHIVE', {
    evidence: {
      homeRecentMatches: [historicalMatch('home-archive', 2, 0)],
      awayRecentMatches: [historicalMatch('away-archive', 0, 1)]
    }
  });
  try {
    const prepared = prepareProviderMatchEvidencePersistence(persistenceInput(row));
    const first = await archiveProviderMatchEvidencePersistence({
      client: pool,
      ...persistenceInput(row)
    });
    assert.equal(first.status, 'DURABLY_ARCHIVED');
    assert.equal(first.observationCount, 1);
    assert.equal(first.lineageCount, prepared.featureLineage.length);
    assert.equal(first.evidenceSnapshotFingerprint, row.snapshot.fingerprint);
    assert.ok(first.lineageCount > 20);
    assert.equal(first.capitalState, 'LOCKED');
    assert.equal(first.realMoney, 'NO');

    const observation = await pool.query(
      `SELECT event_id,entity_type,entity_id,evidence_kind,provider,source,source_type,
              pre_match_eligible,payload_json,source_payload_fingerprint,evidence_fingerprint
         FROM reference_ingestion_observations_v01 WHERE provenance_id=$1`,
      [first.sourceProvenanceId]
    );
    assert.equal(observation.rowCount, 1);
    assert.equal(observation.rows[0].entity_type, 'MATCH_EVIDENCE_SNAPSHOT');
    assert.equal(observation.rows[0].entity_id, row.evidence_snapshot_id);
    assert.equal(observation.rows[0].evidence_kind, 'MATCH_EVIDENCE_SNAPSHOT');
    assert.equal(observation.rows[0].pre_match_eligible, true);
    assert.deepEqual(observation.rows[0].payload_json.snapshot, row.snapshot);
    assert.equal(
      observation.rows[0].payload_json.provider_payload_fingerprint,
      row.provider_payload_fingerprint
    );
    assert.equal(
      observation.rows[0].payload_json.evidence_snapshot_fingerprint,
      row.evidence_snapshot_fingerprint
    );

    const lineage = await pool.query(
      `SELECT feature_name,feature_version,feature_payload,source_provenance_id,
              source_evidence_fingerprint,capital_state,real_money
         FROM reference_feature_provenance_lineage_v01
        WHERE event_id=$1 AND feature_name LIKE 'match_evidence.%'
        ORDER BY feature_name`,
      [row.event_id]
    );
    assert.equal(lineage.rowCount, prepared.featureLineage.length);
    for (const feature of lineage.rows) {
      assert.equal(feature.feature_payload.event_id, row.event_id);
      assert.equal(feature.feature_payload.evidence_snapshot_id, row.evidence_snapshot_id);
      assert.equal(feature.feature_payload.evidence_snapshot_fingerprint, row.snapshot.fingerprint);
      assert.equal(feature.feature_payload.feature.feature_version, feature.feature_version);
      assert.equal(feature.source_provenance_id, first.sourceProvenanceId);
      assert.equal(feature.source_evidence_fingerprint, first.sourceEvidenceFingerprint);
      assert.equal(feature.capital_state, 'LOCKED');
      assert.equal(feature.real_money, 'NO');
    }

    const replay = await archiveProviderMatchEvidencePersistence({
      client: pool,
      ...persistenceInput(row)
    });
    assert.equal(replay.bundleFingerprint, first.bundleFingerprint);
    const counts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM reference_ingestion_observations_v01 WHERE event_id=$1) observations,
         (SELECT count(*)::int FROM reference_feature_provenance_lineage_v01 WHERE event_id=$1) features`,
      [row.event_id]
    );
    assert.deepEqual(counts.rows[0], {
      observations: 1,
      features: prepared.featureLineage.length
    });
  } finally {
    await pool.end();
  }
});

test('changed provider payload with the same snapshot identity is rejected without changing durable evidence', {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  const original = providerRow('CHANGED', { evidence: {} });
  const changed = providerRow('CHANGED', {
    evidence: { homeRecentMatches: [historicalMatch('changed-home', 4, 0)] }
  });
  assert.notEqual(original.provider_payload_fingerprint, changed.provider_payload_fingerprint);
  assert.notEqual(original.evidence_snapshot_fingerprint, changed.evidence_snapshot_fingerprint);
  try {
    const first = await archiveProviderMatchEvidencePersistence({
      client: pool,
      ...persistenceInput(original)
    });
    await assert.rejects(
      archiveProviderMatchEvidencePersistence({
        client: pool,
        ...persistenceInput(changed)
      }),
      /POSTGRES_INGESTION_OBSERVATION_IMMUTABILITY_CONFLICT/
    );
    const stored = await pool.query(
      `SELECT payload_json FROM reference_ingestion_observations_v01 WHERE provenance_id=$1`,
      [first.sourceProvenanceId]
    );
    assert.equal(stored.rowCount, 1);
    assert.equal(
      stored.rows[0].payload_json.provider_payload_fingerprint,
      original.provider_payload_fingerprint
    );
    assert.equal(
      stored.rows[0].payload_json.evidence_snapshot_fingerprint,
      original.evidence_snapshot_fingerprint
    );
  } finally {
    await pool.end();
  }
});

test('cross-event snapshot reuse is rejected by the bridge and cross-event feature lineage is rejected by PostgreSQL', {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  const row = providerRow('CROSS-EVENT');
  const prepared = prepareProviderMatchEvidencePersistence(persistenceInput(row));
  try {
    assert.throws(
      () => prepareProviderMatchEvidencePersistence({
        ...persistenceInput(row),
        providerEventRow: { ...row, event_id: 'MATCH-DIFFERENT-EVENT' }
      }),
      /POSTGRES_PROVIDER_MATCH_EVIDENCE_ROW_SNAPSHOT_IDENTITY_MISMATCH/
    );

    await archiveProviderMatchEvidencePersistence({
      client: pool,
      ...persistenceInput(row)
    });
    const crossInput = {
      ...prepared.featureLineage[0],
      lineageId: 'LINEAGE-MATCH-EVIDENCE-CROSS-EVENT',
      featureId: 'FEATURE-MATCH-EVIDENCE-CROSS-EVENT',
      eventId: 'MATCH-DIFFERENT-EVENT',
      featurePayload: {
        ...prepared.featureLineage[0].featurePayload,
        event_id: 'MATCH-DIFFERENT-EVENT'
      }
    };
    const direct = prepareFeatureProvenanceLineage(crossInput);
    await assert.rejects(
      insertLineageDirect(pool, direct),
      (error) => error?.code === 'P0001' || error?.code === '23503'
    );
  } finally {
    await pool.end();
  }
});

test('database rejects forged snapshot identity and post-kickoff payloads even when generic fingerprints are well-formed', {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  const row = providerRow('DB-GUARD');
  const bridge = prepareProviderMatchEvidencePersistence(persistenceInput(row));
  const forgedIdentity = prepareIngestionObservation({
    ...bridge.observation,
    provenanceId: 'PROV-MATCH-EVIDENCE-DB-FORGED-IDENTITY',
    observationId: 'OBS-MATCH-EVIDENCE-DB-FORGED-IDENTITY',
    payload: {
      ...bridge.observation.payload,
      event_id: 'MATCH-FORGED',
      snapshot: { ...bridge.observation.payload.snapshot, event_id: 'MATCH-FORGED' }
    }
  });
  const forgedTime = prepareIngestionObservation({
    ...bridge.observation,
    provenanceId: 'PROV-MATCH-EVIDENCE-DB-FORGED-TIME',
    observationId: 'OBS-MATCH-EVIDENCE-DB-FORGED-TIME',
    payload: {
      ...bridge.observation.payload,
      snapshot: {
        ...bridge.observation.payload.snapshot,
        kickoff_at: '2026-09-01T09:59:59.000Z'
      }
    }
  });
  try {
    await assert.rejects(insertObservationDirect(pool, forgedIdentity), (error) => error?.code === 'P0001');
    await assert.rejects(insertObservationDirect(pool, forgedTime), (error) => error?.code === 'P0001');
  } finally {
    await pool.end();
  }
});

test('a partial feature failure rolls back the snapshot and every earlier feature write', {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  const row = providerRow('ROLLBACK');
  const bridge = prepareProviderMatchEvidencePersistence(persistenceInput(row));
  const badFeature = {
    ...bridge.featureLineage[1],
    lineageId: 'LINEAGE-MATCH-EVIDENCE-ROLLBACK-BAD',
    featureId: 'FEATURE-MATCH-EVIDENCE-ROLLBACK-BAD',
    sourceEvidenceFingerprint: '0'.repeat(64)
  };
  try {
    await assert.rejects(
      archiveIngestionProvenanceBundle({
        client: pool,
        observations: [bridge.observation],
        featureLineage: [bridge.featureLineage[0], badFeature]
      }),
      /POSTGRES_INGESTION_PROVENANCE_TRANSACTION_FAILED/
    );
    const counts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM reference_ingestion_observations_v01 WHERE event_id=$1) observations,
         (SELECT count(*)::int FROM reference_feature_provenance_lineage_v01 WHERE event_id=$1) features`,
      [row.event_id]
    );
    assert.deepEqual(counts.rows[0], { observations: 0, features: 0 });
  } finally {
    await pool.end();
  }
});

test('pg.Pool persistence uses one dedicated PoolClient for BEGIN through COMMIT and releases it', {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  const row = providerRow('POOL-CLIENT');
  let connectCount = 0;
  let releaseCount = 0;
  const guardedPool = {
    get totalCount() { return pool.totalCount; },
    query() { throw new Error('POOL_QUERY_MUST_NOT_BE_USED_INSIDE_TRANSACTION'); },
    async connect() {
      connectCount += 1;
      const client = await pool.connect();
      const release = client.release.bind(client);
      client.release = () => {
        releaseCount += 1;
        release();
      };
      return client;
    }
  };
  try {
    await archiveProviderMatchEvidencePersistence({
      client: guardedPool,
      ...persistenceInput(row)
    });
    assert.equal(connectCount, 1);
    assert.equal(releaseCount, 1);
  } finally {
    await pool.end();
  }
});

test('eligible feature lineage feeds the existing model and frozen-signal stores without a parallel pipeline', {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  const row = providerRow('DOWNSTREAM');
  try {
    const evidence = await archiveProviderMatchEvidencePersistence({
      client: pool,
      ...persistenceInput(row)
    });
    const modelInput = {
      modelSnapshotId: 'MODEL-MATCH-EVIDENCE-DOWNSTREAM',
      eventId: row.event_id,
      modelVersion: 'INDEPENDENT_MODEL_V1',
      payload: {
        evidence_snapshot_id: row.evidence_snapshot_id,
        evidence_snapshot_fingerprint: row.evidence_snapshot_fingerprint
      },
      kickoffAt: KICKOFF,
      frozenAt: '2026-09-01T10:20:00.000Z',
      features: evidence.featureReferences.slice(0, 3)
    };
    const model = prepareModelSnapshot(modelInput);
    const result = await archiveFeatureModelSignalBundle({
      client: pool,
      models: [modelInput],
      signals: [{
        signalSnapshotId: 'SIGNAL-MATCH-EVIDENCE-DOWNSTREAM',
        eventId: row.event_id,
        signalKind: 'FROZEN_PREDICTION',
        modelSnapshotId: model.modelSnapshotId,
        modelFingerprint: model.modelFingerprint,
        payload: {
          decision: 'ABSTAIN',
          prediction_is_not_validation_or_execution: true
        },
        kickoffAt: KICKOFF,
        frozenAt: '2026-09-01T10:25:00.000Z'
      }]
    });
    assert.equal(result.modelCount, 1);
    assert.equal(result.signalCount, 1);
    assert.equal(result.capitalState, 'LOCKED');
    assert.equal(result.realMoney, 'NO');
  } finally {
    await pool.end();
  }
});

test('unverified manual screenshot evidence is retained but cannot enter a model snapshot', {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  const row = providerRow('MANUAL', {
    sourceType: 'MANUAL_SCREENSHOT_CAPTURE',
    verified: true,
    independentlyVerified: false
  });
  try {
    const evidence = await archiveProviderMatchEvidencePersistence({
      client: pool,
      ...persistenceInput(row)
    });
    const stored = await pool.query(
      'SELECT is_verified,pre_match_eligible FROM reference_ingestion_observations_v01 WHERE provenance_id=$1',
      [evidence.sourceProvenanceId]
    );
    assert.deepEqual(stored.rows[0], { is_verified: false, pre_match_eligible: false });
    await assert.rejects(
      archiveFeatureModelSignalBundle({
        client: pool,
        models: [{
          modelSnapshotId: 'MODEL-MATCH-EVIDENCE-MANUAL',
          eventId: row.event_id,
          modelVersion: 'INDEPENDENT_MODEL_V1',
          payload: { source: 'manual-unverified' },
          kickoffAt: KICKOFF,
          frozenAt: '2026-09-01T10:20:00.000Z',
          features: evidence.featureReferences.slice(0, 1)
        }]
      }),
      /POSTGRES_MODEL_FEATURE_POST_KICKOFF_OR_INELIGIBLE/
    );
  } finally {
    await pool.end();
  }
});

test('snapshot and feature lineage rows reject UPDATE and DELETE', {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  const row = providerRow('IMMUTABLE');
  try {
    const evidence = await archiveProviderMatchEvidencePersistence({
      client: pool,
      ...persistenceInput(row)
    });
    await assert.rejects(
      pool.query(
        'UPDATE reference_ingestion_observations_v01 SET source=source WHERE provenance_id=$1',
        [evidence.sourceProvenanceId]
      ),
      /reference ingestion provenance is immutable/i
    );
    await assert.rejects(
      pool.query(
        'DELETE FROM reference_ingestion_observations_v01 WHERE provenance_id=$1',
        [evidence.sourceProvenanceId]
      ),
      /reference ingestion provenance is immutable/i
    );
    await assert.rejects(
      pool.query(
        'UPDATE reference_feature_provenance_lineage_v01 SET feature_name=feature_name WHERE lineage_id=$1',
        [evidence.featureReferences[0].featureLineageId]
      ),
      /reference ingestion provenance is immutable/i
    );
    await assert.rejects(
      pool.query(
        'DELETE FROM reference_feature_provenance_lineage_v01 WHERE lineage_id=$1',
        [evidence.featureReferences[0].featureLineageId]
      ),
      /reference ingestion provenance is immutable/i
    );
  } finally {
    await pool.end();
  }
});

test('bridge fails closed on non-prematch cutoff, rejected rows, and altered per-feature provenance', () => {
  const row = providerRow('APP-GUARDS');
  assert.throws(
    () => prepareProviderMatchEvidencePersistence({
      ...persistenceInput(row),
      predictionCutoff: KICKOFF
    }),
    /POSTGRES_PROVIDER_MATCH_EVIDENCE_PREDICTION_CUTOFF_NOT_PREMATCH/
  );
  assert.throws(
    () => prepareProviderMatchEvidencePersistence({
      ...persistenceInput(row),
      providerEventRow: { ...row, state: 'REJECTED' }
    }),
    /POSTGRES_PROVIDER_MATCH_EVIDENCE_ROW_NOT_ACCEPTED/
  );
  const changedSnapshot = {
    ...row.snapshot,
    features: {
      ...row.snapshot.features,
      home_recent_ppg: {
        ...row.snapshot.features.home_recent_ppg,
        provider: 'ALTERED_PROVIDER'
      }
    }
  };
  assert.throws(
    () => prepareProviderMatchEvidencePersistence({
      ...persistenceInput(row),
      providerEventRow: {
        ...row,
        snapshot: changedSnapshot
      }
    }),
    /POSTGRES_PROVIDER_MATCH_EVIDENCE_SNAPSHOT_INVALID/
  );
  assert.equal(POSTGRES_PROVIDER_MATCH_EVIDENCE_PERSISTENCE_VERSION,
    'POSTGRES_PROVIDER_MATCH_EVIDENCE_PERSISTENCE_V0_1');
});
