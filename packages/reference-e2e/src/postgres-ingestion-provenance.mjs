import { sha256 } from './utils.mjs';
import { verifyCanonicalMatchMemory } from '../../intelligence-engine/src/canonical-match-memory.mjs';

export const POSTGRES_INGESTION_PROVENANCE_VERSION = 'v0.1';

function fail(code, cause) {
  const error = new Error(code);
  if (cause) error.cause = cause;
  return error;
}

function text(name, value) {
  if (typeof value !== 'string' || value.trim() === '') throw fail(`${name}_REQUIRED`);
  return value;
}

function iso(name, value) {
  text(name, value);
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw fail(`${name}_INVALID`);
  return new Date(epoch).toISOString();
}

function nullableIso(name, value) {
  return value == null ? null : iso(name, value);
}

function dbIso(value) {
  return value == null ? null : new Date(value).toISOString();
}

function hash(name, value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw fail(`${name}_INVALID`);
  return value;
}

function observationCore(row) {
  return {
    provenanceId: row.provenanceId,
    observationId: row.observationId,
    eventId: row.eventId,
    entityType: row.entityType,
    entityId: row.entityId,
    evidenceKind: row.evidenceKind,
    provider: row.provider,
    source: row.source,
    sourceType: row.sourceType,
    sourceUrl: row.sourceUrl,
    observedAt: row.observedAt,
    availableAt: row.availableAt,
    capturedAt: row.capturedAt,
    predictionCutoff: row.predictionCutoff,
    isVerified: row.isVerified,
    preMatchEligible: row.preMatchEligible,
    sourcePayloadFingerprint: row.sourcePayloadFingerprint
  };
}

export function prepareIngestionObservation(input) {
  if (!input || typeof input !== 'object') throw fail('POSTGRES_INGESTION_OBSERVATION_REQUIRED');
  text('EVENT_ID', input.eventId);
  text('SOURCE', input.source);
  text('SOURCE_TYPE', input.sourceType);
  const evidenceKind = text('EVIDENCE_KIND', input.evidenceKind).toUpperCase();
  if (['SETTLEMENT', 'PREDICTION_SETTLEMENT'].includes(evidenceKind)) {
    throw fail('POSTGRES_INGESTION_SETTLEMENT_BOUNDARY_VIOLATION');
  }
  if (input.payload == null) throw fail('POSTGRES_INGESTION_SOURCE_PAYLOAD_REQUIRED');

  const observedAt = iso('OBSERVED_AT', input.observedAt);
  const availableAt = iso('AVAILABLE_AT', input.availableAt);
  const capturedAt = iso('CAPTURED_AT', input.capturedAt);
  const predictionCutoff = nullableIso('PREDICTION_CUTOFF', input.predictionCutoff);
  if (Date.parse(availableAt) < Date.parse(observedAt)) throw fail('POSTGRES_INGESTION_AVAILABLE_BEFORE_OBSERVED');
  if (Date.parse(capturedAt) < Date.parse(availableAt)) throw fail('POSTGRES_INGESTION_CAPTURE_BEFORE_AVAILABLE');

  const isVerified = input.isVerified === true;
  const preMatchEligible = predictionCutoff !== null
    && isVerified
    && Date.parse(availableAt) <= Date.parse(predictionCutoff)
    && Date.parse(capturedAt) <= Date.parse(predictionCutoff);
  const sourcePayloadFingerprint = sha256(input.payload);
  const observationId = input.observationId ?? `OBS-${sha256({
    eventId: input.eventId, evidenceKind, source: input.source, observedAt, capturedAt, sourcePayloadFingerprint
  }).slice(0, 24)}`;
  text('OBSERVATION_ID', observationId);
  const provenanceId = input.provenanceId ?? `PROV-${sha256({
    observationId, eventId: input.eventId, sourcePayloadFingerprint
  }).slice(0, 24)}`;
  text('PROVENANCE_ID', provenanceId);

  const core = observationCore({
    provenanceId,
    observationId,
    eventId: input.eventId,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    evidenceKind,
    provider: input.provider ?? null,
    source: input.source,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl ?? null,
    observedAt,
    availableAt,
    capturedAt,
    predictionCutoff,
    isVerified,
    preMatchEligible,
    sourcePayloadFingerprint
  });
  return Object.freeze({
    ...core,
    evidenceFingerprint: sha256(core),
    payload: structuredClone(input.payload),
    capitalState: 'LOCKED',
    realMoney: 'NO'
  });
}

