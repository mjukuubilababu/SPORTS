import { MATCH_OUTCOMES } from './outcome-1x2.mjs';

const CLASSES = [MATCH_OUTCOMES.HOME_WIN, MATCH_OUTCOMES.DRAW, MATCH_OUTCOMES.AWAY_WIN];

function emptyConfusionMatrix() {
  return Object.fromEntries(CLASSES.map(predicted => [predicted, Object.fromEntries(CLASSES.map(actual => [actual, 0]))]));
}

export function evaluateOutcomeSettlements(settlements) {
  if (!Array.isArray(settlements) || settlements.length === 0) throw new Error('SETTLEMENTS_REQUIRED');

  const confusionMatrix = emptyConfusionMatrix();
  let correct = 0;
  let brierSum = 0;
  let logLossSum = 0;

  for (const row of settlements) {
    if (!CLASSES.includes(row.predictedOutcome) || !CLASSES.includes(row.actualOutcome)) throw new Error('SETTLEMENT_OUTCOME_INVALID');
    confusionMatrix[row.predictedOutcome][row.actualOutcome] += 1;
    if (row.predictionCorrect) correct += 1;
    brierSum += row.brierScore;
    logLossSum += row.logLoss;
  }

  const perClass = {};
  for (const target of CLASSES) {
    const truePositive = confusionMatrix[target][target];
    const predictedCount = CLASSES.reduce((sum, actual) => sum + confusionMatrix[target][actual], 0);
    const actualCount = CLASSES.reduce((sum, predicted) => sum + confusionMatrix[predicted][target], 0);
    perClass[target] = Object.freeze({
      support: actualCount,
      predictedCount,
      precision: predictedCount === 0 ? null : truePositive / predictedCount,
      recall: actualCount === 0 ? null : truePositive / actualCount
    });
  }

  return Object.freeze({
    n: settlements.length,
    accuracy: correct / settlements.length,
    meanBrierScore: brierSum / settlements.length,
    meanLogLoss: logLossSum / settlements.length,
    confusionMatrix: Object.freeze(Object.fromEntries(
      Object.entries(confusionMatrix).map(([key, value]) => [key, Object.freeze({ ...value })])
    )),
    perClass: Object.freeze(perClass),
    capitalEffect: 'NONE'
  });
}
