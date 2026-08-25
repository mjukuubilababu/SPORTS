const VALID_SIDES = new Set(['HOME', 'DRAW', 'AWAY', 'OVER', 'UNDER', 'YES', 'NO']);

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function requireProbability(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name}_INVALID`);
}

function requireTimestamp(value, name) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name}_INVALID_TIMESTAMP`);
  return parsed;
}

function auditContext(contextChecks) {
  const rows = (contextChecks ?? []).map((row) => {
    if (!row?.id || !row?.state) throw new Error('CONTEXT_CHECK_ID_AND_STATE_REQUIRED');
    if (!['CONFIRMED', 'CLEAR', 'RISK', 'MISSING', 'CONFLICT'].includes(row.state)) {
      throw new Error('CONTEXT_CHECK_STATE_INVALID');
    }
    return Object.freeze({
      id: row.id,
      state: row.state,
      source: row.source ?? null,
      observedAt: row.observedAt ?? null,
      detail: row.detail ?? null
    });
  });
  return Object.freeze({
    rows: Object.freeze(rows),
    missing: Object.freeze(rows.filter((x) => x.state === 'MISSING').map((x) => x.id)),
    conflicts: Object.freeze(rows.filter((x) => x.state === 'CONFLICT').map((x) => x.id)),
    risks: Object.freeze(rows.filter((x) => x.state === 'RISK').map((x) => x.id))
  });
}

function statisticsAudit(statisticsQuality = {}) {
  const sampleSize = statisticsQuality.sampleSize ?? 0;
  if (!Number.isInteger(sampleSize) || sampleSize < 0) throw new Error('STATISTICS_SAMPLE_SIZE_INVALID');
  const opponentAdjusted = statisticsQuality.opponentAdjusted === true;
  const venueSplitVerified = statisticsQuality.venueSplitVerified === true;
  const currentSquadRelevant = statisticsQuality.currentSquadRelevant === true;
  const nonPenaltyAndGameStateControlled = statisticsQuality.nonPenaltyAndGameStateControlled === true;
  const scheduleStrengthVerified = statisticsQuality.scheduleStrengthVerified === true;
  const verified = statisticsQuality.verified === true;
  const checks = { verified, opponentAdjusted, venueSplitVerified, currentSquadRelevant, nonPenaltyAndGameStateControlled, scheduleStrengthVerified };
  const passed = Object.values(checks).filter(Boolean).length;
  const maturity = clamp01((passed / Object.keys(checks).length) * Math.min(1, sampleSize / 30));
  const weaknesses = Object.freeze(Object.entries(checks).filter(([, value]) => !value).map(([key]) => key));
  return Object.freeze({ sampleSize, maturity, checks: Object.freeze(checks), weaknesses });
}

