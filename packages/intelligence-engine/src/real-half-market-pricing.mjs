import { buildMatchDecisionUniverse } from './match-decision-universe.mjs';

function assertFiniteOdds(value) {
  if (!Number.isFinite(value) || value <= 1) throw new Error('INVALID_DECIMAL_ODDS');
}

export function devigObservedMarket(market, { provider = 'UNKNOWN', freshnessStatus = 'UNKNOWN' } = {}) {
  if (!market?.marketId || !market?.marketFamily || !Array.isArray(market.selections) || market.selections.length < 2) {
    throw new Error('OBSERVED_MARKET_INVALID');
  }
  const seen = new Set();
  const implied = market.selections.map((row) => {
    if (!row?.selection || seen.has(row.selection)) throw new Error('MARKET_SELECTION_INVALID_OR_DUPLICATE');
    seen.add(row.selection);
    assertFiniteOdds(row.odds);
    return { ...row, impliedProbability: 1 / row.odds };
  });
  const impliedMass = implied.reduce((sum, row) => sum + row.impliedProbability, 0);
  if (!(impliedMass > 0)) throw new Error('IMPLIED_MARKET_MASS_INVALID');
  const pricedSelections = implied.map((row) => Object.freeze({
    marketId: market.marketId,
    marketFamily: market.marketFamily,
    selection: row.selection,
    line: Number.isFinite(market.line) ? market.line : undefined,
    odds: row.odds,
    marketFairProbability: row.impliedProbability / impliedMass,
    provider,
    freshnessStatus
  }));
  return Object.freeze({
    marketId: market.marketId,
    marketFamily: market.marketFamily,
    line: Number.isFinite(market.line) ? market.line : null,
    provider,
    freshnessStatus,
    impliedMass,
    overround: impliedMass - 1,
    pricedSelections: Object.freeze(pricedSelections)
  });
}

function candidateBlockingReasons({ captureEvent, providerCount, requiredProviderQuorum, modelRow }) {
  const reasons = [];
  if (captureEvent.freshnessStatus !== 'LIVE_PREKICKOFF_VERIFIED') reasons.push('PRICE_FRESHNESS_NOT_LIVE_VERIFIED');
  if (providerCount < requiredProviderQuorum) reasons.push('PROVIDER_QUORUM_NOT_MET');
  if ((modelRow.evidenceMaturity ?? 0) < 70) reasons.push('EVIDENCE_MATURITY_BELOW_70');
  if (modelRow.lineupGate !== 'PASS') reasons.push('LINEUP_GATE_NOT_PASS');
  if ((modelRow.contextRisk ?? 'HIGH') === 'HIGH') reasons.push('CONTEXT_RISK_HIGH');
  return reasons;
}

