import { createHash } from 'node:crypto';
import {
  analyzeMatchEvidence,
  buildMatchEvidenceSnapshot,
  verifyMatchEvidenceSnapshot
} from './match-evidence-analysis.mjs';

export const REAL_PROVIDER_MATCH_EVIDENCE_INGESTION_VERSION = 'REAL_PROVIDER_MATCH_EVIDENCE_INGESTION_V0_1';
export const CANONICAL_PROVIDER_MATCH_EVIDENCE_SCHEMA_VERSION = 'CANONICAL_PROVIDER_MATCH_EVIDENCE_V0_1';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function payloadFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function requireString(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value.trim();
}

function timestamp(value, code) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
}

function eventSourceReference(batch, event) {
  return requireString(event.sourceReference ?? batch.sourceReference, 'PROVIDER_SOURCE_REFERENCE_REQUIRED');
}

function assertProviderBoundary(batch, event) {
  if (event.provider !== undefined && event.provider !== batch.provider) {
    throw new Error('EVENT_PROVIDER_MISMATCH');
  }
  if (
    event.schemaVersion !== undefined &&
    event.schemaVersion !== CANONICAL_PROVIDER_MATCH_EVIDENCE_SCHEMA_VERSION
  ) {
    throw new Error('PROVIDER_EVIDENCE_SCHEMA_UNSUPPORTED');
  }
}

function matchEvidenceInput(batch, event) {
  const evidence = event.evidence ?? {};
  return {
    evidenceSnapshotId: requireString(event.evidenceSnapshotId, 'EVIDENCE_SNAPSHOT_ID_REQUIRED'),
    eventId: requireString(event.eventId, 'EVENT_ID_REQUIRED'),
    kickoffAt: event.kickoffAt,
    capturedAt: batch.capturedAt,
    sourceProvider: batch.provider,
    sourceType: batch.sourceType,
    sourceReference: eventSourceReference(batch, event),
    verified: batch.verified === true,
    independentlyVerified: batch.independentlyVerified === true,
    featureVersion: event.featureVersion,
    recencyConfigVersion: event.recencyConfigVersion,
    formContextWeightVersion: event.formContextWeightVersion,
    h2hDecayVersion: event.h2hDecayVersion,
    homeRecentMatches: evidence.homeRecentMatches ?? [],
    awayRecentMatches: evidence.awayRecentMatches ?? [],
    homeHomeMatches: evidence.homeHomeMatches ?? [],
    awayAwayMatches: evidence.awayAwayMatches ?? [],
    h2hMatches: evidence.h2hMatches ?? [],
    leaguePositions: evidence.leaguePositions ?? null,
    restDays: evidence.restDays ?? null,
    injuries: evidence.injuries ?? null,
    suspensions: evidence.suspensions ?? null,
    lineups: evidence.lineups ?? null,
    xG: evidence.xG ?? null,
    marketObservations: evidence.marketObservations ?? []
  };
}

function modelState(model, eventId, capturedAt, kickoffAt) {
  if (!model || model.verified !== true) {
    return deepFreeze({
      state: 'INDEPENDENT_MODEL_PENDING',
      reason: 'INDEPENDENT_MODEL_NOT_VERIFIED'
    });
  }
  if (model.eventId !== undefined && model.eventId !== eventId) {
    throw new Error('MODEL_EVENT_MISMATCH');
  }
  if (model.independentOfMarket !== true) {
    throw new Error('MARKET_DERIVED_MODEL_INPUT_FORBIDDEN');
  }
  requireString(model.modelVersion, 'MODEL_VERSION_REQUIRED');
  requireString(model.sourceReference, 'MODEL_SOURCE_REFERENCE_REQUIRED');
  const observedMs = timestamp(model.observedAt, 'MODEL_OBSERVED_AT_INVALID');
  const capturedMs = timestamp(capturedAt, 'CAPTURED_AT_INVALID');
  const kickoffMs = timestamp(kickoffAt, 'KICKOFF_AT_INVALID');
  if (observedMs > capturedMs) throw new Error('MODEL_OBSERVED_AFTER_EVIDENCE_SNAPSHOT');
  if (observedMs >= kickoffMs) throw new Error('POST_KICKOFF_MODEL_REJECTED');
  if (!Number.isFinite(model.homeLambda) || model.homeLambda < 0) throw new Error('HOME_LAMBDA_INVALID');
  if (!Number.isFinite(model.awayLambda) || model.awayLambda < 0) throw new Error('AWAY_LAMBDA_INVALID');
  return deepFreeze({
    state: 'INDEPENDENT_MODEL_VERIFIED',
    reason: null,
    modelVersion: model.modelVersion,
    observedAt: model.observedAt,
    sourceReference: model.sourceReference
  });
}

