import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBidirectionalMatchReasoning } from '../src/bidirectional-match-reasoning.mjs';
import { mapReasoningToMarketSelection, rankAvailableMarketSelections, evaluatePricedMarketSelections, BETPAWA_MARKET_CAPABILITIES } from '../src/market-mapping.mjs';
import { buildMatchDecisionUniverse } from '../src/match-decision-universe.mjs';

const reasoning = buildBidirectionalMatchReasoning({ eventId:'E1', homeTeam:'HOME FC', awayTeam:'AWAY FC', homeLambda:2.0, awayLambda:0.8 });

test('1X2 sums to 1', () => {
  const m = reasoning.matchReality;
  assert.ok(Math.abs(m.homeWin + m.draw + m.awayWin - 1) < 1e-10);
});

test('every binary claim explicitly evaluates its counter-outcome', () => {
  for (const pair of reasoning.bidirectionalPairs) assert.ok(Math.abs(pair.affirmative.probability + pair.counter.probability - 1) < 1e-10);
});

test('negative outcomes are first-class conclusions', () => {
  assert.ok(reasoning.strongestTruths.some((x) => /NOT WIN|FAIL TO SCORE|CONCEDE|NOT DRAW|UNDER|NOT LOSE/.test(x.conclusion)));
});

test('team scoring and failure probabilities are complements', () => {
  assert.ok(Math.abs(reasoning.teamReality.home.scoreAtLeastOne + reasoning.teamReality.home.failToScore - 1) < 1e-10);
  assert.ok(Math.abs(reasoning.teamReality.away.scoreAtLeastOne + reasoning.teamReality.away.failToScore - 1) < 1e-10);
});

test('BTTS yes/no are complements', () => {
  assert.ok(Math.abs(reasoning.matchReality.bttsYes + reasoning.matchReality.bttsNo - 1) < 1e-10);
});

test('totals over/under are complements', () => {
  for (const row of Object.values(reasoning.matchReality.totals)) assert.ok(Math.abs(row.over + row.under - 1) < 1e-10);
});

test('double chance maps from match reality, after team analysis', () => {
  const x2 = mapReasoningToMarketSelection(reasoning, { marketFamily:'DOUBLE_CHANCE_FULL_TIME', selection:'X2' });
  assert.equal(x2.status, 'MODELLED');
  assert.ok(Math.abs(x2.modelProbability - reasoning.matchReality.awayNotLose) < 1e-10);
});

test('full-time BTTS and clean sheet are modelled', () => {
  assert.equal(mapReasoningToMarketSelection(reasoning, { marketFamily:'BTTS_FULL_TIME', selection:'NO' }).status, 'MODELLED');
  assert.equal(mapReasoningToMarketSelection(reasoning, { marketFamily:'CLEAN_SHEET_HOME', selection:'YES' }).status, 'MODELLED');
});

test('half-with-more-goals is blocked until half-specific model exists', () => {
  const half = mapReasoningToMarketSelection(reasoning, { marketFamily:'HALF_WITH_MORE_GOALS', selection:'SECOND_HALF' });
  assert.equal(half.status, 'UNSUPPORTED_UNTIL_MODEL_EXISTS');
  assert.equal(BETPAWA_MARKET_CAPABILITIES.HALF_WITH_MORE_GOALS, 'REQUIRES_HALF_SPECIFIC_MODEL');
});

test('probability ranking is separate from value ranking', () => {
  const board = rankAvailableMarketSelections(reasoning, [
    { marketFamily:'TOTAL_GOALS_OVER_UNDER_FULL_TIME', selection:'OVER', line:1.5 },
    { marketFamily:'1X2_FULL_TIME', selection:'HOME' }
  ]);
  assert.equal(board.governance.probabilityRankingIsNotValueRanking, true);
});

test('priced selection needs fair market probability to compute edge', () => {
  const priced = evaluatePricedMarketSelections(reasoning, [{ marketFamily:'1X2_FULL_TIME', selection:'HOME', odds:1.8 }]);
  assert.equal(priced.rows[0].decisionState, 'PRICE_ONLY_NO_FAIR_MARKET');
  assert.equal(priced.rows[0].edge, null);
});

test('positive probability is not enough; value candidate requires edge and EV', () => {
  const priced = evaluatePricedMarketSelections(reasoning, [{ marketFamily:'1X2_FULL_TIME', selection:'HOME', odds:2.0, marketFairProbability:0.45 }], { minEdge:0.05 });
  assert.equal(priced.rows[0].decisionState, 'VALUE_CANDIDATE');
  assert.ok(priced.rows[0].edge >= 0.05);
  assert.ok(priced.rows[0].ev > 0);
});

test('decision universe starts from teams before market', () => {
  const universe = buildMatchDecisionUniverse({
    eventId:'E1', homeTeam:'HOME FC', awayTeam:'AWAY FC', homeLambda:2.0, awayLambda:0.8,
    evidenceMaturity:80, lineupGate:'PASS', contextRisk:'LOW',
    availableMarketSelections:[{ marketFamily:'BTTS_FULL_TIME', selection:'NO' }]
  });
  assert.equal(universe.analysisOrder[0], 'INDEPENDENT_TEAM_MODEL');
  assert.equal(universe.governance.analysisBeginsWithTeamsNotBookmakerMarkets, true);
  assert.equal(universe.governance.negativeConclusionsAllowed, true);
});

test('high context risk prevents robust truth even when probability is high', () => {
  const universe = buildMatchDecisionUniverse({
    eventId:'E2', homeTeam:'A', awayTeam:'B', homeLambda:3.0, awayLambda:0.4,
    evidenceMaturity:90, lineupGate:'PASS', contextRisk:'HIGH'
  });
  assert.equal(universe.strongestRobustTruths.length, 0);
  assert.ok(universe.truthBoard.some((x) => x.probability >= 0.7 && x.state === 'MODEL_LEAN'));
});
