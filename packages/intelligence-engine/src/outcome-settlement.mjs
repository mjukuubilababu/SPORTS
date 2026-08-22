import { MATCH_OUTCOMES } from './outcome-1x2.mjs';

export function classifyFinalOutcome(homeScore, awayScore) {
  if (!Number.isInteger(homeScore) || homeScore < 0) throw new Error('HOME_SCORE_INVALID');
  if (!Number.isInteger(awayScore) || awayScore < 0) throw new Error('AWAY_SCORE_INVALID');
  if (homeScore > awayScore) return MATCH_OUTCOMES.HOME_WIN;
  if (homeScore < awayScore) return MATCH_OUTCOMES.AWAY_WIN;
  return MATCH_OUTCOMES.DRAW;
}

function probabilityForOutcome(probabilities, outcome) {
  if (outcome === MATCH_OUTCOMES.HOME_WIN) return probabilities.homeWin;
  if (outcome === MATCH_OUTCOMES.DRAW) return probabilities.draw;
  if (outcome === MATCH_OUTCOMES.AWAY_WIN) return probabilities.awayWin;
  throw new Error('OUTCOME_INVALID');
}

function multiclassBrier(probabilities, actualOutcome) {
  const classes = [
    [MATCH_OUTCOMES.HOME_WIN, probabilities.homeWin],
    [MATCH_OUTCOMES.DRAW, probabilities.draw],
    [MATCH_OUTCOMES.AWAY_WIN, probabilities.awayWin]
  ];
  return classes.reduce((sum, [outcome, probability]) => {
    const target = outcome === actualOutcome ? 1 : 0;
    return sum + ((probability - target) ** 2);
  }, 0);
}

export function settle1X2Prediction({ predictionSnapshot, homeScore, awayScore, settledAt }) {
  if (!predictionSnapshot || !predictionSnapshot.probabilities || !predictionSnapshot.predictedOutcome) {
    throw new Error('PREDICTION_SNAPSHOT_REQUIRED');
  }
  if (!predictionSnapshot.immutable) throw new Error('IMMUTABLE_PREDICTION_REQUIRED');
  if (!settledAt) throw new Error('SETTLED_AT_REQUIRED');

  const actualOutcome = classifyFinalOutcome(homeScore, awayScore);
  const actualProbability = probabilityForOutcome(predictionSnapshot.probabilities, actualOutcome);
  const epsilon = 1e-15;
  const clippedProbability = Math.min(1 - epsilon, Math.max(epsilon, actualProbability));
  const correct = predictionSnapshot.predictedOutcome === actualOutcome;

  return Object.freeze({
    eventId: predictionSnapshot.eventId,
    sourceSnapshotType: predictionSnapshot.snapshotType,
    sourceSignalId: predictionSnapshot.signalId ?? predictionSnapshot.parentSignalId ?? null,
    finalScore: Object.freeze({ home: homeScore, away: awayScore }),
    actualOutcome,
    predictedOutcome: predictionSnapshot.predictedOutcome,
    predictionCorrect: correct,
    result: correct ? 'CORRECT' : 'INCORRECT',
    actualOutcomeProbability: actualProbability,
    brierScore: multiclassBrier(predictionSnapshot.probabilities, actualOutcome),
    brierDefinition: 'MULTICLASS_SUM_SQUARED_ERROR',
    logLoss: -Math.log(clippedProbability),
    settledAt,
    noHindsight: true,
    realMoney: 'NO'
  });
}
