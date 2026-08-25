import assert from 'node:assert/strict';
import { buildCanonicalMatchMemory } from '../src/canonical-match-memory.mjs';
import { buildGameStateTimeline } from '../src/game-state-timeline.mjs';
import {
  BEHAVIORAL_STATE_FEATURES_VERSION,
  FROZEN_DISCOVERY_MIN_N,
  buildBehavioralStateFeatureCorpus,
  verifyBehavioralStateFeatureCorpus
} from '../src/behavioral-state-features.mjs';

const FIXTURE_SHA = 'a'.repeat(64);

function truthRecord({ id, date, home, away, homeGoals, awayGoals, verified = true }) {
  return {
    match_id: id,
    status: verified ? 'ACCEPTED' : 'QUARANTINED',
    canonical_match_date: date,
    canonical_date_policy: 'VENUE_LOCAL_MATCH_DATE',
    season: 2026,
    league: 'TEST_LEAGUE',
    home_team: home,
    away_team: away,
    final_score: { home: homeGoals, away: awayGoals },
    result: {
      verified,
      verification_method: verified ? 'CROSS_SOURCE_EXACT_SCORE' : 'UNVERIFIED',
      source: verified ? 'SOURCE_A' : null,
      source_url: verified ? 'https://example.com/result' : null,
      source_match_date: date,
      crosscheck: verified ? {
        source: 'SOURCE_B',
        source_url: 'https://example.com/crosscheck',
        source_match_date: date
      } : null
    },
    market: { status: 'MISSING' },
    gate2_backfill_eligible: verified,
    gate1_validation_n_eligible: false,
    reasons: verified ? [] : ['RESULT_NOT_VERIFIED'],
    supporting_result_sources: verified ? ['SOURCE_A', 'SOURCE_B'] : [],
    supporting_market_sources: [],
    duplicate_observations: 0
  };
}

function rawEvent({ fixtureId, providerFixtureId, index, minute, side, homeId, awayId, type, detail, goalEffect = 'NOT_APPLICABLE', cardEffect = 'NOT_APPLICABLE' }) {
  const teamId = side === 'HOME' ? homeId : side === 'AWAY' ? awayId : null;
  return {
    observation_version: 'API_FOOTBALL_GAME_EVENT_OBSERVATION_V0_1',
    event_observation_id: `EVENT-${fixtureId}-${index}`,
    fixture_id: `TEST-API_FOOTBALL-${providerFixtureId}`,
    provider_fixture_id: providerFixtureId,
    competition_id: 'TEST_LEAGUE',
    provider_event_index: index,
    elapsed_minute: minute,
    extra_minute: null,
    provider_team_id: teamId,
    provider_team_name: side === 'HOME' ? 'Provider Home' : 'Provider Away',
    side,
    event_type: type,
    event_detail: detail,
    raw_type: type,
    raw_detail: detail,
    player_id: null,
    player_name: null,
    assist_player_id: null,
    assist_player_name: null,
    comments: null,
    goal_effect: goalEffect,
    card_effect: cardEffect,
    observed_at: `${fixtureId.slice(0, 10)}T22:00:00Z`,
    provider: 'API_FOOTBALL',
    source_url: 'https://v3.football.api-sports.io/fixtures?live=39',
    source_fixture_sha256: FIXTURE_SHA,
    source_event_sha256: (index + 1).toString(16).padStart(64, '0'),
    provider_observation_verified: true,
    timeline_eligible: true,
    reasons: [],
    bookmaker_data_used: false,
    provider_prediction_used: false
  };
}

function makePair({ id, date, providerFixtureId, home, away, homeGoals, awayGoals, events, verified = true }) {
  const homeId = providerFixtureId * 10 + 1;
  const awayId = providerFixtureId * 10 + 2;
  const memory = buildCanonicalMatchMemory({
    truthRecord: truthRecord({ id, date, home, away, homeGoals, awayGoals, verified }),
    materializedAt: `${date}T23:00:00Z`
  });
  const eventObservations = events.map((item, index) => rawEvent({
    fixtureId: date,
    providerFixtureId,
    index,
    minute: item.minute,
    side: item.side,
    homeId,
    awayId,
    type: item.type,
    detail: item.detail,
    goalEffect: item.goalEffect,
    cardEffect: item.cardEffect
  }));
  const timeline = buildGameStateTimeline({
    eventObservations,
    identityLink: {
      provider: 'API_FOOTBALL',
      providerFixtureId,
      providerHomeTeamId: homeId,
      providerAwayTeamId: awayId,
      eventId: id,
      kickoffUtc: `${date}T19:00:00Z`,
      observedAt: `${date}T18:00:00Z`,
      verified: true
    },
    matchMemory: memory,
    materializedAt: `${date}T23:30:00Z`
  });
  return { timeline, matchMemory: memory };
}