export function assessMatchupMarketConflict({
  eventId,
  marketKey,
  selection,
  asOf,
  kickoffAt,
  model,
  market,
  teamIntelligence,
  statisticsQuality,
  contextChecks = [],
  conflictThreshold = 0.10,
  severeConflictThreshold = 0.15,
  minimumStatisticsMaturity = 0.60,
  minimumMatchupReliability = 0.55
}) {
  if (!eventId || !marketKey || !selection) throw new Error('CONFLICT_EVENT_MARKET_SELECTION_REQUIRED');
  if (!VALID_SIDES.has(selection)) throw new Error('CONFLICT_SELECTION_INVALID');
  if (!(conflictThreshold > 0 && severeConflictThreshold >= conflictThreshold)) throw new Error('CONFLICT_THRESHOLDS_INVALID');
  const asOfMs = requireTimestamp(asOf, 'CONFLICT_AS_OF');
  const kickoffMs = requireTimestamp(kickoffAt, 'CONFLICT_KICKOFF');
  if (asOfMs >= kickoffMs) throw new Error('CONFLICT_AUDIT_MUST_BE_PREMATCH');

  requireProbability(model?.probability, 'MODEL_PROBABILITY');
  if (model?.verified !== true || model?.independentOfMarket !== true) throw new Error('VERIFIED_INDEPENDENT_MODEL_REQUIRED');
  const modelObservedMs = requireTimestamp(model.observedAt, 'MODEL_OBSERVED_AT');
  if (modelObservedMs > asOfMs || modelObservedMs >= kickoffMs) throw new Error('MODEL_OBSERVATION_NOT_PREMATCH_AS_OF');

  const stats = statisticsAudit(statisticsQuality);
  const context = auditContext(contextChecks);
  const marketReady = market?.verified === true
    && market?.directProviderObservation === true
    && market?.sameProviderPair === true
    && Number.isFinite(market?.fairProbability);
  if (Number.isFinite(market?.fairProbability)) requireProbability(market.fairProbability, 'MARKET_FAIR_PROBABILITY');
  if (marketReady) {
    const marketObservedMs = requireTimestamp(market.observedAt, 'MARKET_OBSERVED_AT');
    if (marketObservedMs > asOfMs || marketObservedMs >= kickoffMs) throw new Error('MARKET_OBSERVATION_NOT_PREMATCH_AS_OF');
  }

  const matchupReady = teamIntelligence?.state === 'ANALYSIS_MATURE'
    && Number.isFinite(teamIntelligence?.reliability)
    && teamIntelligence.reliability >= minimumMatchupReliability;
  const targetSide = ['HOME', 'AWAY'].includes(selection) ? selection : null;
  const matchupContradiction = targetSide !== null
    && matchupReady
    && teamIntelligence.favoredSide !== 'NEUTRAL'
    && teamIntelligence.favoredSide !== targetSide;

  const reasons = [];
  if (!marketReady) reasons.push('VERIFIED_DIRECT_SAME_PROVIDER_MARKET_REQUIRED');
  if (stats.maturity < minimumStatisticsMaturity) reasons.push('STATISTICS_QUALITY_INSUFFICIENT');
  if (!matchupReady) reasons.push('MATCHUP_EVIDENCE_NOT_MATURE');
  if (matchupContradiction) reasons.push('OPPONENT_SPECIFIC_MATCHUP_CONTRADICTS_SELECTION');
  if (context.missing.length) reasons.push('MATERIAL_CONTEXT_MISSING');
  if (context.conflicts.length) reasons.push('CONTEXT_SOURCES_CONFLICT');
  if (context.risks.length) reasons.push('CONTEXT_RISK_PRESENT');

  const probabilityGap = marketReady ? model.probability - market.fairProbability : null;
  const absoluteGap = probabilityGap === null ? null : Math.abs(probabilityGap);
  const marketConflict = absoluteGap !== null && absoluteGap >= conflictThreshold;
  const severeMarketConflict = absoluteGap !== null && absoluteGap >= severeConflictThreshold;
  if (marketConflict) reasons.push('MODEL_MARKET_PROBABILITY_CONFLICT');
  if (severeMarketConflict) reasons.push('SEVERE_MODEL_MARKET_PROBABILITY_CONFLICT');

  let state = 'ALIGNED_OR_WITHIN_TOLERANCE';
  let decision = 'PROCEED_TO_EXISTING_CANONICAL_GATES';
  if (!marketReady || stats.maturity < minimumStatisticsMaturity || !matchupReady || context.missing.length || context.conflicts.length) {
    state = 'INSUFFICIENT_EVIDENCE';
    decision = 'ABSTAIN';
  } else if (severeMarketConflict || matchupContradiction || context.risks.length) {
    state = matchupContradiction ? 'MATCHUP_RISK' : 'MARKET_MODEL_CONFLICT';
    decision = 'ABSTAIN';
  } else if (marketConflict) {
    state = 'MARKET_MODEL_CONFLICT';
    decision = 'WATCH_REVERIFY';
  }

  return Object.freeze({
    version: 'MATCHUP_MARKET_CONFLICT_INTELLIGENCE_V0_1',
    eventId,
    marketKey,
    selection,
    asOf,
    kickoffAt,
    state,
    decision,
    reasons: Object.freeze([...new Set(reasons)]),
    modelAudit: Object.freeze({ probability: model.probability, version: model.version ?? null, observedAt: model.observedAt, independentOfMarket: true }),
    marketAudit: Object.freeze({
      ready: marketReady,
      fairProbability: marketReady ? market.fairProbability : null,
      provider: market?.provider ?? null,
      observedAt: market?.observedAt ?? null,
      directProviderObservation: market?.directProviderObservation === true,
      sameProviderPair: market?.sameProviderPair === true
    }),
    statisticsAudit: stats,
    matchupAudit: Object.freeze({
      ready: matchupReady,
      state: teamIntelligence?.state ?? 'NOT_PROVIDED',
      reliability: Number.isFinite(teamIntelligence?.reliability) ? teamIntelligence.reliability : null,
      favoredSide: teamIntelligence?.favoredSide ?? null,
      selectionContradicted: matchupContradiction
    }),
    contextAudit: context,
    disagreement: Object.freeze({ probabilityGap, absoluteGap, conflictThreshold, severeConflictThreshold, marketConflict, severeMarketConflict }),
    decisionWeight: 0,
    capitalEffect: 'NONE',
    governance: Object.freeze({
      trapOrFixingClaimMade: false,
      oddsDoNotDetermineOutcome: true,
      statisticsDoNotGuaranteeOutcome: true,
      opponentSpecificComparisonRequired: true,
      homeAwayIsAFeatureNotAConclusion: true,
      marketUsedAsBenchmarkNotModelFeature: true,
      missingEvidenceForcesAbstention: true,
      noAutomaticRetuning: true,
      noAutomaticProbabilityRewrite: true,
      noAutomaticSignalFreeze: true,
      existingCanonicalGatesRemainRequired: true,
      postMatchDataCannotEnterPrematchAudit: true
    })
  });
}