function buildAnalysis(snapshot, event, state) {
  if (state.state !== 'INDEPENDENT_MODEL_VERIFIED') return null;
  return analyzeMatchEvidence({
    snapshot,
    homeLambda: event.model.homeLambda,
    awayLambda: event.model.awayLambda,
    homeTeam: event.homeTeam ?? 'HOME',
    awayTeam: event.awayTeam ?? 'AWAY',
    modelVersion: event.model.modelVersion,
    marketSelections: event.marketSelections,
    halfReasoning: event.halfReasoning ?? null
  });
}

function acceptedRow(batch, event) {
  assertProviderBoundary(batch, event);
  const snapshot = buildMatchEvidenceSnapshot(matchEvidenceInput(batch, event));
  verifyMatchEvidenceSnapshot(snapshot);
  let model;
  try {
    model = modelState(event.model, event.eventId, batch.capturedAt, event.kickoffAt);
  } catch (error) {
    model = deepFreeze({ state: 'INDEPENDENT_MODEL_REJECTED', reason: error?.message ?? 'MODEL_CONTRACT_INVALID' });
  }
  const analysis = buildAnalysis(snapshot, event, model);
  const state = analysis
    ? 'ANALYZED'
    : (model.state === 'INDEPENDENT_MODEL_REJECTED' ? 'EVIDENCE_READY_MODEL_REJECTED' : 'EVIDENCE_READY_MODEL_PENDING');
  return deepFreeze({
    event_id: event.eventId,
    evidence_snapshot_id: snapshot.evidence_snapshot_id,
    evidence_snapshot_fingerprint: snapshot.fingerprint,
    provider_payload_fingerprint: payloadFingerprint({ provider: batch.provider, capturedAt: batch.capturedAt, event }),
    provider_event_id: event.providerEventId ?? null,
    provider: batch.provider,
    state,
    decision: analysis?.decision ?? 'ABSTAIN',
    reasons: analysis ? analysis.abstain_reasons : Object.freeze([model.reason]),
    snapshot,
    model,
    analysis,
    governance: deepFreeze({
      providerPayloadNotStoredInParallelStore: true,
      canonicalSnapshotBuilderUsed: true,
      oddsCannotCreateModelLambda: true,
      predictionIsNotValidationOrExecution: true,
      capitalEffect: 'NONE',
      realMoney: 'NO'
    })
  });
}

function rejectedRow(event, error) {
  return deepFreeze({
    event_id: event?.eventId ?? null,
    evidence_snapshot_id: event?.evidenceSnapshotId ?? null,
    provider_event_id: event?.providerEventId ?? null,
    state: 'REJECTED',
    decision: 'ABSTAIN',
    reasons: Object.freeze([error?.message ?? 'PROVIDER_EVIDENCE_PROCESSING_ERROR']),
    error_code: error?.message ?? 'PROVIDER_EVIDENCE_PROCESSING_ERROR',
    snapshot: null,
    model: null,
    analysis: null,
    realMoney: 'NO'
  });
}