function observationCoreFromDb(row) {
  return observationCore({
    provenanceId: row.provenance_id,
    observationId: row.observation_id,
    eventId: row.event_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    evidenceKind: row.evidence_kind,
    provider: row.provider,
    source: row.source,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    observedAt: dbIso(row.observed_at),
    availableAt: dbIso(row.available_at),
    capturedAt: dbIso(row.captured_at),
    predictionCutoff: dbIso(row.prediction_cutoff),
    isVerified: row.is_verified,
    preMatchEligible: row.pre_match_eligible,
    sourcePayloadFingerprint: row.source_payload_fingerprint
  });
}

async function verifyObservation(client, expected) {
  const result = await client.query(
    `SELECT provenance_id,observation_id,event_id,entity_type,entity_id,evidence_kind,provider,
            source,source_type,source_url,observed_at,available_at,captured_at,prediction_cutoff,
            is_verified,pre_match_eligible,source_payload_fingerprint,evidence_fingerprint,
            payload_json,capital_state,real_money
       FROM reference_ingestion_observations_v01 WHERE provenance_id=$1`,
    [expected.provenanceId]
  );
  if (result.rowCount !== 1) throw fail('POSTGRES_INGESTION_OBSERVATION_READBACK_MISSING');
  const row = result.rows[0];
  if (
    sha256(observationCoreFromDb(row)) !== expected.evidenceFingerprint ||
    row.evidence_fingerprint !== expected.evidenceFingerprint ||
    row.source_payload_fingerprint !== expected.sourcePayloadFingerprint ||
    sha256(row.payload_json) !== expected.sourcePayloadFingerprint ||
    row.capital_state !== 'LOCKED' || row.real_money !== 'NO'
  ) throw fail(`POSTGRES_INGESTION_OBSERVATION_IMMUTABILITY_CONFLICT:${expected.provenanceId}`);
}

async function insertObservation(client, row) {
  await client.query(
    `INSERT INTO reference_ingestion_observations_v01(
       provenance_id,observation_id,event_id,entity_type,entity_id,evidence_kind,provider,source,
       source_type,source_url,observed_at,available_at,captured_at,prediction_cutoff,is_verified,
       pre_match_eligible,source_payload_fingerprint,evidence_fingerprint,payload_json,capital_state,real_money
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,'LOCKED','NO')
     ON CONFLICT (provenance_id) DO NOTHING`,
    [row.provenanceId,row.observationId,row.eventId,row.entityType,row.entityId,row.evidenceKind,row.provider,
      row.source,row.sourceType,row.sourceUrl,row.observedAt,row.availableAt,row.capturedAt,row.predictionCutoff,
      row.isVerified,row.preMatchEligible,row.sourcePayloadFingerprint,row.evidenceFingerprint,JSON.stringify(row.payload)]
  );
  await verifyObservation(client, row);
}

function lineageCore(row) {
  return {
    lineageId: row.lineageId,
    featureId: row.featureId,
    eventId: row.eventId,
    featureName: row.featureName,
    featureVersion: row.featureVersion,
    featureFingerprint: row.featureFingerprint,
    sourceProvenanceId: row.sourceProvenanceId,
    sourceEvidenceFingerprint: row.sourceEvidenceFingerprint,
    createdAt: row.createdAt
  };
}

