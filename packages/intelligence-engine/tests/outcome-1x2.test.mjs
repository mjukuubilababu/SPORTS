import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MATCH_OUTCOMES,
  predict1X2,
  createPreMatchOutcomeSnapshot,
  predictLive1X2,
  classifyFinalOutcome,
  settle1X2Prediction,
  evaluateOutcomeSettlements
} from '../src/index.mjs';

function snapshot(overrides = {}) {
  return createPreMatchOutcomeSnapshot({
    signalId: 'SIG-1X2-001',
    eventId: 'MATCH-001',
    modelVersion: 'model-v0.1',
    featureVersion: 'features-v0.1',
    marketSnapshotId: 'MARKET-001',
    homeLambda: 1.8,
    awayLambda: 1.0,
    createdAt: '2026-08-22T17:00:00Z',
    frozenAt: '2026-08-22T17:05:00Z',
    ...overrides
  });
}

test('1X2 probabilities are normalized and deterministic from lambdas', () => {
  const result = predict1X2({ homeLambda: 1.8, awayLambda: 1.0 });
  const total = result.probabilities.homeWin + result.probabilities.draw + result.probabilities.awayWin;
  assert.ok(Math.abs(total - 1) < 1e-12);
  assert.ok(Math.abs(result.probabilities.homeWin - 0.5614865857196338) < 1e-12);
  assert.ok(Math.abs(result.probabilities.draw - 0.23056776972292942) < 1e-12);
  assert.ok(Math.abs(result.probabilities.awayWin - 0.20794564455743678) < 1e-12);
  assert.equal(result.predictedOutcome, MATCH_OUTCOMES.HOME_WIN);
  assert.deepEqual(
    { home: result.mostLikelyScore.homeGoals, away: result.mostLikelyScore.awayGoals },
    { home: 1, away: 0 }
  );
  assert.equal(result.realMoney, 'NO');
});

test('pre-match outcome snapshot is deeply frozen for no-hindsight', () => {
  const pre = snapshot();
  assert.equal(pre.snapshotType, 'PRE_MATCH');
  assert.equal(pre.immutable, true);
  assert.equal(Object.isFrozen(pre), true);
  assert.equal(Object.isFrozen(pre.probabilities), true);
  assert.throws(() => { pre.homeLambda = 9; }, TypeError);
});

test('live prediction updates from current score and remaining time without mutating pre-match snapshot', () => {
  const pre = snapshot();
  const originalHome = pre.probabilities.homeWin;
  const live = predictLive1X2({
    preMatchSnapshot: pre,
    minute: 70,
    homeScore: 1,
    awayScore: 0,
    observedAt: '2026-08-22T18:30:00Z'
  });

  assert.equal(live.snapshotType, 'LIVE');
  assert.equal(live.parentSignalId, pre.signalId);
  assert.ok(Math.abs(live.probabilities.homeWin - 0.8606298294321703) < 1e-12);
  assert.ok(live.probabilities.homeWin > originalHome);
  assert.equal(pre.probabilities.homeWin, originalHome);
  assert.equal(live.preMatchSnapshotPreserved, true);
  assert.equal(live.realMoney, 'NO');
});

test('explicit live rate multipliers are accepted only as bounded evidence-driven inputs', () => {
  const pre = snapshot();
  const live = predictLive1X2({
    preMatchSnapshot: pre,
    minute: 60,
    homeScore: 1,
    awayScore: 1,
    homeRateMultiplier: 1.2,
    awayRateMultiplier: 0.8,
    observedAt: '2026-08-22T18:20:00Z',
    evidence: [{ id: 'RED_CARD-1', verified: true, provider: 'A' }]
  });
  assert.equal(live.rateMultipliers.home, 1.2);
  assert.equal(live.evidence[0].verified, true);
  assert.throws(() => predictLive1X2({
    preMatchSnapshot: pre,
    minute: 60,
    homeScore: 1,
    awayScore: 1,
    homeRateMultiplier: 9,
    observedAt: '2026-08-22T18:20:00Z'
  }), /HOME_RATE_MULTIPLIER_INVALID/);
});

test('at full time live probabilities collapse to the observed outcome', () => {
  const pre = snapshot();
  const live = predictLive1X2({
    preMatchSnapshot: pre,
    minute: 90,
    homeScore: 2,
    awayScore: 2,
    observedAt: '2026-08-22T19:00:00Z'
  });
  assert.equal(live.predictedOutcome, MATCH_OUTCOMES.DRAW);
  assert.equal(live.probabilities.draw, 1);
});

test('settlement classifies home/draw/away and scores frozen probabilities', () => {
  const pre = snapshot();
  assert.equal(classifyFinalOutcome(2, 1), MATCH_OUTCOMES.HOME_WIN);
  assert.equal(classifyFinalOutcome(1, 1), MATCH_OUTCOMES.DRAW);
  assert.equal(classifyFinalOutcome(0, 2), MATCH_OUTCOMES.AWAY_WIN);

  const settled = settle1X2Prediction({
    predictionSnapshot: pre,
    homeScore: 2,
    awayScore: 1,
    settledAt: '2026-08-22T19:05:00Z'
  });
  assert.equal(settled.result, 'CORRECT');
  assert.equal(settled.predictionCorrect, true);
  assert.equal(settled.noHindsight, true);
  assert.ok(settled.brierScore >= 0);
  assert.ok(settled.logLoss >= 0);
  assert.equal(settled.realMoney, 'NO');
});

test('aggregate evaluation exposes class-specific draw performance and confusion matrix', () => {
  const homePrediction = snapshot();
  const drawPrediction = Object.freeze({
    ...snapshot({ signalId: 'SIG-1X2-002', eventId: 'MATCH-002', homeLambda: 0.8, awayLambda: 0.8 }),
    probabilities: Object.freeze({ homeWin: 0.25, draw: 0.5, awayWin: 0.25 }),
    predictedOutcome: MATCH_OUTCOMES.DRAW
  });

  const rows = [
    settle1X2Prediction({ predictionSnapshot: homePrediction, homeScore: 2, awayScore: 1, settledAt: '2026-08-22T19:05:00Z' }),
    settle1X2Prediction({ predictionSnapshot: drawPrediction, homeScore: 1, awayScore: 1, settledAt: '2026-08-22T20:05:00Z' })
  ];
  const evaluation = evaluateOutcomeSettlements(rows);
  assert.equal(evaluation.n, 2);
  assert.equal(evaluation.accuracy, 1);
  assert.equal(evaluation.perClass.DRAW.support, 1);
  assert.equal(evaluation.perClass.DRAW.recall, 1);
  assert.equal(evaluation.confusionMatrix.DRAW.DRAW, 1);
  assert.equal(evaluation.capitalEffect, 'NONE');
});
