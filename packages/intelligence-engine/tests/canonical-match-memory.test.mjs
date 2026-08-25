import assert from 'node:assert/strict';
import {
  MATCH_MEMORY_VERSION,
  STEP_2_TIMELINE_STATE,
  buildCanonicalMatchMemory,
  classifyFinalOutcome,
  verifyCanonicalMatchMemory
} from '../src/canonical-match-memory.mjs';

function gate1Truth({
  id = 'MLS-2026-TEST-001',
  homeGoals = 2,
  awayGoals = 1,
  status = 'ACCEPTED',
  verified = true,
  market = true
} = {}) {
  return {
    match_id: id,
    status,
    canonical_match_date: '2026-08-01',
    canonical_date_policy: 'VENUE_LOCAL_MATCH_DATE',
    season: 2026,
    league: 'MLS',
    home_team: 'alpha fc',
    away_team: 'beta fc',
    final_score: { home: homeGoals, away: awayGoals },
    result: {
      verified,
      verification_method: verified ? 'CROSS_SOURCE_EXACT_SCORE' : 'UNVERIFIED',
      source: verified ? 'SOURCE_A' : null,
      source_url: verified ? 'https://example.com/a' : null,
      source_match_date: '2026-08-01',
      crosscheck: verified ? {
        source: 'SOURCE_B',
        source_url: 'https://example.com/b',
        source_match_date: '2026-08-01'
      } : null
    },
    market: market ? {
      status: 'ACCEPTED',
      provider: 'TEST_BOOK',
      source: 'TEST_SOURCE',
      source_url: 'https://example.com/market',
      quote_type: 'CLOSING',
      observed_at: '2026-08-01T16:00:00Z',
      o25: 1.80,
      u25: 2.05,
      o35: 2.55,
      u35: 1.55
    } : { status: 'MISSING' },
    gate2_backfill_eligible: verified,
    gate1_validation_n_eligible: verified && market,
    reasons: verified ? [] : ['RESULT_NOT_VERIFIED'],
    supporting_result_sources: verified ? ['SOURCE_A', 'SOURCE_B'] : [],
    supporting_market_sources: market ? ['TEST_SOURCE'] : [],
    duplicate_observations: 0
  };
}

function observation({ id = 'OBS-1', eventId = 'MLS-2026-TEST-001', availableAt = '2026-08-01T15:30:00Z', verified = true } = {}) {
  return {
    observation_id: id,
    event_id: eventId,
    entity_type: 'TEAM',
    entity_id: 'alpha fc',
    observation_type: 'LINEUP_CONFIDENCE',
    value: 0.92,
    observed_at: '2026-08-01T15:20:00Z',
    available_at: availableAt,
    source: 'OFFICIAL_TEAM_SOURCE',
    source_type: 'OFFICIAL',
    is_verified: verified,
    provenance_id: `PROV-${id}`
  };
}

function settlement({ result = 'CORRECT', predictionCorrect = true, eventId = 'MLS-2026-TEST-001', signal = 'SIG-1' } = {}) {
  return {
    eventId,
    sourceSnapshotType: 'PRE_MATCH',
    sourceSignalId: signal,
    finalScore: { home: 2, away: 1 },
    actualOutcome: 'HOME_WIN',
    predictedOutcome: predictionCorrect ? 'HOME_WIN' : 'DRAW',
    predictionCorrect,
    result,
    actualOutcomeProbability: 0.52,
    brierScore: 0.41,
    logLoss: 0.65,
    settledAt: '2026-08-01T19:00:00Z',
    noHindsight: true,
    realMoney: 'NO'
  };
}

function build(record, overrides = {}) {
  const predictionCutoff = Object.prototype.hasOwnProperty.call(overrides, 'predictionCutoff')
    ? overrides.predictionCutoff
    : '2026-08-01T16:30:00Z';
  return buildCanonicalMatchMemory({
    truthRecord: record,
    observations: overrides.observations ?? [],
    marketSnapshots: overrides.marketSnapshots ?? [],
    predictionSettlements: overrides.predictionSettlements ?? [],
    predictionCutoff,
    materializedAt: overrides.materializedAt ?? '2026-08-02T00:00:00Z'
  });
}

function testWinDrawLossUseSameSchema() {
  const cases = [
    [2, 1, 'HOME_WIN'],
    [1, 1, 'DRAW'],
    [0, 2, 'AWAY_WIN']
  ];
  const keySets = [];
  for (const [home, away, expected] of cases) {
    const memory = build(gate1Truth({ id: `MATCH-${home}-${away}`, homeGoals: home, awayGoals: away, market: false }), {
      predictionCutoff: null
    });
    assert.equal(memory.memory_version, MATCH_MEMORY_VERSION);
    assert.equal(memory.truth.actual_outcome, expected);
    assert.equal(memory.truth.verified, true);
    assert.equal(memory.learning.pattern_truth_eligible, true);
    assert.equal(verifyCanonicalMatchMemory(memory), true);
    keySets.push(Object.keys(memory.truth).sort());
  }
  assert.deepEqual(keySets[0], keySets[1]);
  assert.deepEqual(keySets[1], keySets[2]);
}

