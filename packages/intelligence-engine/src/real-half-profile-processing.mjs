import { buildMatchDecisionUniverse } from './match-decision-universe.mjs';

function defaultHalfSelections() {
  const out = [];
  for (const marketFamily of ['1X2_FIRST_HALF', '1X2_SECOND_HALF']) {
    for (const selection of ['HOME', 'DRAW', 'AWAY']) out.push({ marketFamily, selection });
  }
  for (const marketFamily of ['DOUBLE_CHANCE_FIRST_HALF', 'DOUBLE_CHANCE_SECOND_HALF']) {
    for (const selection of ['1X', 'X2', '12']) out.push({ marketFamily, selection });
  }
  for (const marketFamily of ['BTTS_FIRST_HALF', 'BTTS_SECOND_HALF']) {
    for (const selection of ['YES', 'NO']) out.push({ marketFamily, selection });
  }
  for (const marketFamily of ['OVER_UNDER_FIRST_HALF', 'OVER_UNDER_SECOND_HALF']) {
    for (const line of [0.5, 1.5, 2.5]) for (const selection of ['OVER', 'UNDER']) out.push({ marketFamily, selection, line });
  }
  for (const selection of ['FIRST', 'EQUAL', 'SECOND']) out.push({ marketFamily: 'HALF_WITH_MORE_GOALS', selection });
  for (const marketFamily of ['HOME_WIN_EITHER_HALF', 'AWAY_WIN_EITHER_HALF', 'HOME_WIN_BOTH_HALVES', 'AWAY_WIN_BOTH_HALVES']) {
    for (const selection of ['YES', 'NO']) out.push({ marketFamily, selection });
  }
  for (const ht of ['HOME', 'DRAW', 'AWAY']) {
    for (const ft of ['HOME', 'DRAW', 'AWAY']) out.push({ marketFamily: 'HALF_TIME_FULL_TIME', selection: `${ht}_${ft}` });
  }
  return out;
}

function topEntries(object, limit = 3) {
  return Object.entries(object ?? {})
    .map(([selection, probability]) => ({ selection, probability }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, limit);
}

export function processRealHalfProfileReport(modelMarketReport, halfProfileDataset, {
  minDisplayProbability = 0.5,
  minEdge = 0.05
} = {}) {
  if (!Array.isArray(modelMarketReport?.modelBoard)) throw new Error('MODEL_MARKET_REPORT_REQUIRED');
  if (!halfProfileDataset?.datasetId || !Array.isArray(halfProfileDataset.events)) throw new Error('HALF_PROFILE_DATASET_REQUIRED');
  const profiles = new Map(halfProfileDataset.events.map((row) => [row.eventId, row]));
  const availableMarketSelections = defaultHalfSelections();

  const events = modelMarketReport.modelBoard.map((row) => {
    const profileRow = profiles.get(row.eventId);
    if (!profileRow?.halfProfile) {
      return {
        eventId: row.eventId,
        match: row.match,
        state: 'WAIT',
        reason: 'REAL_HALF_PROFILE_NOT_FOUND',
        realMoney: 'NO'
      };
    }
    const universe = buildMatchDecisionUniverse({
      eventId: row.eventId,
      homeTeam: profileRow.homeTeam,
      awayTeam: profileRow.awayTeam,
      homeLambda: row.homeLambda,
      awayLambda: row.awayLambda,
      evidenceMaturity: row.evidenceMaturity ?? 0,
      lineupGate: row.lineupGate ?? 'PENDING',
      contextRisk: row.contextRisk ?? 'HIGH',
      halfProfile: profileRow.halfProfile,
      minimumHalfProfileSample: halfProfileDataset.minimumSample ?? 30,
      availableMarketSelections,
      pricedMarketSelections: [],
      minDisplayProbability,
      minEdge
    });
    if (universe.halfModelState !== 'VERIFIED') {
      return {
        eventId: row.eventId,
        match: row.match,
        state: 'WAIT',
        reason: 'HALF_PROFILE_NOT_VERIFIED',
        halfModelState: universe.halfModelState,
        realMoney: 'NO'
      };
    }
    const half = universe.halfReasoning;
    const first = half.firstHalf.matchReality;
    const second = half.secondHalf.matchReality;
    return {
      eventId: row.eventId,
      match: row.match,
      state: 'HALF_MODEL_READY_MARKET_PRICE_PENDING',
      halfModelVersion: universe.halfModel.modelVersion,
      sourceProfileId: universe.halfModel.sourceProfileId,
      sampleSize: universe.halfModel.sampleSize,
      shares: universe.halfModel.shares,
      firstHalf: {
        expectedGoals: universe.halfModel.firstHalf.expectedGoals,
        oneXTwo: { HOME: first.homeWin, DRAW: first.draw, AWAY: first.awayWin },
        btts: { YES: first.bttsYes, NO: first.bttsNo },
        overUnder15: first.totals['1_5']
      },
      secondHalf: {
        expectedGoals: universe.halfModel.secondHalf.expectedGoals,
        oneXTwo: { HOME: second.homeWin, DRAW: second.draw, AWAY: second.awayWin },
        btts: { YES: second.bttsYes, NO: second.bttsNo },
        overUnder15: second.totals['1_5']
      },
      crossHalf: {
        halfWithMoreGoals: half.crossHalf.halfWithMoreGoals,
        homeWinEitherHalf: half.crossHalf.homeWinEitherHalf,
        awayWinEitherHalf: half.crossHalf.awayWinEitherHalf,
        homeWinBothHalves: half.crossHalf.homeWinBothHalves,
        awayWinBothHalves: half.crossHalf.awayWinBothHalves,
        topHalfTimeFullTime: topEntries(half.crossHalf.halfTimeFullTime, 3)
      },
      strongestHalfMarketProbabilities: universe.marketMapping.modelled.slice(0, 12),
      evidenceMaturity: row.evidenceMaturity ?? 0,
      lineupGate: row.lineupGate ?? 'PENDING',
      contextRisk: row.contextRisk ?? 'HIGH',
      finalQualificationState: 'NOT_EVALUATED_WITHOUT_FRESH_HALF_MARKET_PRICES_AND_FINAL_GATES',
      realMoney: 'NO'
    };
  });

  return {
    reportVersion: 'REAL_HALF_PROFILE_REASONING_V0_1',
    modelMarketSource: {
      generatedFromMarketBatch: modelMarketReport.generatedFromMarketBatch ?? null,
      generatedFromModelDataset: modelMarketReport.generatedFromModelDataset ?? null
    },
    halfProfileDatasetId: halfProfileDataset.datasetId,
    halfProfileSourceSeason: halfProfileDataset.sourceSeason,
    summary: {
      eventsReceived: modelMarketReport.modelBoard.length,
      halfModelReady: events.filter((x) => x.state === 'HALF_MODEL_READY_MARKET_PRICE_PENDING').length,
      waiting: events.filter((x) => x.state === 'WAIT').length,
      pricedHalfMarketsEvaluated: 0,
      qualifiedHalfMarketSignals: 0
    },
    events,
    governance: {
      teamAnalysisBeforeMarket: true,
      realHistoricalHalfProfilesUsed: true,
      bookmakerOddsUsedToCreateHalfProfile: false,
      marketPricesStillRequiredForEdgeAndEV: true,
      finalEvidenceLineupContextGatesStillRequired: true,
      noBetQualificationFromProbabilityAlone: true,
      capitalLocked: true,
      realMoney: 'NO'
    }
  };
}
