import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { buildCanonicalMatchMemory } from '../../intelligence-engine/src/canonical-match-memory.mjs';
import {
  archiveIngestionProvenanceBundle,
  prepareFeatureProvenanceLineage,
  prepareIngestionObservation
} from '../src/postgres-ingestion-provenance.mjs';

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

function fixture() {
  const eventId = 'MATCH-PG-INGESTION-PROVENANCE-001';
  const cutoff = '2026-08-26T10:00:00.000Z';
  const memoryObservation = {
    observation_id: 'OBS-STATS-001',
    event_id: eventId,
    entity_type: 'TEAM',
    entity_id: 'HOME',
    observation_type: 'TEAM_STATS',
    value: { xg: 1.42, shots_on_target: 5 },
    observed_at: '2026-08-26T09:00:00.000Z',
    available_at: '2026-08-26T09:00:01.000Z',
    source: 'TEST_STATS_PUBLIC',
    source_type: 'PUBLIC_WEB',
    source_url: 'https://example.test/stats',
    is_verified: true,
    provenance_id: 'PROV-STATS-001'
  };
  const marketSnapshot = {
    event_id: eventId,
    provider: 'TEST_BOOK',
    source: 'TEST_BOOK_PUBLIC',
    source_url: 'https://example.test/market',
    observed_at: '2026-08-26T09:03:00.000Z',
    quote_type: 'CAPTURE',
    status: 'ACCEPTED',
    is_verified: true,
    market: '1X2_90M',
    selection: null,
    prices: { home: 2.1, draw: 3.2, away: 3.4 }
  };
  const truthRecord = {
    match_id: eventId,
    canonical_match_date: '2026-08-26',
    canonical_date_policy: 'UTC_FIXTURE_DATE',
    season: 2026,
    league: 'TEST_LEAGUE',
    home_team: 'Alpha FC',
    away_team: 'Beta FC',
    status: 'ACCEPTED',
    final_score: { home: 2, away: 1 },
    result: {
      verified: true,
      verification_method: 'OFFICIAL_RESULT',
      source: 'TEST_OFFICIAL',
      source_url: 'https://example.test/result',
      source_match_date: '2026-08-26'
    },
    gate2_backfill_eligible: true,
    gate1_validation_n_eligible: true,
    reasons: []
  };
  const matchMemory = buildCanonicalMatchMemory({
    truthRecord,
    observations: [memoryObservation],
    marketSnapshots: [marketSnapshot],
    predictionSettlements: [],
    predictionCutoff: cutoff,
    materializedAt: '2026-08-27T08:00:00.000Z'
  });

  const statsInput = {
    provenanceId: memoryObservation.provenance_id,
    observationId: memoryObservation.observation_id,
    eventId,
    entityType: memoryObservation.entity_type,
    entityId: memoryObservation.entity_id,
    evidenceKind: memoryObservation.observation_type,
    provider: null,
    source: memoryObservation.source,
    sourceType: memoryObservation.source_type,
    sourceUrl: memoryObservation.source_url,
    observedAt: memoryObservation.observed_at,
    availableAt: memoryObservation.available_at,
    capturedAt: '2026-08-26T09:00:02.000Z',
    predictionCutoff: cutoff,
    isVerified: memoryObservation.is_verified,
    payload: memoryObservation
  };
  const marketInput = {
    provenanceId: 'PROV-MARKET-001',
    observationId: 'OBS-MARKET-001',
    eventId,
    entityType: 'MATCH',
    entityId: eventId,
    evidenceKind: 'MARKET_SNAPSHOT',
    provider: marketSnapshot.provider,
    source: marketSnapshot.source,
    sourceType: 'PUBLIC_WEB',
    sourceUrl: marketSnapshot.source_url,
    observedAt: marketSnapshot.observed_at,
    availableAt: '2026-08-26T09:03:01.000Z',
    capturedAt: '2026-08-26T09:03:02.000Z',
    predictionCutoff: cutoff,
    isVerified: true,
    payload: marketSnapshot
  };
  const preparedStats = prepareIngestionObservation(statsInput);
  const featurePayload = { xg_strength: 0.71, shot_quality: 0.64 };
  const lineageInput = {
    featureId: 'FEATURE-MATCH-PG-001-HOME-ATTACK',
    eventId,
    featureName: 'home_attack_strength',
    featureVersion: 'FEATURE_CONTRACT_V0_1',
    featurePayload,
    sourceProvenanceId: preparedStats.provenanceId,
    sourceEvidenceFingerprint: preparedStats.evidenceFingerprint,
    createdAt: '2026-08-26T09:10:00.000Z'
  };
  return { eventId, cutoff, memoryObservation, marketSnapshot, truthRecord, matchMemory, statsInput, marketInput, lineageInput };
}

