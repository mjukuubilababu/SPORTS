import assert from 'node:assert/strict';
import {
  GAME_STATE_TIMELINE_VERSION,
  buildGameStateTimeline,
  verifyGameStateTimeline
} from '../src/game-state-timeline.mjs';

const SHA_A = 'a'.repeat(64);

function link() {
  return {
    provider: 'API_FOOTBALL',
    providerFixtureId: 1001,
    providerHomeTeamId: 10,
    providerAwayTeamId: 20,
    eventId: 'MATCH-1',
    kickoffUtc: '2026-08-24T19:00:00Z',
    observedAt: '2026-08-24T18:00:00Z',
    verified: true
  };
}

function event({
  id,
  index,
  minute,
  extra = null,
  side,
  type,
  detail,
  goalEffect = 'NOT_APPLICABLE',
  cardEffect = 'NOT_APPLICABLE',
  eligible = true,
  teamId,
  reasons = []
}) {
  return {
    observation_version: 'API_FOOTBALL_GAME_EVENT_OBSERVATION_V0_1',
    event_observation_id: id,
    fixture_id: 'EPL-API_FOOTBALL-1001',
    provider_fixture_id: 1001,
    competition_id: 'EPL',
    provider_event_index: index,
    elapsed_minute: minute,
    extra_minute: extra,
    provider_team_id: teamId ?? (side === 'HOME' ? 10 : side === 'AWAY' ? 20 : null),
    provider_team_name: side === 'HOME' ? 'Alpha FC' : side === 'AWAY' ? 'Beta FC' : null,
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
    observed_at: '2026-08-24T20:20:00Z',
    provider: 'API_FOOTBALL',
    source_url: 'https://v3.football.api-sports.io/fixtures?live=39',
    source_fixture_sha256: SHA_A,
    source_event_sha256: String(index + 1).padStart(64, '0'),
    provider_observation_verified: true,
    timeline_eligible: eligible,
    reasons,
    bookmaker_data_used: false,
    provider_prediction_used: false
  };
}

function observations() {
  return [
    event({ id: 'E1', index: 0, minute: 10, side: 'AWAY', type: 'GOAL', detail: 'NORMAL_GOAL', goalEffect: 'SCORE' }),
    event({ id: 'E2', index: 1, minute: 20, side: 'HOME', type: 'GOAL', detail: 'NORMAL_GOAL', goalEffect: 'SCORE' }),
    event({ id: 'E3', index: 2, minute: 30, side: 'AWAY', type: 'CARD', detail: 'RED_CARD', cardEffect: 'DISMISSAL' }),
    event({ id: 'E4', index: 3, minute: 46, side: 'HOME', type: 'SUBSTITUTION', detail: 'SUBSTITUTION_1' }),
    event({ id: 'E5', index: 4, minute: 55, side: 'AWAY', type: 'GOAL', detail: 'MISSED_PENALTY', goalEffect: 'NO_SCORE' }),
    event({ id: 'E6', index: 5, minute: 70, side: 'HOME', type: 'GOAL', detail: 'NORMAL_GOAL', goalEffect: 'SCORE' }),
    event({ id: 'E7', index: 6, minute: 71, extra: 1, side: 'HOME', type: 'VAR', detail: 'GOAL_DISALLOWED' }),
    event({ id: 'E8', index: 7, minute: 72, side: 'HOME', type: 'OTHER', detail: 'HYDRATION', eligible: false, reasons: ['EVENT_TYPE_UNMAPPED'] })
  ];
}

function scoreSnapshot(home = 2, away = 1) {
  return {
    provider_fixture_id: 1001,
    home_team_id: 10,
    away_team_id: 20,
    home_goals: home,
    away_goals: away,
    observed_at: '2026-08-24T20:20:00Z',
    state: 'LIVE_IN_PLAY'
  };
}

function build(overrides = {}) {
  return buildGameStateTimeline({
    eventObservations: overrides.eventObservations ?? observations(),
    identityLink: overrides.identityLink ?? link(),
    scoreSnapshot: overrides.scoreSnapshot === undefined ? scoreSnapshot() : overrides.scoreSnapshot,
    matchMemory: overrides.matchMemory ?? null,
    materializedAt: overrides.materializedAt ?? '2026-08-24T20:20:01Z'
  });
}

function testObservableStateTransitions() {
  const timeline = build();
  assert.equal(timeline.timeline_version, GAME_STATE_TIMELINE_VERSION);
  assert.equal(timeline.events[0].score_transition, 'OPENING_GOAL');
  assert.equal(timeline.events[0].score_state_after, 'AWAY_LEADING');
  assert.equal(timeline.events[1].score_transition, 'EQUALIZER');
  assert.deepEqual(timeline.events[1].score_after, { home: 1, away: 1 });
  assert.equal(timeline.events[2].observed_dismissals_after.away, 1);
  assert.equal(timeline.events[3].substitutions_after.home, 1);
  assert.equal(timeline.events[4].score_transition, 'MISSED_PENALTY');
  assert.deepEqual(timeline.events[4].score_after, { home: 1, away: 1 });
  assert.equal(timeline.events[5].score_transition, 'COMEBACK_GO_AHEAD');
  assert.equal(timeline.events[5].observable_pressure_state.away_trailing, true);
  assert.deepEqual(timeline.summary.derived_score, { home: 2, away: 1 });
  assert.equal(timeline.summary.score_consistency, 'VERIFIED');
  assert.equal(timeline.summary.comeback_go_ahead_n, 1);
  assert.equal(timeline.summary.missed_penalty_n, 1);
  assert.equal(timeline.summary.observed_dismissal_n, 1);
  assert.equal(timeline.learning.pattern_truth_eligible, true);
  assert.equal(verifyGameStateTimeline(timeline), true);
}

