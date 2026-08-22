const KICKOFF_STATES = Object.freeze(['SCHEDULED', 'DELAYED', 'POSTPONED', 'CANCELLED']);

function validTimestamp(value) {
  return Number.isFinite(Date.parse(value));
}

function playerKey(player) {
  if (typeof player === 'string') return player.trim().toLowerCase();
  if (!player || typeof player !== 'object') return null;
  return String(player.id ?? player.playerId ?? player.name ?? '').trim().toLowerCase() || null;
}

function normalizeXI(side) {
  const xi = side?.startingXI;
  if (!Array.isArray(xi) || xi.length !== 11) throw new Error('STARTING_XI_MUST_HAVE_11_PLAYERS');
  const keys = xi.map(playerKey);
  if (keys.some((key) => !key)) throw new Error('STARTING_XI_PLAYER_IDENTITY_REQUIRED');
  if (new Set(keys).size !== 11) throw new Error('STARTING_XI_DUPLICATE_PLAYER');
  return xi.map((player) => typeof player === 'string' ? { name: player } : { ...player });
}

export function resolveKickoffObservation(observation) {
  if (!observation?.eventId || !observation?.scheduledKickoffAt || !observation?.observedAt) {
    throw new Error('KICKOFF_OBSERVATION_IDENTITY_REQUIRED');
  }
  if (!validTimestamp(observation.scheduledKickoffAt) || !validTimestamp(observation.observedAt)) {
    throw new Error('KICKOFF_TIMESTAMP_INVALID');
  }
  if (!KICKOFF_STATES.includes(observation.status)) throw new Error('KICKOFF_STATUS_INVALID');
  if (observation.sourceVerified !== true) throw new Error('KICKOFF_SOURCE_NOT_VERIFIED');
  if (!observation.source && !observation.sourceUrl) throw new Error('KICKOFF_SOURCE_REQUIRED');

  let effectiveKickoffAt = observation.scheduledKickoffAt;
  if (observation.status === 'DELAYED') {
    if (!validTimestamp(observation.revisedKickoffAt)) throw new Error('REVISED_KICKOFF_REQUIRED');
    if (Date.parse(observation.revisedKickoffAt) <= Date.parse(observation.scheduledKickoffAt)) {
      throw new Error('REVISED_KICKOFF_NOT_LATER');
    }
    effectiveKickoffAt = observation.revisedKickoffAt;
  }
  if (observation.status === 'POSTPONED' || observation.status === 'CANCELLED') effectiveKickoffAt = null;

  return Object.freeze({
    eventId: observation.eventId,
    status: observation.status,
    scheduledKickoffAt: new Date(observation.scheduledKickoffAt).toISOString(),
    effectiveKickoffAt: effectiveKickoffAt ? new Date(effectiveKickoffAt).toISOString() : null,
    observedAt: new Date(observation.observedAt).toISOString(),
    sourceVerified: true,
    source: observation.source ?? null,
    sourceUrl: observation.sourceUrl ?? null,
    reason: observation.reason ?? null
  });
}

export function normalizeConfirmedLineup(snapshot, effectiveKickoffAt) {
  if (!snapshot?.eventId || !snapshot?.confirmedAt) throw new Error('LINEUP_IDENTITY_REQUIRED');
  if (snapshot.status !== 'CONFIRMED') throw new Error('LINEUP_NOT_CONFIRMED');
  if (snapshot.sourceVerified !== true) throw new Error('LINEUP_SOURCE_NOT_VERIFIED');
  if (!snapshot.source && !snapshot.sourceUrl) throw new Error('LINEUP_SOURCE_REQUIRED');
  if (!validTimestamp(snapshot.confirmedAt) || !validTimestamp(effectiveKickoffAt)) throw new Error('LINEUP_TIMESTAMP_INVALID');
  if (Date.parse(snapshot.confirmedAt) >= Date.parse(effectiveKickoffAt)) throw new Error('LINEUP_CONFIRMED_AT_OR_AFTER_KICKOFF');

  return Object.freeze({
    eventId: snapshot.eventId,
    status: 'CONFIRMED',
    confirmedAt: new Date(snapshot.confirmedAt).toISOString(),
    sourceVerified: true,
    source: snapshot.source ?? null,
    sourceUrl: snapshot.sourceUrl ?? null,
    home: Object.freeze({
      formation: snapshot.home?.formation ?? null,
      startingXI: Object.freeze(normalizeXI(snapshot.home).map(Object.freeze))
    }),
    away: Object.freeze({
      formation: snapshot.away?.formation ?? null,
      startingXI: Object.freeze(normalizeXI(snapshot.away).map(Object.freeze))
    })
  });
}

