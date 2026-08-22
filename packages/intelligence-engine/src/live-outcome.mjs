import { MATCH_OUTCOMES, poissonProbability } from './outcome-1x2.mjs';

function assertScore(name, value) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name}_INVALID`);
}

function assertMultiplier(name, value) {
  if (!Number.isFinite(value) || value < 0 || value > 5) throw new Error(`${name}_INVALID`);
}

function normalize({ homeWin, draw, awayWin }) {
  const total = homeWin + draw + awayWin;
  if (!(total > 0)) throw new Error('LIVE_PROBABILITY_MASS_INVALID');
  return { homeWin: homeWin / total, draw: draw / total, awayWin: awayWin / total };
}

function outcomeFromProbabilities(probabilities) {
  return [
    [MATCH_OUTCOMES.HOME_WIN, probabilities.homeWin],
    [MATCH_OUTCOMES.DRAW, probabilities.draw],
    [MATCH_OUTCOMES.AWAY_WIN, probabilities.awayWin]
  ].sort((a, b) => b[1] - a[1])[0][0];
}

export function predictLive1X2({
  preMatchSnapshot,
  minute,
  homeScore,
  awayScore,
  observedAt,
  regulationMinutes = 90,
  homeRateMultiplier = 1,
  awayRateMultiplier = 1,
  maxAdditionalGoals = 8,
  evidence = []
}) {
  if (!preMatchSnapshot || preMatchSnapshot.snapshotType !== 'PRE_MATCH' || preMatchSnapshot.immutable !== true) {
    throw new Error('FROZEN_PREMATCH_SNAPSHOT_REQUIRED');
  }
  if (!Number.isFinite(minute) || minute < 0 || minute > regulationMinutes) throw new Error('MINUTE_INVALID');
  if (!Number.isFinite(regulationMinutes) || regulationMinutes <= 0 || regulationMinutes > 120) throw new Error('REGULATION_MINUTES_INVALID');
  assertScore('HOME_SCORE', homeScore);
  assertScore('AWAY_SCORE', awayScore);
  assertMultiplier('HOME_RATE_MULTIPLIER', homeRateMultiplier);
  assertMultiplier('AWAY_RATE_MULTIPLIER', awayRateMultiplier);
  if (!observedAt) throw new Error('OBSERVED_AT_REQUIRED');
  if (!Number.isInteger(maxAdditionalGoals) || maxAdditionalGoals < 3 || maxAdditionalGoals > 20) throw new Error('MAX_ADDITIONAL_GOALS_INVALID');
  if (!Array.isArray(evidence)) throw new Error('EVIDENCE_ARRAY_REQUIRED');

  const remainingFraction = Math.max(0, regulationMinutes - minute) / regulationMinutes;
  const remainingHomeLambda = preMatchSnapshot.homeLambda * remainingFraction * homeRateMultiplier;
  const remainingAwayLambda = preMatchSnapshot.awayLambda * remainingFraction * awayRateMultiplier;

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let best = { finalHomeScore: homeScore, finalAwayScore: awayScore, probability: -1 };

  for (let homeAdditional = 0; homeAdditional <= maxAdditionalGoals; homeAdditional += 1) {
    const pHome = poissonProbability(remainingHomeLambda, homeAdditional);
    for (let awayAdditional = 0; awayAdditional <= maxAdditionalGoals; awayAdditional += 1) {
      const probability = pHome * poissonProbability(remainingAwayLambda, awayAdditional);
      const finalHomeScore = homeScore + homeAdditional;
      const finalAwayScore = awayScore + awayAdditional;
      if (finalHomeScore > finalAwayScore) homeWin += probability;
      else if (finalHomeScore === finalAwayScore) draw += probability;
      else awayWin += probability;
      if (probability > best.probability) best = { finalHomeScore, finalAwayScore, probability };
    }
  }

  const probabilities = Object.freeze(normalize({ homeWin, draw, awayWin }));
  const predictedOutcome = outcomeFromProbabilities(probabilities);

  return Object.freeze({
    snapshotType: 'LIVE',
    immutable: true,
    parentSignalId: preMatchSnapshot.signalId,
    eventId: preMatchSnapshot.eventId,
    modelVersion: preMatchSnapshot.modelVersion,
    featureVersion: preMatchSnapshot.featureVersion,
    observedAt,
    minute,
    score: Object.freeze({ home: homeScore, away: awayScore }),
    remainingFraction,
    remainingHomeLambda,
    remainingAwayLambda,
    rateMultipliers: Object.freeze({ home: homeRateMultiplier, away: awayRateMultiplier }),
    evidence: Object.freeze(evidence.map(item => Object.freeze({ ...item }))),
    probabilities,
    predictedOutcome,
    confidence: Math.max(probabilities.homeWin, probabilities.draw, probabilities.awayWin),
    mostLikelyFinalScore: Object.freeze({ ...best }),
    preMatchSnapshotPreserved: Object.isFrozen(preMatchSnapshot),
    realMoney: 'NO'
  });
}