export function prepareFeatureProvenanceLineage(input) {
  if (!input || typeof input !== 'object') throw fail('POSTGRES_FEATURE_LINEAGE_REQUIRED');
  text('FEATURE_ID', input.featureId);
  text('EVENT_ID', input.eventId);
  text('FEATURE_NAME', input.featureName);
  text('FEATURE_VERSION', input.featureVersion);
  text('SOURCE_PROVENANCE_ID', input.sourceProvenanceId);
  hash('SOURCE_EVIDENCE_FINGERPRINT', input.sourceEvidenceFingerprint);
  if (input.featurePayload == null) throw fail('POSTGRES_FEATURE_PAYLOAD_REQUIRED');
  const featureFingerprint = sha256(input.featurePayload);
  const createdAt = iso('FEATURE_LINEAGE_CREATED_AT', input.createdAt);
  const lineageId = input.lineageId ?? `LINEAGE-${sha256({
    featureId: input.featureId,
    sourceProvenanceId: input.sourceProvenanceId,
    sourceEvidenceFingerprint: input.sourceEvidenceFingerprint
  }).slice(0, 24)}`;
  text('LINEAGE_ID', lineageId);
  const core = lineageCore({
    lineageId,
    featureId: input.featureId,
    eventId: input.eventId,
    featureName: input.featureName,
    featureVersion: input.featureVersion,
    featureFingerprint,
    sourceProvenanceId: input.sourceProvenanceId,
    sourceEvidenceFingerprint: input.sourceEvidenceFingerprint,
    createdAt
  });
  return Object.freeze({ ...core, lineageFingerprint: sha256(core), capitalState: 'LOCKED', realMoney: 'NO' });
}

async function verifyLineage(client, expected) {
  const result = await client.query(
    `SELECT lineage_id,feature_id,event_id,feature_name,feature_version,feature_fingerprint,
            source_provenance_id,source_evidence_fingerprint,lineage_fingerprint,created_at,
            capital_state,real_money
       FROM reference_feature_provenance_lineage_v01 WHERE lineage_id=$1`,
    [expected.lineageId]
  );
  if (result.rowCount !== 1) throw fail('POSTGRES_FEATURE_LINEAGE_READBACK_MISSING');
  const row = result.rows[0];
  const core = lineageCore({
    lineageId: row.lineage_id,
    featureId: row.feature_id,
    eventId: row.event_id,
    featureName: row.feature_name,
    featureVersion: row.feature_version,
    featureFingerprint: row.feature_fingerprint,
    sourceProvenanceId: row.source_provenance_id,
    sourceEvidenceFingerprint: row.source_evidence_fingerprint,
    createdAt: dbIso(row.created_at)
  });
  if (sha256(core) !== expected.lineageFingerprint || row.lineage_fingerprint !== expected.lineageFingerprint ||
      row.capital_state !== 'LOCKED' || row.real_money !== 'NO') {
    throw fail(`POSTGRES_FEATURE_LINEAGE_IMMUTABILITY_CONFLICT:${expected.lineageId}`);
  }
}

async function insertLineage(client, row) {
  await client.query(
    `INSERT INTO reference_feature_provenance_lineage_v01(
       lineage_id,feature_id,event_id,feature_name,feature_version,feature_fingerprint,
       source_provenance_id,source_evidence_fingerprint,lineage_fingerprint,created_at,capital_state,real_money
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'LOCKED','NO')
     ON CONFLICT (lineage_id) DO NOTHING`,
    [row.lineageId,row.featureId,row.eventId,row.featureName,row.featureVersion,row.featureFingerprint,
      row.sourceProvenanceId,row.sourceEvidenceFingerprint,row.lineageFingerprint,row.createdAt]
  );
  await verifyLineage(client, row);
}

