export const BETPAWA_MARKET_CAPABILITIES = Object.freeze({
  '1X2_FULL_TIME': 'SUPPORTED_SCORE_DISTRIBUTION',
  'TOTAL_GOALS_OVER_UNDER_FULL_TIME': 'SUPPORTED_SCORE_DISTRIBUTION',
  'HOME_TEAM_OVER_UNDER_FULL_TIME': 'SUPPORTED_SCORE_DISTRIBUTION',
  'AWAY_TEAM_OVER_UNDER_FULL_TIME': 'SUPPORTED_SCORE_DISTRIBUTION',
  'DOUBLE_CHANCE_FULL_TIME': 'SUPPORTED_SCORE_DISTRIBUTION',
  'BTTS_FULL_TIME': 'SUPPORTED_SCORE_DISTRIBUTION',
  'CLEAN_SHEET_HOME': 'SUPPORTED_SCORE_DISTRIBUTION',
  'CLEAN_SHEET_AWAY': 'SUPPORTED_SCORE_DISTRIBUTION',
  'CORRECT_SCORE_FULL_TIME': 'SUPPORTED_SCORE_DISTRIBUTION',
  'TEAM_TO_SCORE_4WAY_FULL_TIME': 'SUPPORTED_SCORE_DISTRIBUTION',
  'ODD_EVEN_FULL_TIME': 'SUPPORTED_SCORE_DISTRIBUTION',
  'TOTAL_GOALS_EXACT_FULL_TIME': 'SUPPORTED_SCORE_DISTRIBUTION',
  'MULTIGOALS_FULL_TIME': 'SUPPORTED_SCORE_DISTRIBUTION',
  'DRAW_NO_BET_FULL_TIME': 'SUPPORTED_CONDITIONAL_RESULT',
  '1X2_FIRST_HALF': 'SUPPORTED_HALF_SPECIFIC_MODEL',
  '1X2_SECOND_HALF': 'SUPPORTED_HALF_SPECIFIC_MODEL',
  'OVER_UNDER_FIRST_HALF': 'SUPPORTED_HALF_SPECIFIC_MODEL',
  'OVER_UNDER_SECOND_HALF': 'SUPPORTED_HALF_SPECIFIC_MODEL',
  'DOUBLE_CHANCE_FIRST_HALF': 'SUPPORTED_HALF_SPECIFIC_MODEL',
  'DOUBLE_CHANCE_SECOND_HALF': 'SUPPORTED_HALF_SPECIFIC_MODEL',
  'BTTS_FIRST_HALF': 'SUPPORTED_HALF_SPECIFIC_MODEL',
  'BTTS_SECOND_HALF': 'SUPPORTED_HALF_SPECIFIC_MODEL',
  'CORRECT_SCORE_FIRST_HALF': 'SUPPORTED_HALF_SPECIFIC_MODEL',
  'HALF_TIME_FULL_TIME': 'SUPPORTED_HALF_SPECIFIC_MODEL',
  'HALF_WITH_MORE_GOALS': 'SUPPORTED_HALF_SPECIFIC_MODEL',
  'HOME_WIN_BOTH_HALVES': 'SUPPORTED_HALF_SPECIFIC_MODEL',
  'AWAY_WIN_BOTH_HALVES': 'SUPPORTED_HALF_SPECIFIC_MODEL',
  'HOME_WIN_EITHER_HALF': 'SUPPORTED_HALF_SPECIFIC_MODEL',
  'AWAY_WIN_EITHER_HALF': 'SUPPORTED_HALF_SPECIFIC_MODEL',
  'GOALSCORER': 'REQUIRES_PLAYER_EVENT_MODEL',
  'CARDS': 'REQUIRES_CARD_EVENT_MODEL',
  'CORNERS': 'REQUIRES_CORNER_EVENT_MODEL'
});

function lineKey(line) {
  return String(line).replace('.', '_');
}

