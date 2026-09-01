import { verifyMatchEvidenceSnapshot } from '../../intelligence-engine/src/match-evidence-analysis.mjs';
import {
  archiveIngestionProvenanceBundle,
  prepareFeatureProvenanceLineage,
  prepareIngestionObservation
} from './postgres-ingestion-provenance.mjs';
import { sha256 } from './utils.mjs';

export const POSTGRES_PROVIDER_MATCH_EVIDENCE_PERSISTENCE_VERSION =
  'POSTGRES_PROVIDER_MATCH_EVIDENCE_PERSISTENCE_V0_1';

const ACCEPTED_PROVIDER_STATES = new Set([
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

function iso(name, value) {
  const parsed = Date.parse(required(name, value));
  if (!Number.isFinite(parsed)) throw fail(name + '_INVALID');
  return new Date(parsed).toISOString();
}

function hash(name, value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw fail(name + '_INVALID');
  return value;
}

function featureRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.hasOwn(value, 'value') &&
    Object.hasOwn(value, 'status') &&
    Object.hasOwn(value, 'source') &&
    Object.hasOwn(value, 'source_type') &&
    Object.hasOwn(value, 'captured_at') &&
    Object.hasOwn(value, 'feature_version') &&
    Object.hasOwn(value, 'provider') &&
    Object.hasOwn(value, 'confidence');
}

function collectFeatureRecords(value, path = [], output = []) {
  if (featureRecord(value)) {
    output.push({ path: path.join('.'), record: value });
    return output;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  for (const key of Object.keys(value).sort()) {
    collectFeatureRecords(value[key], [...path, key], output);
  }
  return output;
}

function assertFeatureRecord({ path, record, snapshot }) {
  required('POSTGRES_MATCH_EVIDENCE_FEATURE_PATH', path);
  if (record.feature_version !== snapshot.feature_version) {
    throw fail('POSTGRES_MATCH_EVIDENCE_FEATURE_VERSION_MISMATCH:' + path);
  }
  if (
    record.provider !== snapshot.source_provider ||
    record.source_type !== snapshot.source_type ||
    iso('POSTGRES_MATCH_EVIDENCE_FEATURE_CAPTURED_AT', record.captured_at) !== snapshot.captured_at ||
    sha256(record.source) !== sha256(snapshot.source)
  ) {
    throw fail('POSTGRES_MATCH_EVIDENCE_FEATURE_SOURCE_NOT_EXACT:' + path);
  }
  if (!Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1) {
    throw fail('POSTGRES_MATCH_EVIDENCE_FEATURE_CONFIDENCE_INVALID:' + path);
  }
  if (record.event_time !== null && record.event_time !== undefined) {
    const eventTime = iso('POSTGRES_MATCH_EVIDENCE_FEATURE_EVENT_TIME', record.event_time);
    if (Date.parse(eventTime) > Date.parse(snapshot.captured_at) ||
        Date.parse(eventTime) >= Date.parse(snapshot.kickoff_at)) {
      throw fail('POSTGRES_MATCH_EVIDENCE_FEATURE_POST_SNAPSHOT_OR_KICKOFF:' + path);
    }
  }
}

function assertProviderEventRow(row) {
  if (!row || typeof row !== 'object') throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_ROW_REQUIRED');
  if (!ACCEPTED_PROVIDER_STATES.has(row.state)) {
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_ROW_NOT_ACCEPTED');
  }
  const eventId = required('POSTGRES_PROVIDER_MATCH_EVIDENCE_EVENT_ID', row.event_id);
  const snapshotId = required('POSTGRES_PROVIDER_MATCH_EVIDENCE_SNAPSHOT_ID', row.evidence_snapshot_id);
  const provider = required('POSTGRES_PROVIDER_MATCH_EVIDENCE_PROVIDER', row.provider);
  const providerPayloadFingerprint = hash(
    'POSTGRES_PROVIDER_MATCH_EVIDENCE_PROVIDER_PAYLOAD_FINGERPRINT',
    row.provider_payload_fingerprint
  );
  const snapshotFingerprint = hash(
    'POSTGRES_PROVIDER_MATCH_EVIDENCE_SNAPSHOT_FINGERPRINT',
    row.evidence_snapshot_fingerprint
  );
  const snapshot = row.snapshot;
  try {
    verifyMatchEvidenceSnapshot(snapshot);
  } catch (cause) {
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_SNAPSHOT_INVALID', cause);
  }
  if (
    snapshot.event_id !== eventId ||
    snapshot.evidence_snapshot_id !== snapshotId ||
    snapshot.fingerprint !== snapshotFingerprint
  ) {
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_ROW_SNAPSHOT_IDENTITY_MISMATCH');
  }
  if (
    snapshot.source_provider !== provider ||
    snapshot.source?.provider !== provider ||
    snapshot.source_type !== snapshot.source?.source_type ||
    snapshot.source_reference !== snapshot.source?.source_reference ||
    snapshot.captured_at !== snapshot.source?.captured_at
  ) {
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_ROW_SOURCE_MISMATCH');
  }
  if (Date.parse(snapshot.captured_at) >= Date.parse(snapshot.kickoff_at)) {
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_POST_KICKOFF_SNAPSHOT');
  }
  if (row.analysis !== null && row.analysis !== undefined) {
    if (
      row.analysis.event_id !== eventId ||
      row.analysis.evidence_snapshot_id !== snapshotId ||
      row.analysis.evidence_snapshot_fingerprint !== snapshotFingerprint ||
      iso('POSTGRES_PROVIDER_MATCH_EVIDENCE_ANALYSIS_GENERATED_AT', row.analysis.generated_at) !== snapshot.captured_at
    ) {
      throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_ANALYSIS_SNAPSHOT_MISMATCH');
    }
  }
  return {
    eventId,
    snapshotId,
    provider,
    providerPayloadFingerprint,
    snapshotFingerprint,
    snapshot
  };
}

export function prepareProviderMatchEvidencePersistence({
  providerEventRow,
  observedAt,
  availableAt,
  predictionCutoff
}) {
  const verified = assertProviderEventRow(providerEventRow);
  const observed = iso('POSTGRES_PROVIDER_MATCH_EVIDENCE_OBSERVED_AT', observedAt);
  const available = iso('POSTGRES_PROVIDER_MATCH_EVIDENCE_AVAILABLE_AT', availableAt);
  const cutoff = iso('POSTGRES_PROVIDER_MATCH_EVIDENCE_PREDICTION_CUTOFF', predictionCutoff);
  if (Date.parse(cutoff) >= Date.parse(verified.snapshot.kickoff_at)) {
    throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_PREDICTION_CUTOFF_NOT_PREMATCH');
  }

  const identityFingerprint = sha256({
    evidenceSnapshotId: verified.snapshotId
  });
  const sourcePayload = Object.freeze({
    schema_version: POSTGRES_PROVIDER_MATCH_EVIDENCE_PERSISTENCE_VERSION,
    event_id: verified.eventId,
    evidence_snapshot_id: verified.snapshotId,
    evidence_snapshot_fingerprint: verified.snapshotFingerprint,
    provider_payload_fingerprint: verified.providerPayloadFingerprint,
    provider_event_id: providerEventRow.provider_event_id ?? null,
    snapshot: structuredClone(verified.snapshot)
  });
  const observation = {
    provenanceId: 'PROV-MATCH-EVIDENCE-' + identityFingerprint.slice(0, 24),
    observationId: 'OBS-MATCH-EVIDENCE-' + identityFingerprint.slice(0, 24),
    eventId: verified.eventId,
    entityType: 'MATCH_EVIDENCE_SNAPSHOT',
    entityId: verified.snapshotId,
    evidenceKind: 'MATCH_EVIDENCE_SNAPSHOT',
    provider: verified.provider,
    source: verified.snapshot.source_reference,
    sourceType: verified.snapshot.source_type,
    sourceUrl: /^https?:\/\//i.test(verified.snapshot.source_reference)
      ? verified.snapshot.source_reference
      : null,
    observedAt: observed,
    availableAt: available,
    capturedAt: verified.snapshot.captured_at,
    predictionCutoff: cutoff,
    isVerified: verified.snapshot.source.verified === true,
    payload: sourcePayload
  };
  const preparedObservation = prepareIngestionObservation(observation);

  const records = collectFeatureRecords(verified.snapshot.features);
  if (records.length === 0) throw fail('POSTGRES_PROVIDER_MATCH_EVIDENCE_FEATURES_REQUIRED');
  const featureLineage = records.map(({ path, record }) => {
    assertFeatureRecord({ path, record, snapshot: verified.snapshot });
    const featureName = 'match_evidence.' + path;
    const featurePayload = {
      schema_version: POSTGRES_PROVIDER_MATCH_EVIDENCE_PERSISTENCE_VERSION,
      event_id: verified.eventId,
      evidence_snapshot_id: verified.snapshotId,
      evidence_snapshot_fingerprint: verified.snapshotFingerprint,
      feature_path: path,
      feature_name: featureName,
      feature: structuredClone(record)
    };
    return {
      featureId: 'FEATURE-MATCH-EVIDENCE-' + sha256({
        evidenceSnapshotId: verified.snapshotId,
        featurePath: path
      }).slice(0, 24),
      eventId: verified.eventId,
      featureName,
      featureVersion: record.feature_version,
      featurePayload,
      sourceProvenanceId: preparedObservation.provenanceId,
      sourceEvidenceFingerprint: preparedObservation.evidenceFingerprint,
      createdAt: verified.snapshot.captured_at
    };
  });
  const preparedLineage = featureLineage.map(prepareFeatureProvenanceLineage);

  return Object.freeze({
    version: POSTGRES_PROVIDER_MATCH_EVIDENCE_PERSISTENCE_VERSION,
    observation: Object.freeze(observation),
    featureLineage: Object.freeze(featureLineage.map(Object.freeze)),
    sourceProvenanceId: preparedObservation.provenanceId,
    sourceEvidenceFingerprint: preparedObservation.evidenceFingerprint,
    sourcePayloadFingerprint: preparedObservation.sourcePayloadFingerprint,
    evidenceSnapshotId: verified.snapshotId,
    evidenceSnapshotFingerprint: verified.snapshotFingerprint,
    featureReferences: Object.freeze(preparedLineage.map((row) => Object.freeze({
      featureLineageId: row.lineageId,
      featureFingerprint: row.featureFingerprint,
      featureId: row.featureId,
      featureName: row.featureName
    }))),
    capitalState: 'LOCKED',
    realMoney: 'NO'
  });
}

export async function archiveProviderMatchEvidencePersistence({
  client,
  providerEventRow,
  observedAt,
  availableAt,
  predictionCutoff
}) {
  const bundle = prepareProviderMatchEvidencePersistence({
    providerEventRow,
    observedAt,
    availableAt,
    predictionCutoff
  });
  const archived = await archiveIngestionProvenanceBundle({
    client,
    observations: [bundle.observation],
    featureLineage: bundle.featureLineage
  });
  return Object.freeze({
    ...archived,
    version: POSTGRES_PROVIDER_MATCH_EVIDENCE_PERSISTENCE_VERSION,
    evidenceSnapshotId: bundle.evidenceSnapshotId,
    evidenceSnapshotFingerprint: bundle.evidenceSnapshotFingerprint,
    sourceProvenanceId: bundle.sourceProvenanceId,
    sourceEvidenceFingerprint: bundle.sourceEvidenceFingerprint,
    sourcePayloadFingerprint: bundle.sourcePayloadFingerprint,
    featureReferences: bundle.featureReferences,
    governance: Object.freeze({
      existingProvenanceStoreReused: true,
      existingFeatureLineageStoreReused: true,
      predictionIsNotValidationOrExecution: true,
      settlementSeparate: true,
      gateOwnershipUnchanged: true,
      p002Unchanged: true,
      capitalAuthority: 'GATE6',
      capitalState: 'LOCKED',
      realMoney: 'NO',
      automaticPromotionOrRetuning: false
    })
  });
}
