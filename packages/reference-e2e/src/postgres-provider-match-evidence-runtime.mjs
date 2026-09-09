import { Pool } from 'pg';

import { ingestRealProviderMatchEvidenceBatch } from '../../intelligence-engine/src/real-provider-match-evidence-ingestion.mjs';
import {
  archiveIngestionProvenanceBundle,
  prepareFeatureProvenanceLineage,
  prepareIngestionObservation
} from './postgres-ingestion-provenance.mjs';
import { prepareProviderMatchEvidencePersistence } from './postgres-provider-match-evidence-persistence.mjs';
import { deepFreeze, sha256 } from './utils.mjs';

export const POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_VERSION =
  'POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_V0_1';

const ACCEPTED_STATES = new Set([
  'ANALYZED',
  'EVIDENCE_READY_MODEL_PENDING',
  'EVIDENCE_READY_MODEL_REJECTED',
  'IDEMPOTENT_REPLAY'
]);

function fail(code, cause) {
  const error = new Error(code);
  if (cause) error.cause = cause;
  return error;
}

function required(name, value) {
  if (typeof value !== 'string' || value.trim() === '') throw fail(name + '_REQUIRED');
  return value.trim();
}

function dbIso(value) {
  if (value === null || value === undefined) return null;
  return new Date(value).toISOString();
}

function assertPlainObject(name, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(name + '_REQUIRED');
  return value;
}

function timingForEvent(timingByEvent, eventId) {
  if (!Object.hasOwn(timingByEvent, eventId)) {
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_EVENT_TIMING_REQUIRED:' + eventId);
  }
  const timing = assertPlainObject(
    'POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_EVENT_TIMING',
    timingByEvent[eventId]
  );
  return {
    observedAt: required('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_OBSERVED_AT', timing.observedAt),
    availableAt: required('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_AVAILABLE_AT', timing.availableAt),
    predictionCutoff: required(
      'POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_PREDICTION_CUTOFF',
      timing.predictionCutoff
    )
  };
}

function assertObservationReadback(row, expected) {
  const fields = [
    ['provenance_id', expected.provenanceId],
    ['observation_id', expected.observationId],
    ['event_id', expected.eventId],
    ['entity_type', expected.entityType],
    ['entity_id', expected.entityId],
    ['evidence_kind', expected.evidenceKind],
    ['provider', expected.provider],
    ['source', expected.source],
    ['source_type', expected.sourceType],
    ['source_url', expected.sourceUrl],
    ['source_payload_fingerprint', expected.sourcePayloadFingerprint],
    ['evidence_fingerprint', expected.evidenceFingerprint],
    ['capital_state', 'LOCKED'],
    ['real_money', 'NO']
  ];
  if (fields.some(([name, value]) => row[name] !== value) ||
      dbIso(row.observed_at) !== expected.observedAt ||
      dbIso(row.available_at) !== expected.availableAt ||
      dbIso(row.captured_at) !== expected.capturedAt ||
      dbIso(row.prediction_cutoff) !== expected.predictionCutoff ||
      row.is_verified !== expected.isVerified ||
      row.pre_match_eligible !== expected.preMatchEligible ||
      sha256(row.payload_json) !== expected.sourcePayloadFingerprint) {
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_OBSERVATION_ATTESTATION_FAILED');
  }
}

function assertFeatureReadback(row, expected) {
  const fields = [
    ['lineage_id', expected.lineageId],
    ['feature_id', expected.featureId],
    ['event_id', expected.eventId],
    ['feature_name', expected.featureName],
    ['feature_version', expected.featureVersion],
    ['feature_fingerprint', expected.featureFingerprint],
    ['source_provenance_id', expected.sourceProvenanceId],
    ['source_evidence_fingerprint', expected.sourceEvidenceFingerprint],
    ['lineage_fingerprint', expected.lineageFingerprint],
    ['capital_state', 'LOCKED'],
    ['real_money', 'NO']
  ];
  if (fields.some(([name, value]) => row[name] !== value) ||
      dbIso(row.created_at) !== expected.createdAt ||
      sha256(row.feature_payload) !== expected.featureFingerprint) {
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_FEATURE_ATTESTATION_FAILED');
  }
}