async function resolveMemoryRefs(client, memory) {
  const eventId = memory.identity.match_id;
  const refs = [];
  for (const observation of memory.evidence.observations ?? []) {
    text('MATCH_MEMORY_PROVENANCE_ID', observation.provenance_id);
    const result = await client.query(
      'SELECT provenance_id,event_id,evidence_fingerprint FROM reference_ingestion_observations_v01 WHERE provenance_id=$1',
      [observation.provenance_id]
    );
    if (result.rowCount !== 1 || result.rows[0].event_id !== eventId) {
      throw fail(`POSTGRES_MATCH_MEMORY_OBSERVATION_PROVENANCE_MISSING:${observation.provenance_id}`);
    }
    refs.push({ evidenceRole:'OBSERVATION', sourceProvenanceId:result.rows[0].provenance_id,
      sourceEvidenceFingerprint:result.rows[0].evidence_fingerprint });
  }
  for (const snapshot of memory.evidence.market_snapshots ?? []) {
    hash('MATCH_MEMORY_MARKET_SOURCE_PAYLOAD_FINGERPRINT', snapshot.source_payload_fingerprint);
    const result = await client.query(
      `SELECT provenance_id,evidence_fingerprint FROM reference_ingestion_observations_v01
        WHERE event_id=$1 AND evidence_kind='MARKET_SNAPSHOT' AND source_payload_fingerprint=$2
          AND provider IS NOT DISTINCT FROM $3`,
      [eventId, snapshot.source_payload_fingerprint, snapshot.provider ?? null]
    );
    if (result.rowCount !== 1) throw fail(`POSTGRES_MATCH_MEMORY_MARKET_PROVENANCE_NOT_EXACT:${snapshot.snapshot_id ?? 'UNKNOWN'}`);
    refs.push({ evidenceRole:'MARKET_SNAPSHOT', sourceProvenanceId:result.rows[0].provenance_id,
      sourceEvidenceFingerprint:result.rows[0].evidence_fingerprint });
  }
  return refs.map((row, evidenceSequence) => ({ ...row, evidenceSequence }));
}

function prepareMemory(memory, refs) {
  try { verifyCanonicalMatchMemory(memory); }
  catch (cause) { throw fail('POSTGRES_MATCH_MEMORY_CANONICAL_VERIFICATION_FAILED', cause); }
  if ((memory.evidence.prediction_settlements ?? []).length !== 0) {
    throw fail('POSTGRES_MATCH_MEMORY_SETTLEMENT_SEPARATION_REQUIRED');
  }
  if (memory.governance.authoritative_truth_owner !== 'GATE1' ||
      memory.governance.memory_role !== 'DERIVED_IMMUTABLE_MATERIALIZED_VIEW' ||
      memory.governance.no_hindsight !== true || memory.governance.p002_changed !== false ||
      memory.governance.capital_effect !== 'NONE' || memory.governance.real_money !== 'NO') {
    throw fail('POSTGRES_MATCH_MEMORY_GOVERNANCE_BOUNDARY_VIOLATION');
  }
  hash('MATCH_MEMORY_FINGERPRINT', memory.memory_fingerprint);
  hash('SOURCE_TRUTH_RECORD_FINGERPRINT', memory.governance.source_truth_record_fingerprint);
  const refCore = refs.map(({evidenceSequence,evidenceRole,sourceProvenanceId,sourceEvidenceFingerprint}) =>
    ({evidenceSequence,evidenceRole,sourceProvenanceId,sourceEvidenceFingerprint}));
  return {
    memoryId: text('MATCH_MEMORY_ID', memory.memory_id),
    memoryFingerprint: memory.memory_fingerprint,
    eventId: text('MATCH_MEMORY_EVENT_ID', memory.identity.match_id),
    memoryVersion: text('MATCH_MEMORY_VERSION', memory.memory_version),
    sourceTruthRecordFingerprint: memory.governance.source_truth_record_fingerprint,
    memoryPayloadFingerprint: sha256(memory),
    evidenceSetFingerprint: sha256(refCore),
    materializedAt: iso('MATCH_MEMORY_MATERIALIZED_AT', memory.materialized_at),
    predictionCutoff: nullableIso('MATCH_MEMORY_PREDICTION_CUTOFF', memory.prediction_cutoff),
    memory: structuredClone(memory)
  };
}