export function applyVerifiedLineupImpact(model, impact = null) {
  if (!model?.verified || !Number.isFinite(model.homeLambda) || !Number.isFinite(model.awayLambda)) {
    throw new Error('VERIFIED_BASE_MODEL_REQUIRED');
  }
  if (!impact) {
    return {
      homeLambda: model.homeLambda,
      awayLambda: model.awayLambda,
      adjustmentApplied: false,
      reason: 'NO_VERIFIED_LINEUP_IMPACT_MODEL'
    };
  }
  if (impact.verified !== true) {
    return {
      homeLambda: model.homeLambda,
      awayLambda: model.awayLambda,
      adjustmentApplied: false,
      reason: 'LINEUP_IMPACT_NOT_VERIFIED'
    };
  }
  if (!impact.source && !impact.provenance) throw new Error('LINEUP_IMPACT_PROVENANCE_REQUIRED');
  const homeMultiplier = impact.homeLambdaMultiplier ?? 1;
  const awayMultiplier = impact.awayLambdaMultiplier ?? 1;
  for (const value of [homeMultiplier, awayMultiplier]) {
    if (!Number.isFinite(value) || value < 0.5 || value > 1.5) throw new Error('LINEUP_IMPACT_MULTIPLIER_OUT_OF_RANGE');
  }
  return {
    homeLambda: model.homeLambda * homeMultiplier,
    awayLambda: model.awayLambda * awayMultiplier,
    adjustmentApplied: true,
    homeLambdaMultiplier: homeMultiplier,
    awayLambdaMultiplier: awayMultiplier,
    source: impact.source ?? null,
    provenance: impact.provenance ?? null,
    version: impact.version ?? null
  };
}

export function resolveFinalContextAssessment(previousEvidenceMaturity, assessment = null) {
  const previous = Number.isFinite(previousEvidenceMaturity) ? previousEvidenceMaturity : 0;
  if (!assessment || assessment.verified !== true) {
    return {
      evidenceMaturity: previous,
      verified: false,
      reason: 'FINAL_CONTEXT_NOT_VERIFIED',
      transitionRisk: assessment?.transitionRisk ?? null
    };
  }
  if (!Number.isFinite(assessment.evidenceMaturity) || assessment.evidenceMaturity < 0 || assessment.evidenceMaturity > 100) {
    throw new Error('FINAL_EVIDENCE_MATURITY_INVALID');
  }
  if (!assessment.source && !assessment.provenance) throw new Error('FINAL_CONTEXT_PROVENANCE_REQUIRED');
  return {
    evidenceMaturity: assessment.evidenceMaturity,
    verified: true,
    transitionRisk: assessment.transitionRisk ?? null,
    source: assessment.source ?? null,
    provenance: assessment.provenance ?? null,
    version: assessment.version ?? null
  };
}