test('ingestion provenance, feature lineage, and canonical Match Memory are transactionally archived and immutable', {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  const data = fixture();
  try {
    const first = await archiveIngestionProvenanceBundle({
      client: pool,
      observations: [data.statsInput, data.marketInput],
      featureLineage: [data.lineageInput],
      matchMemory: data.matchMemory
    });

    assert.equal(first.status, 'DURABLY_ARCHIVED');
    assert.equal(first.observationCount, 2);
    assert.equal(first.lineageCount, 1);
    assert.equal(first.matchMemoryFingerprint, data.matchMemory.memory_fingerprint);
    assert.equal(first.capitalState, 'LOCKED');
    assert.equal(first.realMoney, 'NO');

    const observations = await pool.query(
      `SELECT provenance_id, observed_at, available_at, captured_at, persisted_at,
              pre_match_eligible, source_payload_fingerprint, evidence_fingerprint,
              capital_state, real_money
         FROM reference_ingestion_observations_v01
        WHERE event_id=$1 ORDER BY provenance_id`,
      [data.eventId]
    );
    assert.equal(observations.rowCount, 2);
    for (const row of observations.rows) {
      assert.equal(row.pre_match_eligible, true);
      assert.ok(row.observed_at < row.available_at);
      assert.ok(row.available_at < row.captured_at);
      assert.ok(row.captured_at < row.persisted_at);
      assert.match(row.source_payload_fingerprint, /^[0-9a-f]{64}$/);
      assert.match(row.evidence_fingerprint, /^[0-9a-f]{64}$/);
      assert.equal(row.capital_state, 'LOCKED');
      assert.equal(row.real_money, 'NO');
    }

    const lineage = await pool.query(
      `SELECT l.source_provenance_id, l.source_evidence_fingerprint, o.evidence_fingerprint
         FROM reference_feature_provenance_lineage_v01 l
         JOIN reference_ingestion_observations_v01 o
           ON o.provenance_id=l.source_provenance_id
          AND o.evidence_fingerprint=l.source_evidence_fingerprint
        WHERE l.event_id=$1`,
      [data.eventId]
    );
    assert.equal(lineage.rowCount, 1);
    assert.equal(lineage.rows[0].source_evidence_fingerprint, lineage.rows[0].evidence_fingerprint);

    const memory = await pool.query(
      `SELECT memory_fingerprint, truth_owner, memory_role, capital_state, real_money
         FROM reference_match_memory_materializations_v01
        WHERE event_id=$1`,
      [data.eventId]
    );
    assert.equal(memory.rowCount, 1);
    assert.equal(memory.rows[0].memory_fingerprint, data.matchMemory.memory_fingerprint);
    assert.equal(memory.rows[0].truth_owner, 'GATE1');
    assert.equal(memory.rows[0].memory_role, 'DERIVED_IMMUTABLE_MATERIALIZED_VIEW');
    assert.equal(memory.rows[0].capital_state, 'LOCKED');
    assert.equal(memory.rows[0].real_money, 'NO');

    const links = await pool.query(
      `SELECT evidence_sequence, evidence_role, source_provenance_id, source_evidence_fingerprint
         FROM reference_match_memory_evidence_links_v01
        WHERE memory_fingerprint=$1 ORDER BY evidence_sequence`,
      [data.matchMemory.memory_fingerprint]
    );
    assert.equal(links.rowCount, 2);
    assert.deepEqual(links.rows.map((row) => row.evidence_role), ['OBSERVATION', 'MARKET_SNAPSHOT']);

    const second = await archiveIngestionProvenanceBundle({
      client: pool,
      observations: [data.statsInput, data.marketInput],
      featureLineage: [data.lineageInput],
      matchMemory: data.matchMemory
    });
    assert.equal(second.bundleFingerprint, first.bundleFingerprint);
    const replayCount = await pool.query(
      'SELECT count(*)::int AS count FROM reference_ingestion_observations_v01 WHERE event_id=$1',
      [data.eventId]
    );
    assert.equal(replayCount.rows[0].count, 2);

    await assert.rejects(
      archiveIngestionProvenanceBundle({
        client: pool,
        observations: [{
          ...data.statsInput,
          payload: { ...data.memoryObservation, value: { xg: 9.99, shots_on_target: 99 } }
        }]
      }),
      /POSTGRES_INGESTION_OBSERVATION_IMMUTABILITY_CONFLICT/
    );

    await assert.rejects(
      pool.query(
        'UPDATE reference_ingestion_observations_v01 SET source=source WHERE provenance_id=$1',
        [data.statsInput.provenanceId]
      ),
      /reference ingestion provenance is immutable/i
    );
    await assert.rejects(
      pool.query(
        'DELETE FROM reference_feature_provenance_lineage_v01 WHERE event_id=$1',
        [data.eventId]
      ),
      /reference ingestion provenance is immutable/i
    );
  } finally {
    await pool.end();
  }
});

