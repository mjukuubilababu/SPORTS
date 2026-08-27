import { sha256 } from './utils.mjs';
import { verifyCanonicalMatchMemory } from '../../intelligence-engine/src/canonical-match-memory.mjs';

export const POSTGRES_INGESTION_PROVENANCE_VERSION = 'v0.1';

function provenanceError(code, cause) {
  const error = new Error(code);
  if (cause) error.cause = cause;
  return error;
}

function requiredString(name, value) {
  if (typeof value !== 'string' || value.trim() === '') throw provenanceError(`${name}_REQUIRED`);
  return value;
}

function normalizeIso(name, value) {
  requiredString(name, value);
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw provenanceError(`${name}_INVALID`);
  return new Date(epoch).toISOString();
}

function nullableIso(name, value) {
  return value == null ? null : normalizeIso(name, value);
}

function requiredHash(name, value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw provenanceError(`${name}_INVALID`);
  }
  return value;
}

function timestampEpoch(value) {
  return Date.parse(value);
}

function dbIso(value) {
  return value == null ? null : new Date(value).toISOString();
}

function canonicalObservationCore(row) {
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
  if (!input || typeof input !== 'object') throw provenanceError('POSTGRES_INGESTION_OBSERVATION_REQUIRED');
  requiredString('EVENT_ID', input.eventId);
  requiredString('SOURCE', input.source);
  requiredString('SOURCE_TYPE', input.sourceType);

  const evidenceKind = requiredString('EVIDENCE_KIND', input.evidenceKind).toUpperCase();
  if (evidenceKind === 'SETTLEMENT' || evidenceKind === 'PREDICTION_SETTLEMENT') {
    throw provenanceError('POSTGRES_INGESTION_SETTLEMENT_BOUNDARY_VIOLATION');
  }
  if (input.payload === undefined || input.payload === null) {
    throw provenanceError('POSTGRES_INGESTION_SOURCE_PAYLOAD_REQUIRED');
  }

  const observedAt = normalizeIso('OBSERVED_AT', input.observedAt);
  const availableAt = normalizeIso('AVAILABLE_AT', input.availableAt);
  const capturedAt = normalizeIso('CAPTURED_AT', input.capturedAt);
  const predictionCutoff = nullableIso('PREDICTION_CUTOFF', input.predictionCutoff);
  if (timestampEpoch(availableAt) < timestampEpoch(observedAt)) {
    throw provenanceError('POSTGRES_INGESTION_AVAILABLE_BEFORE_OBSERVED');
  }
  if (timestampEpoch(capturedAt) < timestampEpoch(availableAt)) {
    throw provenanceError('POSTGRES_INGESTION_CAPTURE_BEFORE_AVAILABLE');
  }

  const isVerified = input.isVerified === true;
  const preMatchEligible = predictionCutoff !== null
    && isVerified
    && timestampEpoch(availableAt) <= timestampEpoch(predictionCutoff)
    && timestampEpoch(capturedAt) <= timestampEpoch(predictionCutoff);
  const sourcePayloadFingerprint = sha256(input.payload);
  const observationId = input.observationId ?? `OBS-${sha256({
    eventId: input.eventId,
    evidenceKind,
    source: input.source,
    observedAt,
    capturedAt,
    sourcePayloadFingerprint
  }).slice(0, 24)}`;
  requiredString('OBSERVATION_ID', observationId);
  const provenanceId = input.provenanceId ?? `PROV-${sha256({
    observationId,
    eventId: input.eventId,
    sourcePayloadFingerprint
  }).slice(0, 24)}`;
  requiredString('PROVENANCE_ID', provenanceId);

  const core = canonicalObservationCore({
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

async function verifyExistingObservation(client, expected) {
  const readback = await client.query(
    `SELECT provenance_id, observation_id, event_id, entity_type, entity_id, evidence_kind,
            provider, source, source_type, source_url, observed_at, available_at, captured_at,
            prediction_cutoff, is_verified, pre_match_eligible, source_payload_fingerprint,
            evidence_fingerprint, payload_json, capital_state, real_money
       FROM reference_ingestion_observations_v01
      WHERE provenance_id=$1`,
    [expected.provenanceId]
  );
  if (readback.rowCount !== 1) throw provenanceError('POSTGRES_INGESTION_OBSERVATION_READBACK_MISSING');
  const row = readback.rows[0];
  const storedCore = canonicalObservationCore({
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
  if (
    sha256(storedCore) !== expected.evidenceFingerprint ||
    row.evidence_fingerprint !== expected.evidenceFingerprint ||
    row.source_payload_fingerprint !== expected.sourcePayloadFingerprint ||
    sha256(row.payload_json) !== expected.sourcePayloadFingerprint ||
    row.capital_state !== 'LOCKED' ||
    row.real_money !== 'NO'
  ) {
    throw provenanceError(`POSTGRES_INGESTION_OBSERVATION_IMMUTABILITY_CONFLICT:${expected.provenanceId}`);
  }
}

async function insertObservation(client, observation) {
  await client.query(
    `INSERT INTO reference_ingestion_observations_v01(
       provenance_id, observation_id, event_id, entity_type, entity_id, evidence_kind,
       provider, source, source_type, source_url, observed_at, available_at, captured_at,
       prediction_cutoff, is_verified, pre_match_eligible, source_payload_fingerprint,
       evidence_fingerprint, payload_json, capital_state, real_money
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,'LOCKED','NO')
     ON CONFLICT (provenance_id) DO NOTHING`,
    [
      observation.provenanceId,
      observation.observationId,
      observation.eventId,
      observation.entityType,
      observation.entityId,
      observation.evidenceKind,
      observation.provider,
      observation.source,
      observation.sourceType,
      observation.sourceUrl,
      observation.observedAt,
      observation.availableAt,
      observation.capturedAt,
      observation.predictionCutoff,
      observation.isVerified,
      observation.preMatchEligible,
      observation.sourcePayloadFingerprint,
      observation.evidenceFingerprint,
      JSON.stringify(observation.payload)
    ]
  );
  await verifyExistingObservation(client, observation);
}

function canonicalLineageCore(row) {
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
  if (!input || typeof input !== 'object') throw provenanceError('POSTGRES_FEATURE_LINEAGE_REQUIRED');
  requiredString('FEATURE_ID', input.featureId);
  requiredString('EVENT_ID', input.eventId);
  requiredString('FEATURE_NAME', input.featureName);
  requiredString('FEATURE_VERSION', input.featureVersion);
  requiredString('SOURCE_PROVENANCE_ID', input.sourceProvenanceId);
  requiredHash('SOURCE_EVIDENCE_FINGERPRINT', input.sourceEvidenceFingerprint);
  if (input.featurePayload === undefined || input.featurePayload === null) {
    throw provenanceError('POSTGRES_FEATURE_PAYLOAD_REQUIRED');
  }
  const featureFingerprint = sha256(input.featurePayload);
  const createdAt = normalizeIso('FEATURE_LINEAGE_CREATED_AT', input.createdAt);
  const lineageId = input.lineageId ?? `LINEAGE-${sha256({
    featureId: input.featureId,
    sourceProvenanceId: input.sourceProvenanceId,
    sourceEvidenceFingerprint: input.sourceEvidenceFingerprint
  }).slice(0, 24)}`;
  requiredString('LINEAGE_ID', lineageId);
  const core = canonicalLineageCore({
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

async function verifyExistingLineage(client, expected) {
  const readback = await client.query(
    `SELECT lineage_id, feature_id, event_id, feature_name, feature_version,
            feature_fingerprint, source_provenance_id, source_evidence_fingerprint,
            lineage_fingerprint, created_at, capital_state, real_money
       FROM reference_feature_provenance_lineage_v01
      WHERE lineage_id=$1`,
    [expected.lineageId]
  );
  if (readback.rowCount !== 1) throw provenanceError('POSTGRES_FEATURE_LINEAGE_READBACK_MISSING');
  const row = readback.rows[0];
  const storedCore = canonicalLineageCore({
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
  if (
    sha256(storedCore) !== expected.lineageFingerprint ||
    row.lineage_fingerprint !== expected.lineageFingerprint ||
    row.capital_state !== 'LOCKED' ||
    row.real_money !== 'NO'
  ) {
    throw provenanceError(`POSTGRES_FEATURE_LINEAGE_IMMUTABILITY_CONFLICT:${expected.lineageId}`);
  }
}

async function insertFeatureLineage(client, lineage) {
  await client.query(
    `INSERT INTO reference_feature_provenance_lineage_v01(
       lineage_id, feature_id, event_id, feature_name, feature_version, feature_fingerprint,
       source_provenance_id, source_evidence_fingerprint, lineage_fingerprint, created_at,
       capital_state, real_money
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'LOCKED','NO')
     ON CONFLICT (lineage_id) DO NOTHING`,
    [
      lineage.lineageId,
      lineage.featureId,
      lineage.eventId,
      lineage.featureName,
      lineage.featureVersion,
      lineage.featureFingerprint,
      lineage.sourceProvenanceId,
      lineage.sourceEvidenceFingerprint,
      lineage.lineageFingerprint,
      lineage.createdAt
    ]
  );
  await verifyExistingLineage(client, lineage);
}

async function resolveMatchMemoryEvidence(client, memory) {
  const eventId = memory.identity.match_id;
  const refs = [];
  for (const observation of memory.evidence.observations ?? []) {
    requiredString('MATCH_MEMORY_PROVENANCE_ID', observation.provenance_id);
    const result = await client.query(
      `SELECT provenance_id, event_id, evidence_fingerprint
         FROM reference_ingestion_observations_v01
        WHERE provenance_id=$1`,
      [observation.provenance_id]
    );
    if (result.rowCount !== 1 || result.rows[0].event_id !== eventId) {
      throw provenanceError(`POSTGRES_MATCH_MEMORY_OBSERVATION_PROVENANCE_MISSING:${observation.provenance_id}`);
    }
    refs.push({
      evidenceRole: 'OBSERVATION',
      sourceProvenanceId: result.rows[0].provenance_id,
      sourceEvidenceFingerprint: result.rows[0].evidence_fingerprint
    });
  }

  for (const snapshot of memory.evidence.market_snapshots ?? []) {
    requiredHash('MATCH_MEMORY_MARKET_SOURCE_PAYLOAD_FINGERPRINT', snapshot.source_payload_fingerprint);
    const result = await client.query(
      `SELECT provenance_id, evidence_fingerprint
         FROM reference_ingestion_observations_v01
        WHERE event_id=$1
          AND evidence_kind='MARKET_SNAPSHOT'
          AND source_payload_fingerprint=$2
          AND provider IS NOT DISTINCT FROM $3`,
      [eventId, snapshot.source_payload_fingerprint, snapshot.provider ?? null]
    );
    if (result.rowCount !== 1) {
      throw provenanceError(`POSTGRES_MATCH_MEMORY_MARKET_PROVENANCE_NOT_EXACT:${snapshot.snapshot_id ?? 'UNKNOWN'}`);
    }
    refs.push({
      evidenceRole: 'MARKET_SNAPSHOT',
      sourceProvenanceId: result.rows[0].provenance_id,
      sourceEvidenceFingerprint: result.rows[0].evidence_fingerprint
    });
  }
  return refs.map((ref, evidenceSequence) => ({ ...ref, evidenceSequence }));
}

function prepareMatchMemoryRecord(memory, refs) {
  try {
    verifyCanonicalMatchMemory(memory);
  } catch (cause) {
    throw provenanceError('POSTGRES_MATCH_MEMORY_CANONICAL_VERIFICATION_FAILED', cause);
  }
  if ((memory.evidence.prediction_settlements ?? []).length !== 0) {
    throw provenanceError('POSTGRES_MATCH_MEMORY_SETTLEMENT_SEPARATION_REQUIRED');
  }
  if (
    memory.governance.authoritative_truth_owner !== 'GATE1' ||
    memory.governance.memory_role !== 'DERIVED_IMMUTABLE_MATERIALIZED_VIEW' ||
    memory.governance.no_hindsight !== true ||
    memory.governance.p002_changed !== false ||
    memory.governance.capital_effect !== 'NONE' ||
    memory.governance.real_money !== 'NO'
  ) {
    throw provenanceError('POSTGRES_MATCH_MEMORY_GOVERNANCE_BOUNDARY_VIOLATION');
  }
  requiredHash('MATCH_MEMORY_FINGERPRINT', memory.memory_fingerprint);
  requiredHash('SOURCE_TRUTH_RECORD_FINGERPRINT', memory.governance.source_truth_record_fingerprint);
  const materializedAt = normalizeIso('MATCH_MEMORY_MATERIALIZED_AT', memory.materialized_at);
  const predictionCutoff = nullableIso('MATCH_MEMORY_PREDICTION_CUTOFF', memory.prediction_cutoff);
  const memoryPayloadFingerprint = sha256(memory);
  const evidenceSetFingerprint = sha256(refs.map((ref) => ({
    evidenceSequence: ref.evidenceSequence,
    evidenceRole: ref.evidenceRole,
    sourceProvenanceId: ref.sourceProvenanceId,
    sourceEvidenceFingerprint: ref.sourceEvidenceFingerprint
  })));
  return {
    memoryId: requiredString('MATCH_MEMORY_ID', memory.memory_id),
    memoryFingerprint: memory.memory_fingerprint,
    eventId: requiredString('MATCH_MEMORY_EVENT_ID', memory.identity.match_id),
    memoryVersion: requiredString('MATCH_MEMORY_VERSION', memory.memory_version),
    sourceTruthRecordFingerprint: memory.governance.source_truth_record_fingerprint,
    memoryPayloadFingerprint,
    evidenceSetFingerprint,
    materializedAt,
    predictionCutoff,
    memory: structuredClone(memory)
  };
}

async function verifyExistingMemory(client, expected) {
  const readback = await client.query(
    `SELECT memory_id, event_id, memory_version, source_truth_record_fingerprint,
            memory_payload_fingerprint, evidence_set_fingerprint, materialized_at,
            prediction_cutoff, memory_json, truth_owner, memory_role, capital_state, real_money
       FROM reference_match_memory_materializations_v01
      WHERE memory_fingerprint=$1`,
    [expected.memoryFingerprint]
  );
  if (readback.rowCount !== 1) throw provenanceError('POSTGRES_MATCH_MEMORY_READBACK_MISSING');
  const row = readback.rows[0];
  if (
    row.memory_id !== expected.memoryId ||
    row.event_id !== expected.eventId ||
    row.memory_version !== expected.memoryVersion ||
    row.source_truth_record_fingerprint !== expected.sourceTruthRecordFingerprint ||
    row.memory_payload_fingerprint !== expected.memoryPayloadFingerprint ||
    sha256(row.memory_json) !== expected.memoryPayloadFingerprint ||
    row.evidence_set_fingerprint !== expected.evidenceSetFingerprint ||
    dbIso(row.materialized_at) !== expected.materializedAt ||
    dbIso(row.prediction_cutoff) !== expected.predictionCutoff ||
    row.truth_owner !== 'GATE1' ||
    row.memory_role !== 'DERIVED_IMMUTABLE_MATERIALIZED_VIEW' ||
    row.capital_state !== 'LOCKED' ||
    row.real_money !== 'NO'
  ) {
    throw provenanceError(`POSTGRES_MATCH_MEMORY_IMMUTABILITY_CONFLICT:${expected.memoryFingerprint}`);
  }
}

async function insertMatchMemory(client, memory, refs) {
  const prepared = prepareMatchMemoryRecord(memory, refs);
  await client.query(
    `INSERT INTO reference_match_memory_materializations_v01(
       memory_fingerprint, memory_id, event_id, memory_version, source_truth_record_fingerprint,
       memory_payload_fingerprint, evidence_set_fingerprint, materialized_at, prediction_cutoff,
       memory_json, truth_owner, memory_role, capital_state, real_money
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'GATE1','DERIVED_IMMUTABLE_MATERIALIZED_VIEW','LOCKED','NO')
     ON CONFLICT (memory_fingerprint) DO NOTHING`,
    [
      prepared.memoryFingerprint,
      prepared.memoryId,
      prepared.eventId,
      prepared.memoryVersion,
      prepared.sourceTruthRecordFingerprint,
      prepared.memoryPayloadFingerprint,
      prepared.evidenceSetFingerprint,
      prepared.materializedAt,
      prepared.predictionCutoff,
      JSON.stringify(prepared.memory)
    ]
  );
  await verifyExistingMemory(client, prepared);

  for (const ref of refs) {
    const linkCore = {
      memoryFingerprint: prepared.memoryFingerprint,
      evidenceSequence: ref.evidenceSequence,
      evidenceRole: ref.evidenceRole,
      sourceProvenanceId: ref.sourceProvenanceId,
      sourceEvidenceFingerprint: ref.sourceEvidenceFingerprint
    };
    const linkFingerprint = sha256(linkCore);
    await client.query(
      `INSERT INTO reference_match_memory_evidence_links_v01(
         memory_fingerprint, evidence_sequence, evidence_role, source_provenance_id,
         source_evidence_fingerprint, link_fingerprint, capital_state, real_money
       ) VALUES($1,$2,$3,$4,$5,$6,'LOCKED','NO')
       ON CONFLICT (memory_fingerprint, evidence_sequence) DO NOTHING`,
      [
        prepared.memoryFingerprint,
        ref.evidenceSequence,
        ref.evidenceRole,
        ref.sourceProvenanceId,
        ref.sourceEvidenceFingerprint,
        linkFingerprint
      ]
    );
    const linkReadback = await client.query(
      `SELECT evidence_role, source_provenance_id, source_evidence_fingerprint,
              link_fingerprint, capital_state, real_money
         FROM reference_match_memory_evidence_links_v01
        WHERE memory_fingerprint=$1 AND evidence_sequence=$2`,
      [prepared.memoryFingerprint, ref.evidenceSequence]
    );
    if (
      linkReadback.rowCount !== 1 ||
      linkReadback.rows[0].evidence_role !== ref.evidenceRole ||
      linkReadback.rows[0].source_provenance_id !== ref.sourceProvenanceId ||
      linkReadback.rows[0].source_evidence_fingerprint !== ref.sourceEvidenceFingerprint ||
      linkReadback.rows[0].link_fingerprint !== linkFingerprint ||
      linkReadback.rows[0].capital_state !== 'LOCKED' ||
      linkReadback.rows[0].real_money !== 'NO'
    ) {
      throw provenanceError(`POSTGRES_MATCH_MEMORY_LINK_IMMUTABILITY_CONFLICT:${prepared.memoryFingerprint}:${ref.evidenceSequence}`);
    }
  }
  return prepared;
}

export async function archiveIngestionProvenanceBundle({
  client,
  observations = [],
  featureLineage = [],
  matchMemory = null
}) {
  if (!client?.query) throw provenanceError('POSTGRES_INGESTION_CLIENT_REQUIRED');
  if (!Array.isArray(observations) || !Array.isArray(featureLineage)) {
    throw provenanceError('POSTGRES_INGESTION_BUNDLE_ARRAYS_REQUIRED');
  }
  if (observations.length === 0 && featureLineage.length === 0 && matchMemory === null) {
    throw provenanceError('POSTGRES_INGESTION_EMPTY_BUNDLE');
  }

  const preparedObservations = observations.map(prepareIngestionObservation);
  const preparedLineage = featureLineage.map(prepareFeatureProvenanceLineage);
  const seenProvenance = new Set();
  for (const observation of preparedObservations) {
    if (seenProvenance.has(observation.provenanceId)) {
      throw provenanceError(`POSTGRES_INGESTION_DUPLICATE_PROVENANCE_ID:${observation.provenanceId}`);
    }
    seenProvenance.add(observation.provenanceId);
  }

  await client.query('BEGIN');
  try {
    for (const observation of preparedObservations) await insertObservation(client, observation);
    for (const lineage of preparedLineage) await insertFeatureLineage(client, lineage);

    let memoryRecord = null;
    if (matchMemory !== null) {
      const refs = await resolveMatchMemoryEvidence(client, matchMemory);
      memoryRecord = await insertMatchMemory(client, matchMemory, refs);
    }

    const bundleFingerprint = sha256({
      observationFingerprints: preparedObservations.map((row) => row.evidenceFingerprint),
      lineageFingerprints: preparedLineage.map((row) => row.lineageFingerprint),
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
    if (cause?.code === '23503') throw provenanceError('POSTGRES_INGESTION_PROVENANCE_REFERENCE_CONFLICT', cause);
    if (cause?.code === '23505') throw provenanceError('POSTGRES_INGESTION_PROVENANCE_UNIQUE_CONFLICT', cause);
    if (cause?.code === '23514') throw provenanceError('POSTGRES_INGESTION_PROVENANCE_CONSTRAINT_VIOLATION', cause);
    throw provenanceError('POSTGRES_INGESTION_PROVENANCE_TRANSACTION_FAILED', cause);
  }
}