export function prepareFinalPrematchEvent({
  baseEvent,
  kickoffObservation,
  lineupSnapshot,
  latestBookmakerSnapshots,
  finalCapturedAt,
  lineupImpact = null,
  finalContextAssessment = null
}) {
  if (!baseEvent?.eventId || !baseEvent?.model?.verified) throw new Error('BASE_EVENT_WITH_VERIFIED_MODEL_REQUIRED');
  if (!validTimestamp(finalCapturedAt)) throw new Error('FINAL_CAPTURE_TIMESTAMP_INVALID');

  const kickoff = resolveKickoffObservation(kickoffObservation);
  if (kickoff.eventId !== baseEvent.eventId) throw new Error('KICKOFF_EVENT_MISMATCH');
  if (kickoff.status === 'POSTPONED' || kickoff.status === 'CANCELLED') {
    return {
      terminal: true,
      eventId: baseEvent.eventId,
      state: 'REJECTED',
      reasons: [`KICKOFF_${kickoff.status}`],
      kickoff,
      realMoney: 'NO'
    };
  }
  if (Date.parse(finalCapturedAt) >= Date.parse(kickoff.effectiveKickoffAt)) {
    return {
      terminal: true,
      eventId: baseEvent.eventId,
      state: 'REJECTED',
      reasons: ['FINAL_CAPTURE_AT_OR_AFTER_KICKOFF'],
      kickoff,
      realMoney: 'NO'
    };
  }

  const lineup = normalizeConfirmedLineup(lineupSnapshot, kickoff.effectiveKickoffAt);
  if (lineup.eventId !== baseEvent.eventId) throw new Error('LINEUP_EVENT_MISMATCH');
  if (!Array.isArray(latestBookmakerSnapshots) || latestBookmakerSnapshots.length < 2) {
    throw new Error('FINAL_MARKET_REQUIRES_MULTIPLE_BOOKMAKERS');
  }

  const model = applyVerifiedLineupImpact(baseEvent.model, lineupImpact);
  const context = resolveFinalContextAssessment(baseEvent.evidenceMaturity, finalContextAssessment);

  return {
    terminal: false,
    event: {
      ...baseEvent,
      kickoffAt: kickoff.effectiveKickoffAt,
      bookmakerSnapshots: latestBookmakerSnapshots,
      model: {
        ...baseEvent.model,
        verified: true,
        homeLambda: model.homeLambda,
        awayLambda: model.awayLambda,
        lineupAdjustmentApplied: model.adjustmentApplied,
        lineupAdjustment: model
      },
      lineupGate: 'PASS',
      evidenceMaturity: context.evidenceMaturity,
      finalContext: context,
      confirmedLineup: lineup
    },
    kickoff,
    lineup,
    modelAdjustment: model,
    finalContext: context
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function freezeFinalPrematchSnapshot({
  result,
  baselineBatchId,
  modelDatasetId,
  finalCaptureId,
  finalCapturedAt,
  kickoff,
  lineup,
  modelAdjustment
}) {
  if (!result?.eventId || !finalCapturedAt) throw new Error('FINAL_SNAPSHOT_IDENTITY_REQUIRED');
  return deepFreeze({
    snapshotType: 'FINAL_PREMATCH_DECISION',
    immutable: true,
    eventId: result.eventId,
    baselineBatchId,
    modelDatasetId,
    finalCaptureId,
    createdAt: finalCapturedAt,
    effectiveKickoffAt: kickoff?.effectiveKickoffAt ?? null,
    kickoffStatus: kickoff?.status ?? null,
    lineupConfirmedAt: lineup?.confirmedAt ?? null,
    lineupSource: lineup?.source ?? lineup?.sourceUrl ?? null,
    lineupAdjustmentApplied: modelAdjustment?.adjustmentApplied ?? false,
    finalState: result.state,
    reasons: [...(result.reasons ?? [])],
    prediction: result.prediction ? {
      homeLambda: result.prediction.homeLambda,
      awayLambda: result.prediction.awayLambda,
      expectedTotalGoals: result.prediction.expectedTotalGoals,
      probabilities: { ...result.prediction.probabilities },
      predictedOutcome: result.prediction.predictedOutcome
    } : null,
    market: result.bookmakerComparison ? {
      providers: [...(result.bookmakerComparison.providers ?? [])],
      consensusFair: { ...(result.bookmakerComparison.consensusFair ?? {}) },
      bestPrice: { ...(result.bookmakerComparison.bestPrice ?? {}) }
    } : null,
    evidenceMaturity: result.evidenceMaturity ?? null,
    lineupGate: result.lineupGate ?? null,
    gate5SignalDraft: result.gate5SignalDraft ?? null,
    noHindsight: true,
    priorSnapshotsMutated: false,
    realMoney: 'NO'
  });
}

export { KICKOFF_STATES };