function testUnknownEventIsRetainedWithoutPretendingUnderstanding() {
  const timeline = build();
  const unknown = timeline.events.find(x => x.event_observation_id === 'E8');
  assert.ok(unknown);
  assert.equal(unknown.event_type, 'OTHER');
  assert.equal(unknown.sequence_eligible, false);
  assert.equal(unknown.pattern_eligible, false);
  assert.equal(timeline.summary.retained_event_n, 8);
  assert.equal(timeline.summary.timeline_ineligible_event_n, 1);
  assert.equal(timeline.summary.other_event_n, 1);
}

function testScoreMismatchFailsPatternTruthButRetainsTimeline() {
  const timeline = build({ scoreSnapshot: scoreSnapshot(3, 1) });
  assert.equal(timeline.summary.score_consistency, 'MISMATCH');
  assert.equal(timeline.learning.pattern_truth_eligible, false);
  assert.equal(timeline.events.length, 8);
}

function testAmbiguousGoalCannotReceivePatternTruthWeight() {
  const rows = observations();
  rows.push(event({
    id: 'E9', index: 8, minute: 73, side: 'HOME', type: 'GOAL', detail: 'UNKNOWN_GOAL_KIND', goalEffect: 'UNKNOWN', eligible: false,
    reasons: ['GOAL_EFFECT_UNKNOWN']
  }));
  const timeline = build({ eventObservations: rows });
  assert.equal(timeline.summary.ambiguous_score_event_n, 1);
  assert.equal(timeline.learning.pattern_truth_eligible, false);
  assert.deepEqual(timeline.summary.derived_score, { home: 2, away: 1 });
}

function testProviderOrderBreaksSameMinuteTieDeterministically() {
  const rows = [
    event({ id: 'LATER', index: 2, minute: 40, side: 'HOME', type: 'CARD', detail: 'YELLOW_CARD', cardEffect: 'CAUTION' }),
    event({ id: 'EARLIER', index: 1, minute: 40, side: 'AWAY', type: 'CARD', detail: 'YELLOW_CARD', cardEffect: 'CAUTION' })
  ];
  const timeline = build({ eventObservations: rows, scoreSnapshot: scoreSnapshot(0, 0) });
  assert.equal(timeline.events[0].event_observation_id, 'EARLIER');
  assert.equal(timeline.events[1].event_observation_id, 'LATER');
}

function testCrossFixtureAndHindsightObservationsFailClosed() {
  const wrongFixture = observations();
  wrongFixture[0] = { ...wrongFixture[0], provider_fixture_id: 9999 };
  assert.throws(() => build({ eventObservations: wrongFixture }), /GAME_EVENT_PROVIDER_FIXTURE_ID_MISMATCH/);

  const beforeKickoff = observations();
  beforeKickoff[0] = { ...beforeKickoff[0], observed_at: '2026-08-24T18:59:59Z' };
  assert.throws(() => build({ eventObservations: beforeKickoff }), /GAME_EVENT_OBSERVED_BEFORE_KICKOFF/);
}

function testIdentityAndTeamSidesCannotBeFuzzyMatched() {
  const rows = observations();
  rows[0] = { ...rows[0], provider_team_id: 999 };
  assert.throws(() => build({ eventObservations: rows }), /GAME_EVENT_AWAY_TEAM_ID_MISMATCH/);

  const unverified = { ...link(), verified: false };
  assert.throws(() => build({ identityLink: unverified }), /IDENTITY_LINK_VERIFIED_REQUIRED/);
}

function testNoSilentPsychologyOrModelEffect() {
  const timeline = build();
  assert.equal(timeline.governance.psychology_is_raw_truth, false);
  assert.equal(timeline.governance.observable_state_proxies_only, true);
  assert.equal(timeline.governance.event_effects_automatically_change_live_rate_multipliers, false);
  assert.equal(timeline.governance.automatic_retuning, false);
  assert.equal(timeline.governance.automatic_pattern_promotion, false);
  assert.equal(timeline.governance.real_money, 'NO');
}

function testTimelineIsImmutableAndFingerprintDetectsTampering() {
  const timeline = build();
  assert.equal(Object.isFrozen(timeline), true);
  assert.equal(Object.isFrozen(timeline.events), true);
  assert.equal(Object.isFrozen(timeline.events[0]), true);
  const tampered = structuredClone(timeline);
  tampered.events[0].score_after.away = 9;
  assert.throws(() => verifyGameStateTimeline(tampered), /GAME_STATE_TIMELINE_FINGERPRINT_INVALID/);
}

function testDuplicateEventIdFailsClosed() {
  const rows = observations();
  rows[1] = { ...rows[1], event_observation_id: rows[0].event_observation_id };
  assert.throws(() => build({ eventObservations: rows }), /DUPLICATE_GAME_EVENT_ID/);
}

function main() {
  testObservableStateTransitions();
  testUnknownEventIsRetainedWithoutPretendingUnderstanding();
  testScoreMismatchFailsPatternTruthButRetainsTimeline();
  testAmbiguousGoalCannotReceivePatternTruthWeight();
  testProviderOrderBreaksSameMinuteTieDeterministically();
  testCrossFixtureAndHindsightObservationsFailClosed();
  testIdentityAndTeamSidesCannotBeFuzzyMatched();
  testNoSilentPsychologyOrModelEffect();
  testTimelineIsImmutableAndFingerprintDetectsTampering();
  testDuplicateEventIdFailsClosed();
  console.log('GAME_STATE_TIMELINE_V0_1=PASS');
}

main();
