import test from 'node:test';
import assert from 'node:assert/strict';
import { assessMatchupMarketConflict } from '../src/matchup-market-conflict-intelligence.mjs';

const base = {
  eventId: 'GLOBAL-2026-E1', marketKey: '1X2_90M', selection: 'HOME',
  asOf: '2026-08-25T10:00:00Z', kickoffAt: '2026-08-25T20:00:00Z',
  model: { probability: 0.62, verified: true, independentOfMarket: true, version: 'MODEL_V1', observedAt: '2026-08-25T09:00:00Z' },
  market: { fairProbability: 0.58, verified: true, directProviderObservation: true, sameProviderPair: true, provider: 'BOOK_A', observedAt: '2026-08-25T09:30:00Z' },
  teamIntelligence: { state: 'ANALYSIS_MATURE', reliability: 0.72, favoredSide: 'HOME' },
  statisticsQuality: { sampleSize: 38, verified: true, opponentAdjusted: true, venueSplitVerified: true, currentSquadRelevant: true, nonPenaltyAndGameStateControlled: true, scheduleStrengthVerified: true },
  contextChecks: [{ id: 'LINEUP', state: 'CONFIRMED', source: 'OFFICIAL' }]
};

test('allows aligned evidence to continue only to existing canonical gates', () => {
  const result = assessMatchupMarketConflict(base);
  assert.equal(result.state, 'ALIGNED_OR_WITHIN_TOLERANCE');
  assert.equal(result.decision, 'PROCEED_TO_EXISTING_CANONICAL_GATES');
  assert.equal(result.decisionWeight, 0);
  assert.equal(result.capitalEffect, 'NONE');
});

test('severe verified model-market conflict abstains without alleging a trap', () => {
  const result = assessMatchupMarketConflict({ ...base, market: { ...base.market, fairProbability: 0.44 } });
  assert.equal(result.state, 'MARKET_MODEL_CONFLICT');
  assert.equal(result.decision, 'ABSTAIN');
  assert.equal(result.disagreement.absoluteGap, 0.18);
  assert.equal(result.governance.trapOrFixingClaimMade, false);
});

test('opponent-specific matchup contradiction overrides attractive season statistics', () => {
  const result = assessMatchupMarketConflict({ ...base, teamIntelligence: { ...base.teamIntelligence, favoredSide: 'AWAY' } });
  assert.equal(result.state, 'MATCHUP_RISK');
  assert.equal(result.decision, 'ABSTAIN');
  assert.ok(result.reasons.includes('OPPONENT_SPECIFIC_MATCHUP_CONTRADICTS_SELECTION'));
});

test('weak unadjusted statistics force abstention', () => {
  const result = assessMatchupMarketConflict({ ...base, statisticsQuality: { ...base.statisticsQuality, sampleSize: 6, opponentAdjusted: false, scheduleStrengthVerified: false } });
  assert.equal(result.state, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.decision, 'ABSTAIN');
  assert.ok(result.statisticsAudit.weaknesses.includes('opponentAdjusted'));
});

test('search-index or mixed-provider market evidence is not accepted', () => {
  const result = assessMatchupMarketConflict({ ...base, market: { ...base.market, directProviderObservation: false, sameProviderPair: false } });
  assert.equal(result.marketAudit.ready, false);
  assert.equal(result.marketAudit.fairProbability, null);
  assert.equal(result.decision, 'ABSTAIN');
});

test('missing lineup context fails closed', () => {
  const result = assessMatchupMarketConflict({ ...base, contextChecks: [{ id: 'LINEUP', state: 'MISSING' }] });
  assert.equal(result.state, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.decision, 'ABSTAIN');
});

test('moderate conflict is watch and reverify, never automatic qualification', () => {
  const result = assessMatchupMarketConflict({ ...base, market: { ...base.market, fairProbability: 0.51 } });
  assert.equal(result.state, 'MARKET_MODEL_CONFLICT');
  assert.equal(result.decision, 'WATCH_REVERIFY');
});

test('post-kickoff audit is rejected to preserve no-hindsight', () => {
  assert.throws(() => assessMatchupMarketConflict({ ...base, asOf: base.kickoffAt }), /CONFLICT_AUDIT_MUST_BE_PREMATCH/);
});

test('market-derived model is rejected', () => {
  assert.throws(() => assessMatchupMarketConflict({ ...base, model: { ...base.model, independentOfMarket: false } }), /VERIFIED_INDEPENDENT_MODEL_REQUIRED/);
});

test('future or post-kickoff evidence cannot enter the pre-match audit', () => {
  assert.throws(() => assessMatchupMarketConflict({ ...base, market: { ...base.market, observedAt: '2026-08-25T21:00:00Z' } }), /MARKET_OBSERVATION_NOT_PREMATCH_AS_OF/);
  assert.throws(() => assessMatchupMarketConflict({ ...base, model: { ...base.model, observedAt: '2026-08-25T21:00:00Z' } }), /MODEL_OBSERVATION_NOT_PREMATCH_AS_OF/);
});
