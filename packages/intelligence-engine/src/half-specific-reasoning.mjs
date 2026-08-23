import { buildBidirectionalMatchReasoning, buildScoreDistribution } from './bidirectional-match-reasoning.mjs';

function resultKey(homeGoals, awayGoals) {
  if (homeGoals > awayGoals) return 'HOME';
  if (homeGoals < awayGoals) return 'AWAY';
  return 'DRAW';
}

function freezeNested(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeNested(child);
  return Object.freeze(value);
}

export function buildHalfSpecificReasoning({
  eventId = null,
  homeTeam = 'HOME',
  awayTeam = 'AWAY',
  halfModel,
  maxGoalsPerHalf = 8
}) {
  if (!halfModel?.verified) throw new Error('VERIFIED_HALF_MODEL_REQUIRED');
  if (!Number.isInteger(maxGoalsPerHalf) || maxGoalsPerHalf < 4 || maxGoalsPerHalf > 15) {
    throw new Error('MAX_GOALS_PER_HALF_INVALID');
  }

  const firstHalfReasoning = buildBidirectionalMatchReasoning({
    eventId,
    homeTeam,
    awayTeam,
    homeLambda: halfModel.firstHalf.homeLambda,
    awayLambda: halfModel.firstHalf.awayLambda,
    maxGoals: maxGoalsPerHalf,
    totalLines: [0.5, 1.5, 2.5, 3.5],
    teamTotalLines: [0.5, 1.5, 2.5],
    correctScoreLimit: 8
  });
  const secondHalfReasoning = buildBidirectionalMatchReasoning({
    eventId,
    homeTeam,
    awayTeam,
    homeLambda: halfModel.secondHalf.homeLambda,
    awayLambda: halfModel.secondHalf.awayLambda,
    maxGoals: maxGoalsPerHalf,
    totalLines: [0.5, 1.5, 2.5, 3.5],
    teamTotalLines: [0.5, 1.5, 2.5],
    correctScoreLimit: 8
  });

  const firstDist = buildScoreDistribution({
    homeLambda: halfModel.firstHalf.homeLambda,
    awayLambda: halfModel.firstHalf.awayLambda,
    maxGoals: maxGoalsPerHalf
  });
  const secondDist = buildScoreDistribution({
    homeLambda: halfModel.secondHalf.homeLambda,
    awayLambda: halfModel.secondHalf.awayLambda,
    maxGoals: maxGoalsPerHalf
  });

  const htFt = {
    HOME_HOME: 0, HOME_DRAW: 0, HOME_AWAY: 0,
    DRAW_HOME: 0, DRAW_DRAW: 0, DRAW_AWAY: 0,
    AWAY_HOME: 0, AWAY_DRAW: 0, AWAY_AWAY: 0
  };
  const halfMore = { FIRST: 0, EQUAL: 0, SECOND: 0 };
  let homeWinBothHalves = 0;
  let awayWinBothHalves = 0;
  let homeWinEitherHalf = 0;
  let awayWinEitherHalf = 0;

  for (const first of firstDist.rows) {
    const firstResult = resultKey(first.homeGoals, first.awayGoals);
    const firstTotal = first.totalGoals;
    for (const second of secondDist.rows) {
      const p = first.probability * second.probability;
      const secondResult = resultKey(second.homeGoals, second.awayGoals);
      const secondTotal = second.totalGoals;
      const fullResult = resultKey(first.homeGoals + second.homeGoals, first.awayGoals + second.awayGoals);
      htFt[`${firstResult}_${fullResult}`] += p;
      if (firstTotal > secondTotal) halfMore.FIRST += p;
      else if (firstTotal < secondTotal) halfMore.SECOND += p;
      else halfMore.EQUAL += p;
      if (firstResult === 'HOME' && secondResult === 'HOME') homeWinBothHalves += p;
      if (firstResult === 'AWAY' && secondResult === 'AWAY') awayWinBothHalves += p;
      if (firstResult === 'HOME' || secondResult === 'HOME') homeWinEitherHalf += p;
      if (firstResult === 'AWAY' || secondResult === 'AWAY') awayWinEitherHalf += p;
    }
  }

  return freezeNested({
    reasoningVersion: 'HALF_SPECIFIC_REASONING_V0_1',
    eventId,
    homeTeam,
    awayTeam,
    model: halfModel,
    firstHalf: firstHalfReasoning,
    secondHalf: secondHalfReasoning,
    crossHalf: {
      halfTimeFullTime: htFt,
      halfWithMoreGoals: halfMore,
      homeWinBothHalves,
      awayWinBothHalves,
      homeWinEitherHalf,
      awayWinEitherHalf,
      homeFailToWinEitherHalf: 1 - homeWinEitherHalf,
      awayFailToWinEitherHalf: 1 - awayWinEitherHalf,
      homeFailToWinBothHalves: 1 - homeWinBothHalves,
      awayFailToWinBothHalves: 1 - awayWinBothHalves
    },
    governance: {
      verifiedHalfModelRequired: true,
      halvesModelledSeparately: true,
      htFtUsesJointHalfDistribution: true,
      halfWithMoreGoalsUsesJointHalfDistribution: true,
      bookmakerOddsUsedInReasoning: false,
      probabilityIsNotGuarantee: true
    }
  });
}