async function verifyMemory(client, expected) {
  const result = await client.query(
    `SELECT memory_id,event_id,memory_version,source_truth_record_fingerprint,memory_payload_fingerprint,
            evidence_set_fingerprint,materialized_at,prediction_cutoff,memory_json,truth_owner,memory_role,
            capital_state,real_money FROM reference_match_memory_materializations_v01 WHERE memory_fingerprint=$1`,
    [expected.memoryFingerprint]
  );
  if (result.rowCount !== 1) throw fail('POSTGRES_MATCH_MEMORY_READBACK_MISSING');
  const row = result.rows[0];
  if (row.memory_id !== expected.memoryId || row.event_id !== expected.eventId || row.memory_version !== expected.memoryVersion ||
      row.source_truth_record_fingerprint !== expected.sourceTruthRecordFingerprint ||
      row.memory_payload_fingerprint !== expected.memoryPayloadFingerprint || sha256(row.memory_json) !== expected.memoryPayloadFingerprint ||
      row.evidence_set_fingerprint !== expected.evidenceSetFingerprint || dbIso(row.materialized_at) !== expected.materializedAt ||
      dbIso(row.prediction_cutoff) !== expected.predictionCutoff || row.truth_owner !== 'GATE1' ||
      row.memory_role !== 'DERIVED_IMMUTABLE_MATERIALIZED_VIEW' || row.capital_state !== 'LOCKED' || row.real_money !== 'NO') {
    throw fail(`POSTGRES_MATCH_MEMORY_IMMUTABILITY_CONFLICT:${expected.memoryFingerprint}`);
  }
}

async function insertMemory(client, memory, refs) {
  const row = prepareMemory(memory, refs);
  await client.query(
    `INSERT INTO reference_match_memory_materializations_v01(
       memory_fingerprint,memory_id,event_id,memory_version,source_truth_record_fingerprint,memory_payload_fingerprint,
       evidence_set_fingerprint,materialized_at,prediction_cutoff,memory_json,truth_owner,memory_role,capital_state,real_money
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'GATE1','DERIVED_IMMUTABLE_MATERIALIZED_VIEW','LOCKED','NO')
     ON CONFLICT (memory_fingerprint) DO NOTHING`,
    [row.memoryFingerprint,row.memoryId,row.eventId,row.memoryVersion,row.sourceTruthRecordFingerprint,row.memoryPayloadFingerprint,
      row.evidenceSetFingerprint,row.materializedAt,row.predictionCutoff,JSON.stringify(row.memory)]
  );
  await verifyMemory(client, row);
  for (const ref of refs) {
    const core = { memoryFingerprint:row.memoryFingerprint, evidenceSequence:ref.evidenceSequence,
      evidenceRole:ref.evidenceRole, sourceProvenanceId:ref.sourceProvenanceId,
      sourceEvidenceFingerprint:ref.sourceEvidenceFingerprint };
    const linkFingerprint = sha256(core);
    await client.query(
      `INSERT INTO reference_match_memory_evidence_links_v01(
         memory_fingerprint,evidence_sequence,evidence_role,source_provenance_id,source_evidence_fingerprint,
         link_fingerprint,capital_state,real_money
       ) VALUES($1,$2,$3,$4,$5,$6,'LOCKED','NO')
       ON CONFLICT (memory_fingerprint,evidence_sequence) DO NOTHING`,
      [row.memoryFingerprint,ref.evidenceSequence,ref.evidenceRole,ref.sourceProvenanceId,ref.sourceEvidenceFingerprint,linkFingerprint]
    );
    const check = await client.query(
      `SELECT evidence_role,source_provenance_id,source_evidence_fingerprint,link_fingerprint,capital_state,real_money
         FROM reference_match_memory_evidence_links_v01 WHERE memory_fingerprint=$1 AND evidence_sequence=$2`,
      [row.memoryFingerprint, ref.evidenceSequence]
    );
    const stored = check.rows[0];
    if (check.rowCount !== 1 || stored.evidence_role !== ref.evidenceRole || stored.source_provenance_id !== ref.sourceProvenanceId ||
        stored.source_evidence_fingerprint !== ref.sourceEvidenceFingerprint || stored.link_fingerprint !== linkFingerprint ||
        stored.capital_state !== 'LOCKED' || stored.real_money !== 'NO') {
      throw fail(`POSTGRES_MATCH_MEMORY_LINK_IMMUTABILITY_CONFLICT:${row.memoryFingerprint}:${ref.evidenceSequence}`);
    }
  }
  return row;
}