const goal = (minute, side) => ({ minute, side, type: 'GOAL', detail: 'NORMAL_GOAL', goalEffect: 'SCORE' });
const red = (minute, side) => ({ minute, side, type: 'CARD', detail: 'RED_CARD', cardEffect: 'DISMISSAL' });
const sub = (minute, side) => ({ minute, side, type: 'SUBSTITUTION', detail: 'SUBSTITUTION_1' });

function alphaPairs() {
  return [
    makePair({
      id: 'MATCH-1', date: '2026-01-01', providerFixtureId: 1001,
      home: 'alpha fc', away: 'beta fc', homeGoals: 2, awayGoals: 1,
      events: [goal(10, 'AWAY'), goal(20, 'HOME'), sub(46, 'HOME'), goal(80, 'HOME')]
    }),
    makePair({
      id: 'MATCH-2', date: '2026-01-08', providerFixtureId: 1002,
      home: 'gamma fc', away: 'alpha fc', homeGoals: 1, awayGoals: 1,
      events: [goal(15, 'AWAY'), goal(70, 'HOME')]
    }),
    makePair({
      id: 'MATCH-3', date: '2026-01-15', providerFixtureId: 1003,
      home: 'alpha fc', away: 'delta fc', homeGoals: 1, awayGoals: 2,
      events: [goal(5, 'HOME'), goal(40, 'AWAY'), red(60, 'HOME'), goal(82, 'AWAY')]
    }),
    makePair({
      id: 'MATCH-4', date: '2026-01-22', providerFixtureId: 1004,
      home: 'epsilon fc', away: 'alpha fc', homeGoals: 0, awayGoals: 1,
      events: [goal(88, 'AWAY')]
    })
  ];
}

function profile(corpus, team) {
  const found = corpus.profiles.find(row => row.subject_team === team);
  assert.ok(found, `profile missing: ${team}`);
  return found;
}

function testBothSidesOfEveryMatchAreRetained() {
  const corpus = buildBehavioralStateFeatureCorpus({ matchPairs: alphaPairs(), materializedAt: '2026-02-01T00:00:00Z' });
  assert.equal(corpus.corpus_version, BEHAVIORAL_STATE_FEATURES_VERSION);
  assert.equal(corpus.input_match_pair_n, 4);
  assert.equal(corpus.accepted_match_n, 4);
  assert.equal(corpus.team_observation_n, 8);
  assert.equal(corpus.governance.each_eligible_match_creates_both_team_sides, true);
  assert.equal(corpus.team_profile_n, 5);
  assert.equal(corpus.observations.some(row => row.subject_team === 'alpha fc' && row.final_result === 'LOSS'), true);
  assert.equal(corpus.observations.some(row => row.subject_team === 'delta fc' && row.final_result === 'WIN'), true);
  assert.equal(verifyBehavioralStateFeatureCorpus(corpus), true);
}