test('no-hindsight eligibility is derived from verified availability and capture times, never caller optimism', () => {
  const data = fixture();
  const late = prepareIngestionObservation({
    ...data.marketInput,
    provenanceId: 'PROV-MARKET-LATE-001',
    observationId: 'OBS-MARKET-LATE-001',
    availableAt: '2026-08-26T10:00:01.000Z',
    capturedAt: '2026-08-26T10:00:02.000Z',
    preMatchEligible: true
  });
  assert.equal(late.preMatchEligible, false);

  assert.throws(
    () => prepareIngestionObservation({ ...data.marketInput, evidenceKind: 'SETTLEMENT' }),
    /POSTGRES_INGESTION_SETTLEMENT_BOUNDARY_VIOLATION/
  );
});

test('bad feature provenance rolls the whole new bundle back', {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  const data = fixture();
  const rollbackObservation = {
    ...data.statsInput,
    provenanceId: 'PROV-ROLLBACK-001',
    observationId: 'OBS-ROLLBACK-001',
    eventId: 'MATCH-PG-ROLLBACK-001'
  };
  const badLineage = prepareFeatureProvenanceLineage({
    featureId: 'FEATURE-ROLLBACK-001',
    eventId: rollbackObservation.eventId,
    featureName: 'rollback_probe',
    featureVersion: 'FEATURE_CONTRACT_V0_1',
    featurePayload: { value: 1 },
    sourceProvenanceId: rollbackObservation.provenanceId,
    sourceEvidenceFingerprint: '0'.repeat(64),
    createdAt: '2026-08-26T09:20:00.000Z'
  });
  try {
    await assert.rejects(
      archiveIngestionProvenanceBundle({
        client: pool,
        observations: [rollbackObservation],
        featureLineage: [{
          featureId: badLineage.featureId,
          eventId: badLineage.eventId,
          featureName: badLineage.featureName,
          featureVersion: badLineage.featureVersion,
          featurePayload: { value: 1 },
          sourceProvenanceId: badLineage.sourceProvenanceId,
          sourceEvidenceFingerprint: badLineage.sourceEvidenceFingerprint,
          createdAt: badLineage.createdAt
        }]
      }),
      /POSTGRES_INGESTION_PROVENANCE_REFERENCE_CONFLICT/
    );
    const readback = await pool.query(
      'SELECT count(*)::int AS count FROM reference_ingestion_observations_v01 WHERE provenance_id=$1',
      [rollbackObservation.provenanceId]
    );
    assert.equal(readback.rows[0].count, 0);
  } finally {
    await pool.end();
  }
});