function selectionProbability(reasoning, marketFamily, selection, line = null) {
  const m = reasoning.matchReality;
  const h = reasoning.teamReality.home;
  const a = reasoning.teamReality.away;
  switch (marketFamily) {
    case '1X2_FULL_TIME':
      return { HOME: m.homeWin, DRAW: m.draw, AWAY: m.awayWin }[selection] ?? null;
    case 'DOUBLE_CHANCE_FULL_TIME':
      return { '1X': m.homeNotLose, 'X2': m.awayNotLose, '12': m.decisiveResult }[selection] ?? null;
    case 'BTTS_FULL_TIME':
      return { YES: m.bttsYes, NO: m.bttsNo }[selection] ?? null;
    case 'CLEAN_SHEET_HOME':
      return { YES: h.cleanSheet, NO: h.concedeAtLeastOne }[selection] ?? null;
    case 'CLEAN_SHEET_AWAY':
      return { YES: a.cleanSheet, NO: a.concedeAtLeastOne }[selection] ?? null;
    case 'ODD_EVEN_FULL_TIME':
      return { ODD: m.totalOdd, EVEN: m.totalEven }[selection] ?? null;
    case 'TEAM_TO_SCORE_4WAY_FULL_TIME':
      return { BOTH: m.bothScore, HOME_ONLY: m.homeOnlyScores, AWAY_ONLY: m.awayOnlyScores, NEITHER: m.noGoal }[selection] ?? null;
    case 'TOTAL_GOALS_OVER_UNDER_FULL_TIME': {
      if (!Number.isFinite(line)) return null;
      const row = m.totals[lineKey(line)];
      return row ? ({ OVER: row.over, UNDER: row.under }[selection] ?? null) : null;
    }
    case 'HOME_TEAM_OVER_UNDER_FULL_TIME': {
      if (!Number.isFinite(line)) return null;
      const row = m.homeTeamTotals[lineKey(line)];
      return row ? ({ OVER: row.over, UNDER: row.under }[selection] ?? null) : null;
    }
    case 'AWAY_TEAM_OVER_UNDER_FULL_TIME': {
      if (!Number.isFinite(line)) return null;
      const row = m.awayTeamTotals[lineKey(line)];
      return row ? ({ OVER: row.over, UNDER: row.under }[selection] ?? null) : null;
    }
    case 'TOTAL_GOALS_EXACT_FULL_TIME':
      return m.exactTotalGoals[String(selection)] ?? null;
    case 'CORRECT_SCORE_FULL_TIME':
      return m.topCorrectScores.find((x) => x.score === selection)?.probability ?? null;
    case 'DRAW_NO_BET_FULL_TIME': {
      const nonDraw = m.homeWin + m.awayWin;
      if (!(nonDraw > 0)) return null;
      return { HOME: m.homeWin / nonDraw, AWAY: m.awayWin / nonDraw }[selection] ?? null;
    }
    default:
      return null;
  }
}

function halfSelectionProbability(halfReasoning, marketFamily, selection, line = null) {
  if (!halfReasoning?.model?.verified) return null;
  const first = halfReasoning.firstHalf.matchReality;
  const second = halfReasoning.secondHalf.matchReality;
  const cross = halfReasoning.crossHalf;
  switch (marketFamily) {
    case '1X2_FIRST_HALF':
      return { HOME: first.homeWin, DRAW: first.draw, AWAY: first.awayWin }[selection] ?? null;
    case '1X2_SECOND_HALF':
      return { HOME: second.homeWin, DRAW: second.draw, AWAY: second.awayWin }[selection] ?? null;
    case 'OVER_UNDER_FIRST_HALF': {
      if (!Number.isFinite(line)) return null;
      const row = first.totals[lineKey(line)];
      return row ? ({ OVER: row.over, UNDER: row.under }[selection] ?? null) : null;
    }
    case 'OVER_UNDER_SECOND_HALF': {
      if (!Number.isFinite(line)) return null;
      const row = second.totals[lineKey(line)];
      return row ? ({ OVER: row.over, UNDER: row.under }[selection] ?? null) : null;
    }
    case 'DOUBLE_CHANCE_FIRST_HALF':
      return { '1X': first.homeNotLose, 'X2': first.awayNotLose, '12': first.decisiveResult }[selection] ?? null;
    case 'DOUBLE_CHANCE_SECOND_HALF':
      return { '1X': second.homeNotLose, 'X2': second.awayNotLose, '12': second.decisiveResult }[selection] ?? null;
    case 'BTTS_FIRST_HALF':
      return { YES: first.bttsYes, NO: first.bttsNo }[selection] ?? null;
    case 'BTTS_SECOND_HALF':
      return { YES: second.bttsYes, NO: second.bttsNo }[selection] ?? null;
    case 'CORRECT_SCORE_FIRST_HALF':
      return halfReasoning.firstHalf.matchReality.topCorrectScores.find((x) => x.score === selection)?.probability ?? null;
    case 'HALF_TIME_FULL_TIME':
      return cross.halfTimeFullTime[selection] ?? null;
    case 'HALF_WITH_MORE_GOALS':
      return cross.halfWithMoreGoals[selection] ?? null;
    case 'HOME_WIN_BOTH_HALVES':
      return { YES: cross.homeWinBothHalves, NO: cross.homeFailToWinBothHalves }[selection] ?? null;
    case 'AWAY_WIN_BOTH_HALVES':
      return { YES: cross.awayWinBothHalves, NO: cross.awayFailToWinBothHalves }[selection] ?? null;
    case 'HOME_WIN_EITHER_HALF':
      return { YES: cross.homeWinEitherHalf, NO: cross.homeFailToWinEitherHalf }[selection] ?? null;
    case 'AWAY_WIN_EITHER_HALF':
      return { YES: cross.awayWinEitherHalf, NO: cross.awayFailToWinEitherHalf }[selection] ?? null;
    default:
      return null;
  }
}

