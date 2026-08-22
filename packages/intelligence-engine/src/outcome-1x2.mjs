export const MATCH_OUTCOMES = Object.freeze({
  HOME_WIN: 'HOME_WIN',
  DRAW: 'DRAW',
  AWAY_WIN: 'AWAY_WIN'
});

function assertFiniteNonNegative(name, value) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name}_INVALID`);
}

function factorial(n) {
  let value = 1;
  for (let i = 2; i <= n; i += 1) value *= i;
  return value;
}

export function poissonProbability(lambda, goals) {
  assertFiniteNonNegative('LAMBDA', lambda);
  if (!Number.isInteger(goals) || goals < 0) throw new Error('GOALS_INVALID');
  return Math.exp(-lambda) * (lambda ** goals) / factorial(goals);
}

function normalizeProbabilities(probabilities) {
  const total = probabilities.homeWin + probabilities.draw + probabilities.awayWin;
  if (!(total > 0)) throw new Error('PROBABILITY_MASS_INVALID');
  return {
    homeWin: probabilities.homeWin / total,
    draw: probabilities.draw / total,
    awayWin: probabilities.awayWin / total
  };
}

function predictedOutcome(probabilities) {
  const ranked = [
    [MATCH_OUTCOMES.HOME_WIN, probabilities.homeWin],
    [MATCH_OUTCOMES.DRAW, probabilities.draw],
    [MATCH_OUTCOMES.AWAY_WIN, probabilities.awayWin]
  ].sort((a, b) => b[1] - a[1]);
  return ranked[0][0];
}

function scoreMatrixFromLambdas(homeLambda, awayLambda, maxGoals) {
  const rows = [];
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let best = { homeGoals: 0, awayGoals: 0, probability: -1 };

  for (let homeGoals = 0; homeGoals <= maxGoals; homeGoals += 1) {
    const pHome = poissonProbability(homeLambda, homeGoals);
    for (let awayGoals = 0; awayGoals <= maxGoals; awayGoals += 1) {
      const probability = pHome * poissonProbability(awayLambda, awayGoals);
      rows.push({ homeGoals, awayGoals, probability });
      if (homeGoals > awayGoals) homeWin += probability;
      else if (homeGoals === awayGoals) draw += probability;
      else awayWin += probability;
      if (probability > best.probability) best = { homeGoals, awayGoals, probability };
    }
  }

  return {
    rows,
    probabilities: normalizeProbabilities({ homeWin, draw, awayWin }),
    mostLikelyScore: best
  };
}

export function predict1X2({ homeLambda, awayLambda, maxGoals = 12 }) {
  assertFiniteNonNegative('HOME_LAMBDA', homeLambda);
  assertFiniteNonNegative('AWAY_LAMBDA', awayLambda);
  if (!Number.isInteger(maxGoals) || maxGoals < 4 || maxGoals > 30) throw new Error('MAX_GOALS_INVALID');

  const matrix = scoreMatrixFromLambdas(homeLambda, awayLambda, maxGoals);
  const outcome = predictedOutcome(matrix.probabilities);
  const confidence = Math.max(
    matrix.probabilities.homeWin,
    matrix.probabilities.draw,
    matrix.probabilities.awayWin
  );

  return {
    homeLambda,
    awayLambda,
    expectedTotalGoals: homeLambda + awayLambda,
    probabilities: Object.freeze({ ...matrix.probabilities }),
    predictedOutcome: outcome,
    confidence,
    mostLikelyScore: Object.freeze({ ...matrix.mostLikelyScore }),
    probabilityMassPolicy: `TRUNCATE_0_${maxGoals}_THEN_NORMALIZE`,
    realMoney: 'NO'
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function createPreMatchOutcomeSnapshot({
  signalId,
  eventId,
  modelVersion,
  featureVersion,
  marketSnapshotId = null,
  homeLambda,
  awayLambda,
  createdAt,
  frozenAt,
  maxGoals = 12
}) {
  if (!signalId || !eventId || !modelVersion || !featureVersion) throw new Error('SNAPSHOT_IDENTITY_REQUIRED');
  if (!createdAt || !frozenAt) throw new Error('SNAPSHOT_TIMESTAMPS_REQUIRED');
  if (Date.parse(frozenAt) < Date.parse(createdAt)) throw new Error('FROZEN_BEFORE_CREATED');

  const prediction = predict1X2({ homeLambda, awayLambda, maxGoals });
  return deepFreeze({
    snapshotType: 'PRE_MATCH',
    immutable: true,
    signalId,
    eventId,
    modelVersion,
    featureVersion,
    marketSnapshotId,
    createdAt,
    frozenAt,
    ...prediction
  });
}