function testLeadTrailingAndOutcomeDenominators() {
  const corpus = buildBehavioralStateFeatureCorpus({ matchPairs: alphaPairs(), materializedAt: '2026-02-01T00:00:00Z' });
  const alpha = profile(corpus, 'alpha fc');
  assert.equal(alpha.match_n, 4);
  assert.equal(alpha.metrics.outcomes.win.success_n, 2);
  assert.equal(alpha.metrics.outcomes.win.rate, 0.5);
  assert.equal(alpha.metrics.outcomes.draw.success_n, 1);
  assert.equal(alpha.metrics.outcomes.loss.success_n, 1);

  assert.equal(alpha.metrics.lead_behavior.led_match.success_n, 4);
  assert.equal(alpha.metrics.lead_behavior.led_match.opportunity_n, 4);
  assert.equal(alpha.metrics.lead_behavior.uninterrupted_lead_win.success_n, 2);
  assert.equal(alpha.metrics.lead_behavior.uninterrupted_lead_win.opportunity_n, 4);
  assert.equal(alpha.metrics.lead_behavior.uninterrupted_lead_win.rate, 0.5);
  assert.equal(alpha.metrics.lead_behavior.lead_surrender.success_n, 2);
  assert.equal(alpha.metrics.lead_behavior.points_dropped_after_leading.success_n, 2);
  assert.equal(alpha.metrics.lead_behavior.lead_surrender_recovery_win.opportunity_n, 2);
  assert.equal(alpha.metrics.lead_behavior.lead_surrender_recovery_win.rate, 0);

  assert.equal(alpha.metrics.trailing_response.trailed_match.success_n, 2);
  assert.equal(alpha.metrics.trailing_response.equalize_after_trailing.success_n, 1);
  assert.equal(alpha.metrics.trailing_response.equalize_after_trailing.opportunity_n, 2);
  assert.equal(alpha.metrics.trailing_response.equalize_after_trailing.rate, 0.5);
  assert.equal(alpha.metrics.trailing_response.nonloss_after_trailing.rate, 0.5);
  assert.equal(alpha.metrics.trailing_response.win_after_trailing.rate, 0.5);
  assert.equal(alpha.metrics.trailing_response.comeback_go_ahead.rate, 0.5);

  const interval = alpha.metrics.trailing_response.win_after_trailing.wilson95;
  assert.ok(interval.low <= 0.5 && interval.high >= 0.5);
  assert.equal(alpha.discovery_sample_ready, false);
  assert.equal(alpha.sample_state, 'DESCRIPTIVE_ONLY_INSUFFICIENT_FOR_PATTERN_DISCOVERY');
}

function testTemporalDismissalAndVenueContext() {
  const corpus = buildBehavioralStateFeatureCorpus({ matchPairs: alphaPairs(), materializedAt: '2026-02-01T00:00:00Z' });
  const alpha = profile(corpus, 'alpha fc');
  assert.equal(alpha.metrics.opening_goal.scored_share_when_observed.rate, 0.75);
  assert.equal(alpha.metrics.temporal_behavior.late_goal_scored_match.rate, 0.5);
  assert.equal(alpha.metrics.temporal_behavior.late_goal_conceded_match.rate, 0.25);
  assert.equal(alpha.metrics.temporal_behavior.goals_scored_by_period_count['76_90_PLUS'], 2);
  assert.equal(alpha.metrics.temporal_behavior.goals_conceded_by_period_count['76_90_PLUS'], 1);
  assert.equal(alpha.metrics.dismissal_context.own_dismissal_match.rate, 0.25);
  assert.equal(alpha.metrics.dismissal_context.goals_conceded_after_own_first_dismissal.opportunity_n, 1);
  assert.equal(alpha.metrics.dismissal_context.goals_conceded_after_own_first_dismissal.per_opportunity, 1);
  assert.equal(alpha.metrics.substitution_context.first_substitution_minute_mean, 46);
  assert.equal(alpha.metrics.venue_splits.HOME.match_n, 2);
  assert.equal(alpha.metrics.venue_splits.AWAY.match_n, 2);
  assert.equal(alpha.opponent_context.length, 4);
  assert.equal(alpha.opponent_context.some(row => row.opponent_team === 'delta fc' && row.venue_side === 'HOME'), true);

  const epsilon = profile(corpus, 'epsilon fc');
  assert.equal(epsilon.metrics.dismissal_context.goals_scored_after_own_first_dismissal.opportunity_n, 0);
  assert.equal(epsilon.metrics.dismissal_context.goals_scored_after_own_first_dismissal.per_opportunity, null);
}

function testExistingIntelligenceBridgeHasZeroWeight() {
  const corpus = buildBehavioralStateFeatureCorpus({ matchPairs: alphaPairs(), materializedAt: '2026-02-01T00:00:00Z' });
  const alpha = profile(corpus, 'alpha fc');
  assert.equal(alpha.existing_intelligence_bridge.target_existing_domain, 'TEMPORAL_SCORING_DEFENDING');
  assert.equal(alpha.existing_intelligence_bridge.automatic_injection, false);
  assert.equal(alpha.existing_intelligence_bridge.automatic_impact_assignment, false);
  assert.equal(alpha.existing_intelligence_bridge.decision_weight, 0);
  assert.equal(alpha.governance.predictive_weight_assigned, false);
  assert.equal(alpha.governance.market_data_used, false);
}