export function mapReasoningToMarketSelection(reasoning, marketSelection, halfReasoning = null) {
  const capability = BETPAWA_MARKET_CAPABILITIES[marketSelection.marketFamily] ?? 'UNRECOGNIZED_MARKET';
  if (!capability.startsWith('SUPPORTED')) {
    return Object.freeze({
      ...marketSelection,
      capability,
      status: 'UNSUPPORTED_UNTIL_MODEL_EXISTS',
      modelProbability: null,
      counterProbability: null
    });
  }

  const halfSpecific = capability === 'SUPPORTED_HALF_SPECIFIC_MODEL';
  if (halfSpecific && !halfReasoning?.model?.verified) {
    return Object.freeze({
      ...marketSelection,
      capability,
      status: 'HALF_MODEL_NOT_VERIFIED',
      modelProbability: null,
      counterProbability: null
    });
  }

  const modelProbability = halfSpecific
    ? halfSelectionProbability(halfReasoning, marketSelection.marketFamily, marketSelection.selection, marketSelection.line)
    : selectionProbability(reasoning, marketSelection.marketFamily, marketSelection.selection, marketSelection.line);
  if (!Number.isFinite(modelProbability)) {
    return Object.freeze({ ...marketSelection, capability, status: 'UNMAPPED_SELECTION', modelProbability: null, counterProbability: null });
  }
  return Object.freeze({
    ...marketSelection,
    capability,
    status: 'MODELLED',
    modelProbability,
    counterProbability: 1 - modelProbability,
    probabilityMargin: modelProbability - (1 - modelProbability),
    modelLayer: halfSpecific ? 'HALF_SPECIFIC' : 'FULL_TIME_SCORE_DISTRIBUTION'
  });
}

export function rankAvailableMarketSelections(reasoning, selections, { minimumProbability = 0.5, halfReasoning = null } = {}) {
  const mapped = selections.map((selection) => mapReasoningToMarketSelection(reasoning, selection, halfReasoning));
  const modelled = mapped
    .filter((row) => row.status === 'MODELLED' && row.modelProbability >= minimumProbability)
    .sort((a, b) => b.modelProbability - a.modelProbability)
    .map((row, index) => Object.freeze({ rank: index + 1, ...row }));
  return Object.freeze({
    mode: 'MATCH_FIRST_THEN_MARKET_MAPPING',
    modelled: Object.freeze(modelled),
    unsupported: Object.freeze(mapped.filter((row) => row.status !== 'MODELLED')),
    governance: Object.freeze({
      marketCannotCreateProbabilityWithoutModel: true,
      unsupportedMarketFamiliesRemainBlocked: true,
      halfMarketsRequireVerifiedHalfModel: true,
      probabilityRankingIsNotValueRanking: true
    })
  });
}

export function evaluatePricedMarketSelections(reasoning, pricedSelections, { minEdge = 0.05, halfReasoning = null } = {}) {
  const rows = pricedSelections.map((selection) => {
    const mapped = mapReasoningToMarketSelection(reasoning, selection, halfReasoning);
    if (mapped.status !== 'MODELLED') return mapped;
    if (!(selection.odds > 1)) return Object.freeze({ ...mapped, status: 'INVALID_ODDS' });
    const marketFairProbability = Number.isFinite(selection.marketFairProbability) ? selection.marketFairProbability : null;
    const edge = marketFairProbability === null ? null : mapped.modelProbability - marketFairProbability;
    const ev = mapped.modelProbability * selection.odds - 1;
    const decisionState = edge === null
      ? 'PRICE_ONLY_NO_FAIR_MARKET'
      : (edge >= minEdge && ev > 0 ? 'VALUE_CANDIDATE' : 'NO_VALUE_EDGE');
    return Object.freeze({ ...mapped, odds: selection.odds, marketFairProbability, edge, edgePp: edge === null ? null : edge * 100, ev, decisionState });
  });
  return Object.freeze({
    rows: Object.freeze(rows),
    rankedByProbability: Object.freeze(rows.filter((x) => x.status === 'MODELLED').sort((a, b) => b.modelProbability - a.modelProbability)),
    rankedValueCandidates: Object.freeze(rows.filter((x) => x.decisionState === 'VALUE_CANDIDATE').sort((a, b) => (b.edge - a.edge) || (b.ev - a.ev))),
    governance: Object.freeze({ highestProbabilityIsNotAutomaticallyBestBet: true, fairMarketProbabilityRequiredForEdge: true, halfMarketsRequireVerifiedHalfModel: true })
  });
}
