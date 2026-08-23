import test from 'node:test';
import assert from 'node:assert/strict';
import { processRealHalfProfileReport } from '../src/real-half-profile-processing.mjs';

const modelMarketReport = {
  generatedFromMarketBatch: 'M1',
  generatedFromModelDataset: 'D1',
  modelBoard: [{
    eventId: 'E1', match: 'A vs B', homeLambda: 1.8, awayLambda: 1.1,
    evidenceMaturity: 65, lineupGate: 'PENDING', contextRisk: 'HIGH'
  }]
};

const halfDataset = {
  datasetId: 'H1', sourceSeason: '2025_26', minimumSample: 30,
  events: [{
    eventId: 'E1', homeTeam: 'A', awayTeam: 'B',
    halfProfile: {
      profileId: 'HP1', sourceSeason: '2025_26', sampleSize: 38,
      homeFirstHalfGoalShare: 0.5, awayFirstHalfGoalShare: 0.4,
      sources: ['INDEPENDENT_SOURCE'],
      sourceVerification: { primaryHalfStats: true, independenceFromMarket: true, preMatchOnly: true }
    }
  }]
};

test('real half profile joins by event and reaches HALF_MODEL_READY', () => {
  const report = processRealHalfProfileReport(modelMarketReport, halfDataset);
  assert.equal(report.summary.eventsReceived, 1);
  assert.equal(report.summary.halfModelReady, 1);
  assert.equal(report.events[0].state, 'HALF_MODEL_READY_MARKET_PRICE_PENDING');
});

test('real half report does not qualify a bet without half-market prices', () => {
  const report = processRealHalfProfileReport(modelMarketReport, halfDataset);
  assert.equal(report.summary.pricedHalfMarketsEvaluated, 0);
  assert.equal(report.summary.qualifiedHalfMarketSignals, 0);
  assert.equal(report.events[0].finalQualificationState, 'NOT_EVALUATED_WITHOUT_FRESH_HALF_MARKET_PRICES_AND_FINAL_GATES');
});

test('missing real half profile waits rather than fabricating', () => {
  const report = processRealHalfProfileReport(modelMarketReport, { ...halfDataset, events: [] });
  assert.equal(report.events[0].state, 'WAIT');
  assert.equal(report.events[0].reason, 'REAL_HALF_PROFILE_NOT_FOUND');
});

test('half market probability board contains modelled half families', () => {
  const report = processRealHalfProfileReport(modelMarketReport, halfDataset);
  const families = new Set(report.events[0].strongestHalfMarketProbabilities.map((x) => x.marketFamily));
  assert.ok(families.size > 0);
  assert.equal(report.governance.noBetQualificationFromProbabilityAlone, true);
});