function testIneligibleTruthIsRetainedWithoutFeatureInfluence() {
  const pair = makePair({
    id: 'MATCH-UNVERIFIED', date: '2026-02-02', providerFixtureId: 1100,
    home: 'uncertain fc', away: 'other fc', homeGoals: 1, awayGoals: 0,
    events: [goal(50, 'HOME')], verified: false
  });
  const corpus = buildBehavioralStateFeatureCorpus({ matchPairs: [pair], materializedAt: '2026-02-03T00:00:00Z' });
  assert.equal(corpus.accepted_match_n, 0);
  assert.equal(corpus.team_observation_n, 0);
  assert.equal(corpus.retained_ineligible_match_n, 1);
  assert.equal(corpus.retained_ineligible_inputs[0].retained, true);
  assert.equal(corpus.retained_ineligible_inputs[0].feature_influence, 0);
  assert.ok(corpus.retained_ineligible_inputs[0].reasons.includes('MATCH_MEMORY_PATTERN_TRUTH_INELIGIBLE'));
}

function testCrossMatchDuplicateAndTamperFailClosed() {
  const pairs = alphaPairs();
  assert.throws(() => buildBehavioralStateFeatureCorpus({
    matchPairs: [{ timeline: pairs[0].timeline, matchMemory: pairs[1].matchMemory }],
    materializedAt: '2026-02-01T00:00:00Z'
  }), /TIMELINE_MEMORY_MATCH_ID_MISMATCH/);

  assert.throws(() => buildBehavioralStateFeatureCorpus({
    matchPairs: [pairs[0], pairs[0]],
    materializedAt: '2026-02-01T00:00:00Z'
  }), /DUPLICATE_MATCH_PAIR/);

  const corpus = buildBehavioralStateFeatureCorpus({ matchPairs: pairs, materializedAt: '2026-02-01T00:00:00Z' });
  const tampered = structuredClone(corpus);
  tampered.profiles[0].metrics.outcomes.win.rate = 0.999;
  assert.throws(() => verifyBehavioralStateFeatureCorpus(tampered), /BEHAVIORAL_PROFILE_FINGERPRINT_INVALID/);
}

function testFrozenDiscoveryThresholdExactlyThirty() {
  assert.equal(FROZEN_DISCOVERY_MIN_N, 30);
  const pairs = [];
  for (let i = 0; i < 30; i += 1) {
    const day = String(i + 1).padStart(2, '0');
    pairs.push(makePair({
      id: `THRESHOLD-${i + 1}`,
      date: `2026-03-${day}`,
      providerFixtureId: 2000 + i,
      home: 'threshold fc',
      away: `opponent ${i + 1}`,
      homeGoals: 1,
      awayGoals: 0,
      events: [goal(50, 'HOME')]
    }));
  }
  const corpus = buildBehavioralStateFeatureCorpus({ matchPairs: pairs, materializedAt: '2026-04-01T00:00:00Z' });
  const threshold = profile(corpus, 'threshold fc');
  assert.equal(threshold.match_n, 30);
  assert.equal(threshold.discovery_sample_ready, true);
  assert.equal(threshold.sample_state, 'FEATURE_SAMPLE_READY_FOR_GOVERNED_PATTERN_DISCOVERY');
  assert.equal(threshold.existing_intelligence_bridge.decision_weight, 0);
}

function main() {
  testBothSidesOfEveryMatchAreRetained();
  testLeadTrailingAndOutcomeDenominators();
  testTemporalDismissalAndVenueContext();
  testExistingIntelligenceBridgeHasZeroWeight();
  testIneligibleTruthIsRetainedWithoutFeatureInfluence();
  testCrossMatchDuplicateAndTamperFailClosed();
  testFrozenDiscoveryThresholdExactlyThirty();
  console.log('BEHAVIORAL_STATE_FEATURES_V0_1=PASS');
}

main();