export function prepareProviderMatchEvidenceBatchPersistence({ providerBatch, timingByEvent }) {
  assertPlainObject('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_BATCH', providerBatch);
  assertPlainObject('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_TIMING_MAP', timingByEvent);

  const ingestionReport = ingestRealProviderMatchEvidenceBatch(providerBatch);
  if (ingestionReport.events_received === 0) {
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_EMPTY_BATCH');
  }
  const rejected = ingestionReport.events.filter((row) => row.state === 'REJECTED');
  if (rejected.length !== 0) {
    const codes = [...new Set(rejected.map((row) => row.error_code ?? 'UNKNOWN'))].sort();
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_BATCH_REJECTED:' + codes.join(','));
  }
  if (ingestionReport.events.some((row) => !ACCEPTED_STATES.has(row.state))) {
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_BATCH_STATE_UNSUPPORTED');
  }

  const uniqueRows = [];
  const bySnapshot = new Map();
  for (const row of ingestionReport.events) {
    const previous = bySnapshot.get(row.evidence_snapshot_id);
    if (previous) {
      if (previous.event_id !== row.event_id ||
          previous.provider_payload_fingerprint !== row.provider_payload_fingerprint ||
          previous.evidence_snapshot_fingerprint !== row.evidence_snapshot_fingerprint) {
        throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_DUPLICATE_NOT_EXACT');
      }
      continue;
    }
    bySnapshot.set(row.evidence_snapshot_id, row);
    uniqueRows.push(row);
  }

  const expectedTimingKeys = [...new Set(uniqueRows.map((row) => row.event_id))].sort();
  const actualTimingKeys = Object.keys(timingByEvent).sort();
  if (sha256(actualTimingKeys) !== sha256(expectedTimingKeys)) {
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_TIMING_SET_NOT_EXACT');
  }

  const bundles = uniqueRows.map((providerEventRow) => prepareProviderMatchEvidencePersistence({
    providerEventRow,
    ...timingForEvent(timingByEvent, providerEventRow.event_id)
  }));
  const observations = bundles.map((bundle) => bundle.observation);
  const featureLineage = bundles.flatMap((bundle) => bundle.featureLineage);
  const events = uniqueRows.map((row, index) => Object.freeze({
    eventId: row.event_id,
    evidenceSnapshotId: row.evidence_snapshot_id,
    evidenceSnapshotFingerprint: row.evidence_snapshot_fingerprint,
    providerPayloadFingerprint: row.provider_payload_fingerprint,
    providerState: row.state,
    decision: row.decision,
    sourceProvenanceId: bundles[index].sourceProvenanceId,
    sourceEvidenceFingerprint: bundles[index].sourceEvidenceFingerprint,
    featureCount: bundles[index].featureLineage.length
  }));

  return deepFreeze({
    version: POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_VERSION,
    batchId: ingestionReport.batch_id,
    provider: ingestionReport.provider,
    sourceType: ingestionReport.source_type,
    capturedAt: ingestionReport.captured_at,
    eventsReceived: ingestionReport.events_received,
    uniqueEventCount: uniqueRows.length,
    duplicateReplayCount: ingestionReport.events_received - uniqueRows.length,
    batchFingerprint: sha256({
      batchId: ingestionReport.batch_id,
      provider: ingestionReport.provider,
      sourceType: ingestionReport.source_type,
      capturedAt: ingestionReport.captured_at,
      events
    }),
    observations,
    featureLineage,
    events,
    governance: {
      strictBatch: true,
      oneTransaction: true,
      rawProviderPayloadStoredInParallelStore: false,
      predictionIsNotValidationOrExecution: true,
      settlementSeparate: true,
      gate1TruthOwner: true,
      gate6CapitalOwner: true,
      p002Unchanged: true,
      capitalState: 'LOCKED',
      realMoney: 'NO',
      automaticPromotionOrRetuning: false
    }
  });
}

export async function archiveProviderMatchEvidenceBatchPersistence({
  client,
  providerBatch,
  timingByEvent
}) {
  if (!client?.query) throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_CLIENT_REQUIRED');
  const prepared = prepareProviderMatchEvidenceBatchPersistence({ providerBatch, timingByEvent });
  const archive = await archiveIngestionProvenanceBundle({
    client,
    observations: prepared.observations,
    featureLineage: prepared.featureLineage
  });
  return deepFreeze({
    version: POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_VERSION,
    status: 'DURABLY_ARCHIVED',
    batchId: prepared.batchId,
    batchFingerprint: prepared.batchFingerprint,
    provider: prepared.provider,
    sourceType: prepared.sourceType,
    capturedAt: prepared.capturedAt,
    eventsReceived: prepared.eventsReceived,
    persistedEventCount: prepared.uniqueEventCount,
    duplicateReplayCount: prepared.duplicateReplayCount,
    events: prepared.events,
    archive,
    governance: prepared.governance
  });
}

