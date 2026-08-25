import { createHash } from 'node:crypto';

export const GAME_STATE_TIMELINE_VERSION = 'GAME_STATE_TIMELINE_V0_1';

function assertObject(name, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name}_OBJECT_REQUIRED`);
}

function assertPositiveInt(name, value) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name}_INVALID`);
}

function assertNonNegativeInt(name, value) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name}_INVALID`);
}

function timestamp(name, value) {
  const parsed = Date.parse(value);
  if (!value || Number.isNaN(parsed)) throw new Error(`${name}_TIMESTAMP_INVALID`);
  return parsed;
}

function sha256(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function validSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function scoreState(score) {
  if (score.home > score.away) return 'HOME_LEADING';
  if (score.away > score.home) return 'AWAY_LEADING';
  return 'DRAW';
}

function sideScore(score, side) {
  return side === 'HOME' ? score.home : score.away;
}

function opponentScore(score, side) {
  return side === 'HOME' ? score.away : score.home;
}

function validateIdentityLink(link) {
  assertObject('IDENTITY_LINK', link);
  if (link.provider !== 'API_FOOTBALL') throw new Error('IDENTITY_LINK_PROVIDER_UNSUPPORTED');
  assertPositiveInt('IDENTITY_LINK_PROVIDER_FIXTURE_ID', link.providerFixtureId);
  assertPositiveInt('IDENTITY_LINK_HOME_TEAM_ID', link.providerHomeTeamId);
  assertPositiveInt('IDENTITY_LINK_AWAY_TEAM_ID', link.providerAwayTeamId);
  if (link.providerHomeTeamId === link.providerAwayTeamId) throw new Error('IDENTITY_LINK_TEAM_COLLISION');
  if (!link.eventId) throw new Error('IDENTITY_LINK_EVENT_ID_REQUIRED');
  if (link.verified !== true) throw new Error('IDENTITY_LINK_VERIFIED_REQUIRED');
  timestamp('IDENTITY_LINK_KICKOFF', link.kickoffUtc);
  if (link.observedAt) timestamp('IDENTITY_LINK_OBSERVED_AT', link.observedAt);
}

function normalizeEvent(item, link) {
  assertObject('GAME_EVENT', item);
  if (item.observation_version !== 'API_FOOTBALL_GAME_EVENT_OBSERVATION_V0_1') {
    throw new Error('GAME_EVENT_OBSERVATION_VERSION_INVALID');
  }
  if (!item.event_observation_id) throw new Error('GAME_EVENT_ID_REQUIRED');
  if (item.provider !== 'API_FOOTBALL') throw new Error('GAME_EVENT_PROVIDER_UNSUPPORTED');
  if (item.provider_fixture_id !== link.providerFixtureId) throw new Error('GAME_EVENT_PROVIDER_FIXTURE_ID_MISMATCH');
  assertNonNegativeInt('GAME_EVENT_PROVIDER_INDEX', item.provider_event_index);
  if (!validSha(item.source_fixture_sha256)) throw new Error('GAME_EVENT_FIXTURE_SHA256_INVALID');
  if (!validSha(item.source_event_sha256)) throw new Error('GAME_EVENT_SOURCE_SHA256_INVALID');
  if (item.provider_observation_verified !== true) throw new Error('GAME_EVENT_PROVIDER_VERIFICATION_REQUIRED');
  if (item.bookmaker_data_used !== false) throw new Error('GAME_EVENT_BOOKMAKER_DATA_FORBIDDEN');
  if (item.provider_prediction_used !== false) throw new Error('GAME_EVENT_PROVIDER_PREDICTION_FORBIDDEN');
  const observedEpoch = timestamp('GAME_EVENT_OBSERVED_AT', item.observed_at);
  if (observedEpoch < timestamp('IDENTITY_LINK_KICKOFF', link.kickoffUtc)) throw new Error('GAME_EVENT_OBSERVED_BEFORE_KICKOFF');

  const allowedTypes = new Set(['GOAL', 'CARD', 'SUBSTITUTION', 'VAR', 'OTHER']);
  if (!allowedTypes.has(item.event_type)) throw new Error('GAME_EVENT_TYPE_INVALID');
  const allowedSides = new Set(['HOME', 'AWAY', 'UNKNOWN']);
  if (!allowedSides.has(item.side)) throw new Error('GAME_EVENT_SIDE_INVALID');

  if (item.side === 'HOME' && item.provider_team_id !== link.providerHomeTeamId) throw new Error('GAME_EVENT_HOME_TEAM_ID_MISMATCH');
  if (item.side === 'AWAY' && item.provider_team_id !== link.providerAwayTeamId) throw new Error('GAME_EVENT_AWAY_TEAM_ID_MISMATCH');
  if (item.side === 'UNKNOWN' && [link.providerHomeTeamId, link.providerAwayTeamId].includes(item.provider_team_id)) {
    throw new Error('GAME_EVENT_UNKNOWN_SIDE_CONTRADICTS_TEAM_ID');
  }

  if (item.elapsed_minute !== null) {
    assertNonNegativeInt('GAME_EVENT_ELAPSED_MINUTE', item.elapsed_minute);
  }
  if (item.extra_minute !== null) {
    assertNonNegativeInt('GAME_EVENT_EXTRA_MINUTE', item.extra_minute);
  }
  if (!Array.isArray(item.reasons)) throw new Error('GAME_EVENT_REASONS_ARRAY_REQUIRED');

  return {
    ...clone(item),
    canonical_event_id: link.eventId,
    sequence_eligible: item.timeline_eligible === true,
    pattern_eligible: item.timeline_eligible === true && item.provider_observation_verified === true
  };
}

function compareEventOrder(a, b) {
  const aMinute = a.elapsed_minute === null ? Number.POSITIVE_INFINITY : a.elapsed_minute;
  const bMinute = b.elapsed_minute === null ? Number.POSITIVE_INFINITY : b.elapsed_minute;
  if (aMinute !== bMinute) return aMinute - bMinute;
  const aExtra = a.extra_minute ?? 0;
  const bExtra = b.extra_minute ?? 0;
  if (aExtra !== bExtra) return aExtra - bExtra;
  return a.provider_event_index - b.provider_event_index;
}

function scoreTransitionLabel({ event, before, after, everTrailed }) {
  if (event.event_type === 'GOAL' && event.goal_effect === 'NO_SCORE') return 'MISSED_PENALTY';
  if (!(event.event_type === 'GOAL' && event.goal_effect === 'SCORE' && event.sequence_eligible)) return 'NO_SCORE_CHANGE';

  const side = event.side;
  const beforeFor = sideScore(before, side);
  const beforeAgainst = opponentScore(before, side);
  const afterFor = sideScore(after, side);
  const afterAgainst = opponentScore(after, side);
  if (before.home + before.away === 0) return 'OPENING_GOAL';
  if (beforeFor < beforeAgainst && afterFor === afterAgainst) return 'EQUALIZER';
  if (beforeFor === beforeAgainst && afterFor > afterAgainst) {
    return everTrailed[side] ? 'COMEBACK_GO_AHEAD' : 'GO_AHEAD_FROM_DRAW';
  }
  if (beforeFor > beforeAgainst && afterFor > afterAgainst) return 'LEAD_EXTENSION';
  return 'SCORE_CHANGE';
}

function normalizeExpectedScore({ scoreSnapshot, matchMemory, link }) {
  if (scoreSnapshot !== null && scoreSnapshot !== undefined) {
    assertObject('SCORE_SNAPSHOT', scoreSnapshot);
    if (scoreSnapshot.provider_fixture_id !== link.providerFixtureId) throw new Error('SCORE_SNAPSHOT_FIXTURE_MISMATCH');
    if (scoreSnapshot.home_team_id !== undefined && scoreSnapshot.home_team_id !== link.providerHomeTeamId) {
      throw new Error('SCORE_SNAPSHOT_HOME_TEAM_MISMATCH');
    }
    if (scoreSnapshot.away_team_id !== undefined && scoreSnapshot.away_team_id !== link.providerAwayTeamId) {
      throw new Error('SCORE_SNAPSHOT_AWAY_TEAM_MISMATCH');
    }
    assertNonNegativeInt('SCORE_SNAPSHOT_HOME_GOALS', scoreSnapshot.home_goals);
    assertNonNegativeInt('SCORE_SNAPSHOT_AWAY_GOALS', scoreSnapshot.away_goals);
    return {
      source: 'LIVE_PROVIDER_SNAPSHOT',
      home: scoreSnapshot.home_goals,
      away: scoreSnapshot.away_goals,
      observed_at: scoreSnapshot.observed_at ?? null,
      state: scoreSnapshot.state ?? null
    };
  }

  if (matchMemory !== null && matchMemory !== undefined) {
    assertObject('MATCH_MEMORY', matchMemory);
    if (matchMemory.memory_version !== 'CANONICAL_MATCH_MEMORY_V0_1') throw new Error('MATCH_MEMORY_VERSION_INVALID');
    if (matchMemory.identity?.match_id !== link.eventId) throw new Error('MATCH_MEMORY_EVENT_ID_MISMATCH');
    assertNonNegativeInt('MATCH_MEMORY_HOME_GOALS', matchMemory.truth?.final_score?.home);
    assertNonNegativeInt('MATCH_MEMORY_AWAY_GOALS', matchMemory.truth?.final_score?.away);
    return {
      source: 'CANONICAL_MATCH_MEMORY_TRUTH',
      home: matchMemory.truth.final_score.home,
      away: matchMemory.truth.final_score.away,
      observed_at: matchMemory.materialized_at ?? null,
      state: 'SETTLED'
    };
  }
  return null;
}

export function buildGameStateTimeline({
  eventObservations,
  identityLink,
  scoreSnapshot = null,
  matchMemory = null,
  materializedAt
}) {
  if (!Array.isArray(eventObservations)) throw new Error('GAME_EVENT_OBSERVATIONS_ARRAY_REQUIRED');
  validateIdentityLink(identityLink);
  timestamp('TIMELINE_MATERIALIZED_AT', materializedAt);

  const normalized = eventObservations.map(item => normalizeEvent(item, identityLink));
  const ids = new Set();
  for (const item of normalized) {
    if (ids.has(item.event_observation_id)) throw new Error('DUPLICATE_GAME_EVENT_ID');
    ids.add(item.event_observation_id);
  }

  const ordered = [...normalized].sort(compareEventOrder);
  const score = { home: 0, away: 0 };
  const dismissals = { HOME: 0, AWAY: 0 };
  const substitutions = { HOME: 0, AWAY: 0 };
  const everTrailed = { HOME: false, AWAY: false };
  let openingGoalSide = null;
  let equalizerN = 0;
  let goAheadN = 0;
  let comebackGoAheadN = 0;
  let leadExtensionN = 0;
  let ambiguousScoreEventN = 0;

  const timelineEvents = ordered.map((event, sequenceIndex) => {
    const before = { home: score.home, away: score.away };
    const stateBefore = scoreState(before);
    if (event.event_type === 'GOAL' && event.goal_effect === 'UNKNOWN') ambiguousScoreEventN += 1;

    if (event.sequence_eligible && event.event_type === 'GOAL' && event.goal_effect === 'SCORE') {
      if (event.side === 'HOME') score.home += 1;
      else if (event.side === 'AWAY') score.away += 1;
    }
    if (event.sequence_eligible && event.event_type === 'CARD' && event.card_effect === 'DISMISSAL') {
      if (event.side === 'HOME' || event.side === 'AWAY') dismissals[event.side] += 1;
    }
    if (event.sequence_eligible && event.event_type === 'SUBSTITUTION') {
      if (event.side === 'HOME' || event.side === 'AWAY') substitutions[event.side] += 1;
    }

    const after = { home: score.home, away: score.away };
    const transition = scoreTransitionLabel({ event, before, after, everTrailed });
    if (transition === 'OPENING_GOAL' && openingGoalSide === null) openingGoalSide = event.side;
    if (transition === 'EQUALIZER') equalizerN += 1;
    if (transition === 'GO_AHEAD_FROM_DRAW' || transition === 'COMEBACK_GO_AHEAD') goAheadN += 1;
    if (transition === 'COMEBACK_GO_AHEAD') comebackGoAheadN += 1;
    if (transition === 'LEAD_EXTENSION') leadExtensionN += 1;

    if (after.home < after.away) everTrailed.HOME = true;
    if (after.away < after.home) everTrailed.AWAY = true;

    return {
      ...event,
      sequence_index: sequenceIndex,
      score_before: before,
      score_after: after,
      score_state_before: stateBefore,
      score_state_after: scoreState(after),
      score_transition: transition,
      observed_dismissals_after: { home: dismissals.HOME, away: dismissals.AWAY },
      substitutions_after: { home: substitutions.HOME, away: substitutions.AWAY },
      observable_pressure_state: {
        home_trailing: after.home < after.away,
        away_trailing: after.away < after.home,
        home_observed_dismissals: dismissals.HOME,
        away_observed_dismissals: dismissals.AWAY
      }
    };
  });

  const expectedScore = normalizeExpectedScore({ scoreSnapshot, matchMemory, link: identityLink });
  const derivedScore = { home: score.home, away: score.away };
  let scoreConsistency = 'NOT_CHECKED';
  if (expectedScore) {
    scoreConsistency = expectedScore.home === derivedScore.home && expectedScore.away === derivedScore.away
      ? 'VERIFIED'
      : 'MISMATCH';
  }

  const summary = {
    retained_event_n: timelineEvents.length,
    timeline_eligible_event_n: timelineEvents.filter(x => x.sequence_eligible).length,
    timeline_ineligible_event_n: timelineEvents.filter(x => !x.sequence_eligible).length,
    goal_event_n: timelineEvents.filter(x => x.event_type === 'GOAL').length,
    score_bearing_goal_n: timelineEvents.filter(x => x.event_type === 'GOAL' && x.goal_effect === 'SCORE' && x.sequence_eligible).length,
    missed_penalty_n: timelineEvents.filter(x => x.event_type === 'GOAL' && x.goal_effect === 'NO_SCORE').length,
    card_event_n: timelineEvents.filter(x => x.event_type === 'CARD').length,
    observed_dismissal_n: dismissals.HOME + dismissals.AWAY,
    substitution_event_n: timelineEvents.filter(x => x.event_type === 'SUBSTITUTION').length,
    var_event_n: timelineEvents.filter(x => x.event_type === 'VAR').length,
    other_event_n: timelineEvents.filter(x => x.event_type === 'OTHER').length,
    ambiguous_score_event_n: ambiguousScoreEventN,
    opening_goal_side: openingGoalSide,
    equalizer_n: equalizerN,
    go_ahead_n: goAheadN,
    comeback_go_ahead_n: comebackGoAheadN,
    lead_extension_n: leadExtensionN,
    derived_score: derivedScore,
    expected_score: expectedScore,
    score_consistency: scoreConsistency
  };

  const patternTruthEligible = identityLink.verified === true
    && scoreConsistency === 'VERIFIED'
    && ambiguousScoreEventN === 0;

  const identity = {
    provider: identityLink.provider,
    provider_fixture_id: identityLink.providerFixtureId,
    canonical_event_id: identityLink.eventId,
    provider_home_team_id: identityLink.providerHomeTeamId,
    provider_away_team_id: identityLink.providerAwayTeamId,
    kickoff_utc: identityLink.kickoffUtc,
    explicit_identity_link_verified: true
  };
  const parentMemory = matchMemory ? {
    memory_id: matchMemory.memory_id,
    memory_fingerprint: matchMemory.memory_fingerprint,
    memory_version: matchMemory.memory_version
  } : null;
  const governance = {
    raw_provider_observation_owner: 'GATE1',
    timeline_materialization_owner: 'INTELLIGENCE_ENGINE',
    canonical_final_truth_owner: 'GATE1',
    provider_identity_reused_from_existing_live_orchestration: true,
    fuzzy_team_matching: false,
    psychology_is_raw_truth: false,
    observable_state_proxies_only: true,
    event_effects_automatically_change_live_rate_multipliers: false,
    automatic_retuning: false,
    automatic_pattern_promotion: false,
    pattern_discovery_performed_here: false,
    pattern_validation_performed_here: false,
    bookmaker_data_used: false,
    provider_prediction_used: false,
    p002_changed: false,
    gate1_to_gate6_ownership_changed: false,
    capital_effect: 'NONE',
    real_money: 'NO'
  };

  const payload = {
    timeline_version: GAME_STATE_TIMELINE_VERSION,
    materialized_at: materializedAt,
    identity,
    parent_match_memory: parentMemory,
    events: timelineEvents,
    summary,
    learning: {
      retain_all_events: true,
      pattern_truth_eligible: patternTruthEligible,
      ineligible_events_retained: true,
      score_reconciliation_required: true,
      behavioral_interpretation_requires_later_multi_match_validation: true
    },
    governance
  };
  const timeline = {
    ...payload,
    timeline_id: `GAME-TIMELINE-${sha256({ version: GAME_STATE_TIMELINE_VERSION, eventId: identity.canonical_event_id }).slice(0, 24)}`,
    timeline_fingerprint: sha256(payload)
  };
  return deepFreeze(timeline);
}

export function verifyGameStateTimeline(timeline) {
  assertObject('GAME_STATE_TIMELINE', timeline);
  if (timeline.timeline_version !== GAME_STATE_TIMELINE_VERSION) throw new Error('GAME_STATE_TIMELINE_VERSION_INVALID');
  if (timeline.identity?.explicit_identity_link_verified !== true) throw new Error('GAME_STATE_TIMELINE_IDENTITY_NOT_VERIFIED');
  if (timeline.governance?.raw_provider_observation_owner !== 'GATE1') throw new Error('GAME_STATE_TIMELINE_GATE1_OWNERSHIP_VIOLATION');
  if (timeline.governance?.event_effects_automatically_change_live_rate_multipliers !== false) {
    throw new Error('GAME_STATE_TIMELINE_SILENT_MODEL_EFFECT_FORBIDDEN');
  }
  if (timeline.governance?.psychology_is_raw_truth !== false) throw new Error('GAME_STATE_TIMELINE_PSYCHOLOGY_FABRICATION_FORBIDDEN');
  if (timeline.governance?.p002_changed !== false) throw new Error('GAME_STATE_TIMELINE_P002_MUTATION_FORBIDDEN');

  const payload = {
    timeline_version: timeline.timeline_version,
    materialized_at: timeline.materialized_at,
    identity: timeline.identity,
    parent_match_memory: timeline.parent_match_memory,
    events: timeline.events,
    summary: timeline.summary,
    learning: timeline.learning,
    governance: timeline.governance
  };
  if (sha256(payload) !== timeline.timeline_fingerprint) throw new Error('GAME_STATE_TIMELINE_FINGERPRINT_INVALID');
  return true;
}