function testCorrectAndIncorrectPredictionsAreBothRetained() {
  const memory = build(gate1Truth(), {
    predictionSettlements: [
      settlement({ result: 'CORRECT', predictionCorrect: true, signal: 'SIG-CORRECT' }),
      settlement({ result: 'INCORRECT', predictionCorrect: false, signal: 'SIG-INCORRECT' })
    ]
  });
  assert.equal(memory.evidence.prediction_settlements.length, 2);
  assert.equal(memory.learning.correct_prediction_n, 1);
  assert.equal(memory.learning.incorrect_prediction_n, 1);
  assert.equal(memory.evidence.prediction_settlements.some(x => x.result === 'INCORRECT'), true);
  assert.equal(memory.learning.prediction_error_is_learning_evidence, true);
}

function testUnverifiedTruthIsRetainedButNotPatternEligible() {
  const memory = build(gate1Truth({ status: 'QUARANTINED', verified: false, market: false }), { predictionCutoff: null });
  assert.equal(memory.truth.verified, false);
  assert.equal(memory.truth.status, 'QUARANTINED');
  assert.equal(memory.learning.retain_for_learning, true);
  assert.equal(memory.learning.pattern_truth_eligible, false);
  assert.equal(memory.learning.truth_decision_weight, 0);
}

function testAvailableAfterCutoffRetainedButCannotInfluencePrematch() {
  const memory = build(gate1Truth(), {
    observations: [
      observation({ id: 'BEFORE', availableAt: '2026-08-01T16:00:00Z' }),
      observation({ id: 'AFTER', availableAt: '2026-08-01T17:00:00Z' })
    ],
    predictionCutoff: '2026-08-01T16:30:00Z'
  });
  const byId = Object.fromEntries(memory.evidence.observations.map(x => [x.observation_id, x]));
  assert.equal(byId.BEFORE.pre_match_eligible, true);
  assert.equal(byId.AFTER.pre_match_eligible, false);
  assert.equal(byId.AFTER.pre_match_eligibility_reason, 'AVAILABLE_AFTER_CUTOFF');
  assert.equal(memory.evidence.observations.length, 2);
}

function testMissingCutoffDoesNotGuessEligibility() {
  const memory = build(gate1Truth(), {
    observations: [observation()],
    predictionCutoff: null
  });
  assert.equal(memory.evidence.observations[0].pre_match_eligible, false);
  assert.equal(memory.evidence.observations[0].pre_match_eligibility_reason, 'PREDICTION_CUTOFF_NOT_SUPPLIED');
  assert.equal(memory.evidence.market_snapshots[0].pre_match_eligible, false);
}

function testTruthRecordIsNotMutatedAndMemoryIsImmutable() {
  const record = gate1Truth();
  const before = JSON.stringify(record);
  const memory = build(record, { observations: [observation()] });
  assert.equal(JSON.stringify(record), before);
  assert.equal(memory.governance.source_truth_record_mutated, false);
  assert.equal(Object.isFrozen(memory), true);
  assert.equal(Object.isFrozen(memory.truth), true);
  assert.throws(() => { memory.truth.final_score.home = 99; }, TypeError);
}

function testFingerprintDetectsTampering() {
  const memory = build(gate1Truth(), { observations: [observation()] });
  assert.equal(verifyCanonicalMatchMemory(memory), true);
  const tampered = structuredClone(memory);
  tampered.truth.final_score.home = 7;
  assert.throws(() => verifyCanonicalMatchMemory(tampered), /TRUTH_FINGERPRINT_INVALID/);
}

function testStep2BoundaryIsExplicit() {
  const memory = build(gate1Truth());
  assert.equal(memory.timeline.state, STEP_2_TIMELINE_STATE);
  assert.equal(memory.timeline.minute_by_minute_events_materialized, false);
  assert.equal(memory.learning.pattern_discovery_performed_here, false);
  assert.equal(memory.learning.pattern_validation_performed_here, false);
}

function testDuplicateObservationFailsClosed() {
  assert.throws(() => build(gate1Truth(), {
    observations: [observation({ id: 'DUP' }), observation({ id: 'DUP' })]
  }), /DUPLICATE_OBSERVATION_ID/);
}

function testCrossEventEvidenceFailsClosed() {
  assert.throws(() => build(gate1Truth(), {
    observations: [observation({ eventId: 'OTHER-MATCH' })]
  }), /OBSERVATION_EVENT_ID_MISMATCH/);
  assert.throws(() => build(gate1Truth(), {
    predictionSettlements: [settlement({ eventId: 'OTHER-MATCH' })]
  }), /SETTLEMENT_EVENT_ID_MISMATCH/);
}

function testOutcomeClassifier() {
  assert.equal(classifyFinalOutcome(3, 1), 'HOME_WIN');
  assert.equal(classifyFinalOutcome(2, 2), 'DRAW');
  assert.equal(classifyFinalOutcome(0, 1), 'AWAY_WIN');
  assert.throws(() => classifyFinalOutcome(-1, 0), /HOME_SCORE_INVALID/);
}

function main() {
  testWinDrawLossUseSameSchema();
  testCorrectAndIncorrectPredictionsAreBothRetained();
  testUnverifiedTruthIsRetainedButNotPatternEligible();
  testAvailableAfterCutoffRetainedButCannotInfluencePrematch();
  testMissingCutoffDoesNotGuessEligibility();
  testTruthRecordIsNotMutatedAndMemoryIsImmutable();
  testFingerprintDetectsTampering();
  testStep2BoundaryIsExplicit();
  testDuplicateObservationFailsClosed();
  testCrossEventEvidenceFailsClosed();
  testOutcomeClassifier();
  console.log('CANONICAL_MATCH_MEMORY_V0_1=PASS');
}

main();
