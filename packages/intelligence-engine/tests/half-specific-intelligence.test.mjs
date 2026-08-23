import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveHalfSpecificLambdas } from '../src/half-specific-model.mjs';
import { buildHalfSpecificReasoning } from '../src/half-specific-reasoning.mjs';
import { buildBidirectionalMatchReasoning } from '../src/bidirectional-match-reasoning.mjs';
import { mapReasoningToMarketSelection, evaluatePricedMarketSelections } from '../src/market-mapping.mjs';
import { buildMatchDecisionUniverse } from '../src/match-decision-universe.mjs';

const verifiedProfile = {
  profileId: 'TEST_HALF_PROFILE',
  sourceSeason: '2025_26',
  sampleSize: 120,
  homeFirstHalfGoalShare: 0.44,
  awayFirstHalfGoalShare: 0.41,
  sources: ['INDEPENDENT_TEST_SOURCE'],
  sourceVerification: {
    primaryHalfStats: true,
    independenceFromMarket: true,
    preMatchOnly: true
  }
};

function model() {
  return deriveHalfSpecificLambdas({
    fullTimeHomeLambda: 1.8,
    fullTimeAwayLambda: 1.1,
    halfProfile: verifiedProfile
  });
}

function closeTo(a, b, eps = 1e-9) {
  assert.ok(Math.abs(a - b) <= eps, `${a} not close to ${b}`);
}

test('half model requires sufficient independently verified sample', () => {
  const unverified = deriveHalfSpecificLambdas({
    fullTimeHomeLambda: 1.8,
    fullTimeAwayLambda: 1.1,
    halfProfile: { ...verifiedProfile, sampleSize: 12 }
  });
  assert.equal(unverified.verified, false);
  assert.equal(model().verified, true);
});

test('first and second half lambdas conserve full-time lambdas', () => {
  const m = model();
  closeTo(m.firstHalf.homeLambda + m.secondHalf.homeLambda, 1.8);
  closeTo(m.firstHalf.awayLambda + m.secondHalf.awayLambda, 1.1);
});

test('half model does not use bookmaker odds', () => {
  const m = model();
  assert.equal(m.usesBookmakerOdds, false);
  assert.equal(m.independenceFromMarket, true);
});

test('first-half 1X2 probabilities sum to one', () => {
  const r = buildHalfSpecificReasoning({ halfModel: model() });
  const m = r.firstHalf.matchReality;
  closeTo(m.homeWin + m.draw + m.awayWin, 1);
});

test('second-half 1X2 probabilities sum to one', () => {
  const r = buildHalfSpecificReasoning({ halfModel: model() });
  const m = r.secondHalf.matchReality;
  closeTo(m.homeWin + m.draw + m.awayWin, 1);
});

test('HT/FT joint outcomes sum to one', () => {
  const r = buildHalfSpecificReasoning({ halfModel: model() });
  closeTo(Object.values(r.crossHalf.halfTimeFullTime).reduce((a, b) => a + b, 0), 1);
});

test('half-with-more-goals outcomes sum to one', () => {
  const r = buildHalfSpecificReasoning({ halfModel: model() });
  const x = r.crossHalf.halfWithMoreGoals;
  closeTo(x.FIRST + x.EQUAL + x.SECOND, 1);
});

test('win both halves cannot exceed win either half', () => {
  const r = buildHalfSpecificReasoning({ halfModel: model() });
  assert.ok(r.crossHalf.homeWinBothHalves <= r.crossHalf.homeWinEitherHalf);
  assert.ok(r.crossHalf.awayWinBothHalves <= r.crossHalf.awayWinEitherHalf);
});

test('half market stays blocked without verified half reasoning', () => {
  const full = buildBidirectionalMatchReasoning({ homeLambda: 1.8, awayLambda: 1.1 });
  const mapped = mapReasoningToMarketSelection(full, { marketFamily: '1X2_FIRST_HALF', selection: 'HOME' });
  assert.equal(mapped.status, 'HALF_MODEL_NOT_VERIFIED');
  assert.equal(mapped.modelProbability, null);
});

test('verified half model unlocks first-half and HT/FT mapping', () => {
  const full = buildBidirectionalMatchReasoning({ homeLambda: 1.8, awayLambda: 1.1 });
  const half = buildHalfSpecificReasoning({ halfModel: model() });
  const firstHalf = mapReasoningToMarketSelection(full, { marketFamily: '1X2_FIRST_HALF', selection: 'HOME' }, half);
  const htft = mapReasoningToMarketSelection(full, { marketFamily: 'HALF_TIME_FULL_TIME', selection: 'DRAW_HOME' }, half);
  assert.equal(firstHalf.status, 'MODELLED');
  assert.equal(htft.status, 'MODELLED');
  assert.ok(firstHalf.modelProbability > 0 && firstHalf.modelProbability < 1);
  assert.ok(htft.modelProbability > 0 && htft.modelProbability < 1);
});

test('priced half market still needs fair probability for edge', () => {
  const full = buildBidirectionalMatchReasoning({ homeLambda: 1.8, awayLambda: 1.1 });
  const half = buildHalfSpecificReasoning({ halfModel: model() });
  const pricing = evaluatePricedMarketSelections(full, [
    { marketFamily: 'BTTS_FIRST_HALF', selection: 'NO', odds: 1.4 }
  ], { halfReasoning: half });
  assert.equal(pricing.rows[0].decisionState, 'PRICE_ONLY_NO_FAIR_MARKET');
  assert.equal(pricing.rows[0].edge, null);
});

test('decision universe exposes verified half reasoning before market mapping', () => {
  const universe = buildMatchDecisionUniverse({
    eventId: 'E1',
    homeTeam: 'A',
    awayTeam: 'B',
    homeLambda: 1.8,
    awayLambda: 1.1,
    evidenceMaturity: 80,
    lineupGate: 'PASS',
    contextRisk: 'MEDIUM',
    halfProfile: verifiedProfile,
    availableMarketSelections: [
      { marketFamily: 'HALF_WITH_MORE_GOALS', selection: 'SECOND' },
      { marketFamily: '1X2_FIRST_HALF', selection: 'HOME' }
    ]
  });
  assert.equal(universe.halfModelState, 'VERIFIED');
  assert.ok(universe.halfTruthBoard.length > 0);
  assert.equal(universe.marketMapping.unsupported.length, 0);
  assert.equal(universe.governance.halfMarketsRequireIndependentVerifiedHalfProfile, true);
});