export function adaptRealProviderMatchEvidenceEvent(batch, event) {
  if (!batch || !event) throw new Error('PROVIDER_BATCH_AND_EVENT_REQUIRED');
  requireString(batch.provider, 'PROVIDER_REQUIRED');
  requireString(batch.sourceType, 'SOURCE_TYPE_REQUIRED');
  timestamp(batch.capturedAt, 'CAPTURED_AT_INVALID');
  return acceptedRow(batch, event);
}

export function ingestRealProviderMatchEvidenceBatch(batch) {
  if (!batch || typeof batch !== 'object') throw new Error('PROVIDER_EVIDENCE_BATCH_REQUIRED');
  const batchId = requireString(batch.batchId, 'PROVIDER_EVIDENCE_BATCH_ID_REQUIRED');
  const provider = requireString(batch.provider, 'PROVIDER_REQUIRED');
  const sourceType = requireString(batch.sourceType, 'SOURCE_TYPE_REQUIRED').toUpperCase();
  const capturedAt = requireString(batch.capturedAt, 'CAPTURED_AT_REQUIRED');
  timestamp(capturedAt, 'CAPTURED_AT_INVALID');
  if (!Array.isArray(batch.events)) throw new Error('PROVIDER_EVIDENCE_EVENTS_REQUIRED');

  const normalizedBatch = {
    ...batch,
    provider,
    sourceType,
    capturedAt
  };
  const eventIdentity = new Map();
  const snapshotIdentity = new Map();
  const events = [];

  for (const event of batch.events) {
    let row;
    try {
      row = acceptedRow(normalizedBatch, event);
      const eventId = row.event_id;
      const snapshotId = row.evidence_snapshot_id;
      const existingEvent = eventIdentity.get(eventId);
      const existingSnapshot = snapshotIdentity.get(snapshotId);

      if (existingEvent || existingSnapshot) {
        const existing = existingEvent ?? existingSnapshot;
        const sameIdentity = existing.event_id === eventId && existing.evidence_snapshot_id === snapshotId;
        const samePayload = existing.provider_payload_fingerprint === row.provider_payload_fingerprint;
        if (!sameIdentity) throw new Error('CROSS_EVENT_SNAPSHOT_IDENTITY_REUSE');
        if (!samePayload) throw new Error('PROVIDER_EVIDENCE_IDENTITY_PAYLOAD_CONFLICT');
        row = deepFreeze({
          ...row,
          state: 'IDEMPOTENT_REPLAY',
          replay_of_fingerprint: existing.evidence_snapshot_fingerprint
        });
      } else {
        eventIdentity.set(eventId, row);
        snapshotIdentity.set(snapshotId, row);
      }
    } catch (error) {
      row = rejectedRow(event, error);
    }
    events.push(row);
  }

  const summary = events.reduce((acc, row) => {
    acc[row.state] = (acc[row.state] ?? 0) + 1;
    return acc;
  }, {});

  return deepFreeze({
    report_version: REAL_PROVIDER_MATCH_EVIDENCE_INGESTION_VERSION,
    schema_version: CANONICAL_PROVIDER_MATCH_EVIDENCE_SCHEMA_VERSION,
    batch_id: batchId,
    provider,
    source_type: sourceType,
    captured_at: capturedAt,
    events_received: batch.events.length,
    summary: deepFreeze(summary),
    events: deepFreeze(events),
    governance: deepFreeze({
      canonicalMatchEvidenceSnapshotOnly: true,
      exactReplayIdempotent: true,
      changedPayloadSameIdentityRejected: true,
      crossEventSnapshotReuseRejected: true,
      missingEvidenceRemainsUnknown: true,
      postSnapshotAndPostKickoffInputsRejected: true,
      independentModelRequiredForAnalysis: true,
      marketDerivedLambdaForbidden: true,
      predictionIsNotValidationOrExecution: true,
      gateOwnershipUnchanged: true,
      p002Unchanged: true,
      capital: 'LOCKED',
      realMoney: 'NO',
      automaticPromotionOrRetuning: false
    })
  });
}