function isPool(value) {
  return value && typeof value.connect === 'function' && Number.isInteger(value.totalCount) && typeof value.query === 'function';
}

async function acquireTransactionClient(database) {
  if (!database?.query) throw fail('POSTGRES_INGESTION_CLIENT_REQUIRED');
  if (isPool(database)) {
    const client = await database.connect();
    return { client, release: () => client.release() };
  }
  return { client: database, release: () => {} };
}

export async function archiveIngestionProvenanceBundle({ client: database, observations = [], featureLineage = [], matchMemory = null }) {
  if (!Array.isArray(observations) || !Array.isArray(featureLineage)) throw fail('POSTGRES_INGESTION_BUNDLE_ARRAYS_REQUIRED');
  if (observations.length === 0 && featureLineage.length === 0 && matchMemory === null) throw fail('POSTGRES_INGESTION_EMPTY_BUNDLE');
  const preparedObservations = observations.map(prepareIngestionObservation);
  const preparedLineage = featureLineage.map(prepareFeatureProvenanceLineage);
  const seen = new Set();
  for (const row of preparedObservations) {
    if (seen.has(row.provenanceId)) throw fail(`POSTGRES_INGESTION_DUPLICATE_PROVENANCE_ID:${row.provenanceId}`);
    seen.add(row.provenanceId);
  }

  const { client, release } = await acquireTransactionClient(database);
  try {
    await client.query('BEGIN');
    try {
      for (const row of preparedObservations) await insertObservation(client, row);
      for (const row of preparedLineage) await insertLineage(client, row);
      let memoryRecord = null;
      if (matchMemory !== null) {
        const refs = await resolveMemoryRefs(client, matchMemory);
        memoryRecord = await insertMemory(client, matchMemory, refs);
      }
      const bundleFingerprint = sha256({
        observationFingerprints: preparedObservations.map(row => row.evidenceFingerprint),
        lineageFingerprints: preparedLineage.map(row => row.lineageFingerprint),
        matchMemoryFingerprint: memoryRecord?.memoryFingerprint ?? null
      });
      await client.query('COMMIT');
      return Object.freeze({
        version: POSTGRES_INGESTION_PROVENANCE_VERSION,
        status: 'DURABLY_ARCHIVED',
        observationCount: preparedObservations.length,
        lineageCount: preparedLineage.length,
        matchMemoryFingerprint: memoryRecord?.memoryFingerprint ?? null,
        bundleFingerprint,
        capitalState: 'LOCKED',
        realMoney: 'NO'
      });
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => {});
      if (cause?.message?.startsWith('POSTGRES_')) throw cause;
      if (cause?.code === '23503') throw fail('POSTGRES_INGESTION_PROVENANCE_REFERENCE_CONFLICT', cause);
      if (cause?.code === '23505') throw fail('POSTGRES_INGESTION_PROVENANCE_UNIQUE_CONFLICT', cause);
      if (cause?.code === '23514') throw fail('POSTGRES_INGESTION_PROVENANCE_CONSTRAINT_VIOLATION', cause);
      throw fail('POSTGRES_INGESTION_PROVENANCE_TRANSACTION_FAILED', cause);
    }
  } finally {
    release();
  }
}