test('settlement-enriched Match Memory cannot enter the pre-match provenance materialization store', {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  const data = fixture();
  const settlementMemory = buildCanonicalMatchMemory({
    truthRecord: data.truthRecord,
    observations: [data.memoryObservation],
    marketSnapshots: [data.marketSnapshot],
    predictionSettlements: [{
      event_id: data.eventId,
      source_signal_id: 'SIGNAL-001',
      source_snapshot_type: 'SIGNAL_FROZEN',
      market: '1X2_90M',
      selection: 'HOME',
      result: 'WIN',
      prediction_correct: true,
      actual_outcome: 'HOME_WIN',
      predicted_outcome: 'HOME_WIN',
      settled_at: '2026-08-27T07:00:00.000Z',
      no_hindsight: true
    }],
    predictionCutoff: data.cutoff,
    materializedAt: '2026-08-27T08:05:00.000Z'
  });
  try {
    await assert.rejects(
      archiveIngestionProvenanceBundle({
        client: pool,
        observations: [data.statsInput, data.marketInput],
        matchMemory: settlementMemory
      }),
      /POSTGRES_MATCH_MEMORY_SETTLEMENT_SEPARATION_REQUIRED/
    );
  } finally {
    await pool.end();
  }
});


test('pg.Pool transactions use one checked-out PoolClient and release it', { skip: !connectionString }, async () => {
  const pool = new Pool({ connectionString });
  const data = fixture();
  let connectCount = 0;
  let releaseCount = 0;
  const guardedPool = {
    get totalCount() { return pool.totalCount; },
    query() { throw new Error('POOL_QUERY_MUST_NOT_BE_USED_INSIDE_TRANSACTION'); },
    async connect() {
      connectCount += 1;
      const client = await pool.connect();
      const release = client.release.bind(client);
      client.release = () => { releaseCount += 1; release(); };
      return client;
    }
  };
  try {
    await archiveIngestionProvenanceBundle({
      client: guardedPool,
      observations: [data.statsInput, data.marketInput],
      featureLineage: [data.lineageInput],
      matchMemory: data.matchMemory
    });
    assert.equal(connectCount, 1);
    assert.equal(releaseCount, 1);
  } finally {
    await pool.end();
  }
});

test('Match Memory rejects altered payload, timestamp, source, verification, and eligibility with reused provenance_id', { skip: !connectionString }, async () => {
  const pool = new Pool({ connectionString });
  const data = fixture();
  try {
    await archiveIngestionProvenanceBundle({ client: pool, observations: [data.statsInput] });
    const variants = [
      ['payload', { value: { xg: 9.99, shots_on_target: 99 } }],
      ['timestamp', { observed_at: '2026-08-26T08:59:59.000Z' }],
      ['source', { source: 'ALTERED_SOURCE' }],
      ['verification', { is_verified: false }],
      ['eligibility', { available_at: '2026-08-26T10:00:01.000Z' }]
    ];
    for (const [label, changes] of variants) {
      const alteredMemory = buildCanonicalMatchMemory({
        truthRecord: data.truthRecord,
        observations: [{ ...data.memoryObservation, ...changes }],
        marketSnapshots: [],
        predictionSettlements: [],
        predictionCutoff: data.cutoff,
        materializedAt: '2026-08-27T08:10:00.000Z'
      });
      await assert.rejects(
        archiveIngestionProvenanceBundle({ client: pool, matchMemory: alteredMemory }),
        /POSTGRES_MATCH_MEMORY_OBSERVATION_PROVENANCE_NOT_EXACT/,
        label
      );
    }
  } finally {
    await pool.end();
  }
});

test('cross-event feature lineage is rejected by application persistence and PostgreSQL FK', { skip: !connectionString }, async () => {
  const pool = new Pool({ connectionString });
  const data = fixture();
  const prepared = prepareIngestionObservation(data.statsInput);
  const crossEvent = {
    ...data.lineageInput,
    lineageId: 'LINEAGE-CROSS-EVENT-APP-001',
    featureId: 'FEATURE-CROSS-EVENT-APP-001',
    eventId: 'MATCH-DIFFERENT-EVENT-001'
  };
  try {
    await archiveIngestionProvenanceBundle({ client: pool, observations: [data.statsInput] });
    await assert.rejects(
      archiveIngestionProvenanceBundle({ client: pool, featureLineage: [crossEvent] }),
      /POSTGRES_INGESTION_PROVENANCE_REFERENCE_CONFLICT/
    );
    const direct = prepareFeatureProvenanceLineage({
      ...crossEvent,
      lineageId: 'LINEAGE-CROSS-EVENT-DB-001',
      featureId: 'FEATURE-CROSS-EVENT-DB-001'
    });
    await assert.rejects(
      pool.query(
        'INSERT INTO reference_feature_provenance_lineage_v01(lineage_id,feature_id,event_id,feature_name,feature_version,feature_fingerprint,source_provenance_id,source_evidence_fingerprint,lineage_fingerprint,created_at,capital_state,real_money) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,\\'LOCKED\\',\\'NO\\')',
        [direct.lineageId,direct.featureId,direct.eventId,direct.featureName,direct.featureVersion,direct.featureFingerprint,prepared.provenanceId,prepared.evidenceFingerprint,direct.lineageFingerprint,direct.createdAt]
      ),
      (error) => error?.code === '23503'
    );
  } finally {
    await pool.end();
  }
});

