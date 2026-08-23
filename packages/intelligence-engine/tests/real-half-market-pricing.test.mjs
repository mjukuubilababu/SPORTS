import test from 'node:test';
import assert from 'node:assert/strict';
import { devigObservedMarket, processRealHalfMarketPricing } from '../src/real-half-market-pricing.mjs';

const profile = {
  datasetId: 'HALF-PROFILE-TEST', minimumSample: 30,
  events: [{ eventId: 'E1', homeTeam: 'Home', awayTeam: 'Away', halfProfile: {
    profileId: 'P1', sampleSize: 38, sourceSeason: '2025/26', homeFirstHalfGoalShare: 0.55, awayFirstHalfGoalShare: 0.40,
    sources: ['independent'], sourceVerification: { primaryHalfStats: true, independenceFromMarket: true, preMatchOnly: true }
  }}]
};
const modelReport = { modelBoard: [{ eventId: 'E1', match: 'Home vs Away', homeLambda: 2.0, awayLambda: 1.0, evidenceMaturity: 65, lineupGate: 'PENDING', contextRisk: 'HIGH' }] };
const capture = {
  captureId: 'C1', dataNature: 'INDEXED', provider: 'BETPAWA', providerQuorumRequiredForQualification: 2, sourceObservationTimeKnown: false,
  events: [{ eventId: 'E1', freshnessStatus: 'NOT_LIVE_VERIFIED', markets: [
    { marketId: 'M1', marketFamily: '1X2_FIRST_HALF', selections: [{ selection: 'HOME', odds: 2.5 }, { selection: 'DRAW', odds: 3.0 }, { selection: 'AWAY', odds: 4.0 }] },
    { marketId: 'M2', marketFamily: 'BTTS_FIRST_HALF', selections: [{ selection: 'YES', odds: 3.5 }, { selection: 'NO', odds: 1.25 }] }
  ] }]
};

test('devig normalizes observed market to one', () => {
  const m = devigObservedMarket(capture.events[0].markets[0], { provider: 'BETPAWA', freshnessStatus: 'NOT_LIVE_VERIFIED' });
  const sum = m.pricedSelections.reduce((s, x) => s + x.marketFairProbability, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12);
  assert.ok(m.overround > 0);
});

test('duplicate selections are rejected', () => {
  assert.throws(() => devigObservedMarket({ marketId: 'X', marketFamily: 'BTTS_FIRST_HALF', selections: [{ selection: 'YES', odds: 2 }, { selection: 'YES', odds: 2 }] }), /DUPLICATE/);
});

test('indexed single-provider prices never grant qualification', () => {
  const report = processRealHalfMarketPricing(modelReport, profile, capture, { minEdge: -1 });
  assert.equal(report.summary.qualifiedSignals, 0);
  assert.equal(report.summary.eligibleForCanonicalFinalGate, 0);
  assert.equal(report.events[0].providerCount, 1);
  for (const row of report.events[0].valueResearchCandidates) {
    assert.equal(row.qualificationState, 'VALUE_RESEARCH_CANDIDATE_BLOCKED');
    assert.ok(row.blockingReasons.includes('PRICE_FRESHNESS_NOT_LIVE_VERIFIED'));
    assert.ok(row.blockingReasons.includes('PROVIDER_QUORUM_NOT_MET'));
    assert.ok(row.blockingReasons.includes('LINEUP_GATE_NOT_PASS'));
  }
});

test('research layer explicitly cannot grant qualified signals', () => {
  const report = processRealHalfMarketPricing(modelReport, profile, capture, { minEdge: -1 });
  assert.equal(report.governance.researchPricingLayerCannotGrantQualification, true);
  assert.equal(report.governance.noFabricatedPrices, true);
  assert.equal(report.summary.qualifiedSignals, 0);
});