export function processRealHalfMarketPricing(modelMarketReport, halfProfileDataset, halfMarketCapture, {
  minEdge = 0.05,
  requiredProviderQuorum = halfMarketCapture?.providerQuorumRequiredForQualification ?? 2
} = {}) {
  if (!Array.isArray(modelMarketReport?.modelBoard)) throw new Error('MODEL_MARKET_REPORT_REQUIRED');
  if (!halfProfileDataset?.datasetId || !Array.isArray(halfProfileDataset.events)) throw new Error('HALF_PROFILE_DATASET_REQUIRED');
  if (!halfMarketCapture?.captureId || !Array.isArray(halfMarketCapture.events)) throw new Error('HALF_MARKET_CAPTURE_REQUIRED');
  if (!Number.isInteger(requiredProviderQuorum) || requiredProviderQuorum < 1) throw new Error('PROVIDER_QUORUM_INVALID');

  const profileByEvent = new Map(halfProfileDataset.events.map((row) => [row.eventId, row]));
  const captureByEvent = new Map(halfMarketCapture.events.map((row) => [row.eventId, row]));

  const events = modelMarketReport.modelBoard.map((modelRow) => {
    const profileRow = profileByEvent.get(modelRow.eventId);
    const captureEvent = captureByEvent.get(modelRow.eventId);
    if (!profileRow?.halfProfile) {
      return { eventId: modelRow.eventId, match: modelRow.match, state: 'WAIT', reasons: ['HALF_PROFILE_NOT_FOUND'], realMoney: 'NO' };
    }
    if (!captureEvent?.markets?.length) {
      return { eventId: modelRow.eventId, match: modelRow.match, state: 'WAIT', reasons: ['HALF_MARKET_CAPTURE_NOT_FOUND'], realMoney: 'NO' };
    }

    const provider = captureEvent.provider ?? halfMarketCapture.provider ?? 'UNKNOWN';
    const normalizedMarkets = captureEvent.markets.map((market) => devigObservedMarket(market, {
      provider: market.provider ?? provider,
      freshnessStatus: market.freshnessStatus ?? captureEvent.freshnessStatus ?? 'UNKNOWN'
    }));
    const providerCount = new Set(normalizedMarkets.map((market) => market.provider)).size;
    const pricedMarketSelections = normalizedMarkets.flatMap((market) => market.pricedSelections);
    const availableMarketSelections = pricedMarketSelections.map(({ marketFamily, selection, line }) => ({ marketFamily, selection, line }));

    const universe = buildMatchDecisionUniverse({
      eventId: modelRow.eventId,
      homeTeam: profileRow.homeTeam,
      awayTeam: profileRow.awayTeam,
      homeLambda: modelRow.homeLambda,
      awayLambda: modelRow.awayLambda,
      evidenceMaturity: modelRow.evidenceMaturity ?? 0,
      lineupGate: modelRow.lineupGate ?? 'PENDING',
      contextRisk: modelRow.contextRisk ?? 'HIGH',
      halfProfile: profileRow.halfProfile,
      minimumHalfProfileSample: halfProfileDataset.minimumSample ?? 30,
      availableMarketSelections,
      pricedMarketSelections,
      minDisplayProbability: 0,
      minEdge
    });

    if (universe.halfModelState !== 'VERIFIED') {
      return { eventId: modelRow.eventId, match: modelRow.match, state: 'WAIT', reasons: ['HALF_MODEL_NOT_VERIFIED'], realMoney: 'NO' };
    }

    const blockingReasons = candidateBlockingReasons({ captureEvent, providerCount, requiredProviderQuorum, modelRow });
    const researchCandidates = universe.pricing.rankedValueCandidates.map((row, index) => Object.freeze({
      rank: index + 1,
      marketId: row.marketId,
      marketFamily: row.marketFamily,
      selection: row.selection,
      line: row.line ?? null,
      provider: row.provider,
      odds: row.odds,
      modelProbability: row.modelProbability,
      marketFairProbability: row.marketFairProbability,
      edgePp: row.edgePp,
      ev: row.ev,
      qualificationState: blockingReasons.length === 0 ? 'ELIGIBLE_FOR_CANONICAL_FINAL_GATE' : 'VALUE_RESEARCH_CANDIDATE_BLOCKED',
      blockingReasons: Object.freeze([...blockingReasons])
    }));

    return {
      eventId: modelRow.eventId,
      match: modelRow.match,
      state: researchCandidates.length ? 'HALF_PRICE_RESEARCH_READY_BLOCKED' : 'HALF_PRICE_RESEARCH_NO_VALUE',
      source: {
        provider,
        url: captureEvent.sourceUrl ?? null,
        sourceIndexAgeClass: captureEvent.sourceIndexAgeClass ?? null,
        freshnessStatus: captureEvent.freshnessStatus ?? 'UNKNOWN',
        sourceObservationTimeKnown: halfMarketCapture.sourceObservationTimeKnown === true
      },
      providerCount,
      requiredProviderQuorum,
      observedMarkets: normalizedMarkets.map((market) => ({
        marketId: market.marketId,
        marketFamily: market.marketFamily,
        line: market.line,
        overround: market.overround,
        selections: market.pricedSelections
      })),
      pricedSelectionsEvaluated: universe.pricing.rows.length,
      valueResearchCandidates: researchCandidates,
      strongestValueResearchCandidates: researchCandidates.slice(0, 8),
      canonicalQualification: 'NOT_GRANTED_BY_RESEARCH_PRICING_LAYER',
      realMoney: 'NO'
    };
  });

  return {
    reportVersion: 'REAL_HALF_MARKET_PRICING_V0_1',
    captureId: halfMarketCapture.captureId,
    dataNature: halfMarketCapture.dataNature,
    halfProfileDatasetId: halfProfileDataset.datasetId,
    summary: {
      eventsReceived: modelMarketReport.modelBoard.length,
      pricedEvents: events.filter((row) => row.state?.startsWith('HALF_PRICE_RESEARCH')).length,
      valueResearchCandidates: events.reduce((sum, row) => sum + (row.valueResearchCandidates?.length ?? 0), 0),
      eligibleForCanonicalFinalGate: events.reduce((sum, row) => sum + (row.valueResearchCandidates?.filter((x) => x.qualificationState === 'ELIGIBLE_FOR_CANONICAL_FINAL_GATE').length ?? 0), 0),
      qualifiedSignals: 0
    },
    events,
    governance: {
      teamAndHalfModelBeforePrice: true,
      proportionalDevigWithinEachObservedMarket: true,
      indexedPricesAreNotClosingPrices: true,
      livePreKickoffFreshnessRequiredForQualification: true,
      multiProviderQuorumRequiredForQualification: true,
      finalEvidenceLineupContextGateRemainsAuthoritative: true,
      researchPricingLayerCannotGrantQualification: true,
      noFabricatedPrices: true,
      capitalLocked: true,
      realMoney: 'NO'
    }
  };
}