test('settlement variants are rejected after normalization in JS and by PostgreSQL', { skip: !connectionString }, async () => {
  const pool = new Pool({ connectionString });
  const data = fixture();
  const variants = [' settlement ', 'SeTtLeMeNt', ' prediction_settlement ', 'Prediction_Settlement'];
  try {
    for (const evidenceKind of variants) {
      assert.throws(
        () => prepareIngestionObservation({ ...data.marketInput, evidenceKind }),
        /POSTGRES_INGESTION_SETTLEMENT_BOUNDARY_VIOLATION/
      );
    }
    const prepared = prepareIngestionObservation({
      ...data.marketInput,
      provenanceId: 'PROV-DB-SETTLEMENT-001',
      observationId: 'OBS-DB-SETTLEMENT-001'
    });
    for (const [index, evidenceKind] of variants.entries()) {
      await assert.rejects(
        pool.query(
          'INSERT INTO reference_ingestion_observations_v01(provenance_id,observation_id,event_id,evidence_kind,source,source_type,observed_at,available_at,captured_at,prediction_cutoff,is_verified,pre_match_eligible,source_payload_fingerprint,evidence_fingerprint,payload_json,capital_state,real_money) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,\\'LOCKED\\',\\'NO\\')',
          [prepared.provenanceId + '-' + index,prepared.observationId + '-' + index,prepared.eventId,evidenceKind,prepared.source,prepared.sourceType,prepared.observedAt,prepared.availableAt,prepared.capturedAt,prepared.predictionCutoff,prepared.isVerified,prepared.preMatchEligible,prepared.sourcePayloadFingerprint,prepared.evidenceFingerprint,JSON.stringify(prepared.payload)]
        ),
        (error) => error?.code === '23514'
      );
    }
  } finally {
    await pool.end();
  }
});

test('all provenance tables reject UPDATE and DELETE while exact replay remains idempotent', { skip: !connectionString }, async () => {
  const pool = new Pool({ connectionString });
  const data = fixture();
  try {
    const first = await archiveIngestionProvenanceBundle({
      client: pool, observations: [data.statsInput, data.marketInput],
      featureLineage: [data.lineageInput], matchMemory: data.matchMemory
    });
    const replay = await archiveIngestionProvenanceBundle({
      client: pool, observations: [data.statsInput, data.marketInput],
      featureLineage: [data.lineageInput], matchMemory: data.matchMemory
    });
    assert.equal(replay.bundleFingerprint, first.bundleFingerprint);
    const mutations = [
      ['reference_ingestion_observations_v01', 'provenance_id', data.statsInput.provenanceId],
      ['reference_feature_provenance_lineage_v01', 'lineage_id', prepareFeatureProvenanceLineage(data.lineageInput).lineageId],
      ['reference_match_memory_materializations_v01', 'memory_fingerprint', data.matchMemory.memory_fingerprint],
      ['reference_match_memory_evidence_links_v01', 'memory_fingerprint', data.matchMemory.memory_fingerprint]
    ];
    for (const [table, key, value] of mutations) {
      await assert.rejects(
        pool.query('UPDATE ' + table + ' SET capital_state=capital_state WHERE ' + key + '=$1', [value]),
        /reference ingestion provenance is immutable/i
      );
      await assert.rejects(
        pool.query('DELETE FROM ' + table + ' WHERE ' + key + '=$1', [value]),
        /reference ingestion provenance is immutable/i
      );
    }
  } finally {
    await pool.end();
  }
});