export async function attestProviderMatchEvidencePersistence({ client, sourceProvenanceId }) {
  if (!client?.query) throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_CLIENT_REQUIRED');
  const provenanceId = required(
    'POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_SOURCE_PROVENANCE_ID',
    sourceProvenanceId
  );
  let observationResult;
  try {
    observationResult = await client.query(
      `SELECT provenance_id,observation_id,event_id,entity_type,entity_id,evidence_kind,provider,
              source,source_type,source_url,observed_at,available_at,captured_at,prediction_cutoff,
              is_verified,pre_match_eligible,source_payload_fingerprint,evidence_fingerprint,
              payload_json,capital_state,real_money
         FROM reference_ingestion_observations_v01
        WHERE provenance_id=$1`,
      [provenanceId]
    );
  } catch (cause) {
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_ATTESTATION_READ_FAILED', cause);
  }
  if (observationResult.rowCount !== 1) {
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_ATTESTATION_MISSING');
  }
  const observation = observationResult.rows[0];
  const payload = observation.payload_json;
  const providerEventRow = {
    state: 'EVIDENCE_READY_MODEL_PENDING',
    event_id: observation.event_id,
    evidence_snapshot_id: observation.entity_id,
    evidence_snapshot_fingerprint: payload?.evidence_snapshot_fingerprint,
    provider_payload_fingerprint: payload?.provider_payload_fingerprint,
    provider_event_id: payload?.provider_event_id ?? null,
    provider: observation.provider,
    snapshot: payload?.snapshot,
    analysis: null
  };
  let bundle;
  try {
    bundle = prepareProviderMatchEvidencePersistence({
      providerEventRow,
      observedAt: dbIso(observation.observed_at),
      availableAt: dbIso(observation.available_at),
      predictionCutoff: dbIso(observation.prediction_cutoff)
    });
  } catch (cause) {
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_OBSERVATION_ATTESTATION_FAILED', cause);
  }
  const expectedObservation = prepareIngestionObservation(bundle.observation);
  assertObservationReadback(observation, expectedObservation);

  let lineageResult;
  try {
    lineageResult = await client.query(
      `SELECT lineage_id,feature_id,event_id,feature_name,feature_version,feature_fingerprint,
              feature_payload,source_provenance_id,source_evidence_fingerprint,lineage_fingerprint,
              created_at,capital_state,real_money
         FROM reference_feature_provenance_lineage_v01
        WHERE source_provenance_id=$1 AND source_evidence_fingerprint=$2
        ORDER BY lineage_id`,
      [expectedObservation.provenanceId, expectedObservation.evidenceFingerprint]
    );
  } catch (cause) {
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_ATTESTATION_READ_FAILED', cause);
  }
  const expectedFeatures = bundle.featureLineage
    .map(prepareFeatureProvenanceLineage)
    .sort((left, right) => left.lineageId.localeCompare(right.lineageId));
  if (lineageResult.rowCount !== expectedFeatures.length) {
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_FEATURE_SET_INCOMPLETE');
  }
  for (let index = 0; index < expectedFeatures.length; index += 1) {
    assertFeatureReadback(lineageResult.rows[index], expectedFeatures[index]);
  }

  return deepFreeze({
    version: POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_VERSION,
    status: 'ATTESTED',
    eventId: observation.event_id,
    evidenceSnapshotId: observation.entity_id,
    evidenceSnapshotFingerprint: payload.evidence_snapshot_fingerprint,
    providerPayloadFingerprint: payload.provider_payload_fingerprint,
    sourceProvenanceId: expectedObservation.provenanceId,
    sourceEvidenceFingerprint: expectedObservation.evidenceFingerprint,
    sourcePayloadFingerprint: expectedObservation.sourcePayloadFingerprint,
    featureCount: expectedFeatures.length,
    featureSetFingerprint: sha256(expectedFeatures.map((row) => ({
      lineageId: row.lineageId,
      featureFingerprint: row.featureFingerprint,
      lineageFingerprint: row.lineageFingerprint
    }))),
    preMatchEligible: expectedObservation.preMatchEligible,
    archivedFingerprintsRecomputed: true,
    providerPayloadFingerprintPresenceVerified: true,
    providerPayloadFingerprintRecomputed: false,
    exactEventBound: true,
    exactFeatureSet: true,
    rawSnapshotReturned: false,
    settlementSeparate: true,
    predictionIsNotValidationOrExecution: true,
    capitalState: 'LOCKED',
    realMoney: 'NO'
  });
}

export async function runProviderMatchEvidencePersistence({
  databaseUrl = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL,
  pool = null,
  providerBatch,
  timingByEvent
}) {
  if (!pool && !databaseUrl) throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_DATABASE_URL_REQUIRED');
  const ownedPool = pool ? null : new Pool({
    connectionString: databaseUrl,
    application_name: 'sports_provider_match_evidence_runtime_v0_1'
  });
  const effectivePool = pool ?? ownedPool;
  let client;
  try {
    client = await effectivePool.connect();
    await client.query('SELECT 1');
    const archived = await archiveProviderMatchEvidenceBatchPersistence({
      client,
      providerBatch,
      timingByEvent
    });
    const attestations = [];
    for (const event of archived.events) {
      attestations.push(await attestProviderMatchEvidencePersistence({
        client,
        sourceProvenanceId: event.sourceProvenanceId
      }));
    }
    if (attestations.length !== archived.persistedEventCount ||
        attestations.some((row) => row.status !== 'ATTESTED')) {
      throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_ATTESTATION_INCOMPLETE');
    }
    return deepFreeze({
      ...archived,
      status: 'DURABLY_ARCHIVED_AND_ATTESTED',
      attestations,
      operational: {
        oneDedicatedPoolClient: true,
        clientReleasedByRuntime: true,
        ownedPoolClosedByRuntime: ownedPool !== null,
        failClosed: true,
        rawProviderPayloadReturned: false
      }
    });
  } catch (cause) {
    if (cause?.message?.startsWith('POSTGRES_')) throw cause;
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_FAIL_CLOSED', cause);
  } finally {
    client?.release();
    if (ownedPool) await ownedPool.end();
  }
}
