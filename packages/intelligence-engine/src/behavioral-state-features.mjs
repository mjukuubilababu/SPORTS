import { createHash } from 'node:crypto';
import { verifyCanonicalMatchMemory } from './canonical-match-memory.mjs';
import { verifyGameStateTimeline } from './game-state-timeline.mjs';

export const BEHAVIORAL_STATE_FEATURES_VERSION = 'BEHAVIORAL_STATE_FEATURES_V0_1';
export const FROZEN_DISCOVERY_MIN_N = 30;
export const LATE_GOAL_MINUTE = 76;
export const PERIOD_BINS = Object.freeze(['0_15', '16_30', '31_45_PLUS', '46_60', '61_75', '76_90_PLUS']);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function timestamp(name, value) {
  const ms = Date.parse(value);
  if (!value || Number.isNaN(ms)) throw new Error(`${name}_TIMESTAMP_INVALID`);
  return ms;
}

function periodBin(minute) {
  if (!Number.isInteger(minute) || minute < 0) return null;
  if (minute <= 15) return '0_15';
  if (minute <= 30) return '16_30';
  if (minute <= 45) return '31_45_PLUS';
  if (minute <= 60) return '46_60';
  if (minute <= 75) return '61_75';
  return '76_90_PLUS';
}

function emptyPeriodCounts() {
  return Object.fromEntries(PERIOD_BINS.map(bin => [bin, 0]));
}

function resultForSide(actualOutcome, side) {
  if (actualOutcome === 'DRAW') return 'DRAW';
  if (side === 'HOME') return actualOutcome === 'HOME_WIN' ? 'WIN' : 'LOSS';
  return actualOutcome === 'AWAY_WIN' ? 'WIN' : 'LOSS';
}

function sideLeading(state, side) {
  return side === 'HOME' ? state === 'HOME_LEADING' : state === 'AWAY_LEADING';
}

function sideTrailing(state, side) {
  return side === 'HOME' ? state === 'AWAY_LEADING' : state === 'HOME_LEADING';
}

function eventMinute(event) {
  return Number.isInteger(event.elapsed_minute) ? event.elapsed_minute : null;
}

function wilson95(successN, opportunityN) {
  if (!Number.isInteger(successN) || !Number.isInteger(opportunityN) || successN < 0 || opportunityN < 0 || successN > opportunityN) {
    throw new Error('PROPORTION_COUNTS_INVALID');
  }
  if (opportunityN === 0) return null;
  const z = 1.959963984540054;
  const p = successN / opportunityN;
  const z2 = z * z;
  const denominator = 1 + z2 / opportunityN;
  const centre = (p + z2 / (2 * opportunityN)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) / opportunityN) + (z2 / (4 * opportunityN * opportunityN)))) / denominator;
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

function proportion(successN, opportunityN) {
  return {
    success_n: successN,
    opportunity_n: opportunityN,
    rate: opportunityN === 0 ? null : successN / opportunityN,
    wilson95: wilson95(successN, opportunityN),
    sample_state: opportunityN >= FROZEN_DISCOVERY_MIN_N
      ? 'DISCOVERY_SAMPLE_READY'
      : 'DESCRIPTIVE_ONLY_INSUFFICIENT_FOR_PATTERN_DISCOVERY'
  };
}

function countRate(total, opportunityN) {
  return {
    count: total,
    opportunity_n: opportunityN,
    per_opportunity: opportunityN === 0 ? null : total / opportunityN,
    sample_state: opportunityN >= FROZEN_DISCOVERY_MIN_N
      ? 'DISCOVERY_SAMPLE_READY'
      : 'DESCRIPTIVE_ONLY_INSUFFICIENT_FOR_PATTERN_DISCOVERY'
  };
}

function pairEligibility(timeline, memory) {
  if (!timeline || typeof timeline !== 'object') throw new Error('TIMELINE_REQUIRED');
  if (!memory || typeof memory !== 'object') throw new Error('MATCH_MEMORY_REQUIRED');
  verifyGameStateTimeline(timeline);
  verifyCanonicalMatchMemory(memory);
  if (timeline.identity?.canonical_event_id !== memory.identity?.match_id) throw new Error('TIMELINE_MEMORY_MATCH_ID_MISMATCH');

  const reasons = [];
  if (memory.learning?.pattern_truth_eligible !== true) reasons.push('MATCH_MEMORY_PATTERN_TRUTH_INELIGIBLE');
  if (timeline.learning?.pattern_truth_eligible !== true) reasons.push('TIMELINE_PATTERN_TRUTH_INELIGIBLE');
  if (timeline.summary?.score_consistency !== 'VERIFIED') reasons.push('TIMELINE_SCORE_NOT_VERIFIED');
  if (timeline.summary?.expected_score?.source !== 'CANONICAL_MATCH_MEMORY_TRUTH') reasons.push('SETTLED_MEMORY_SCORE_SOURCE_REQUIRED');
  if (timeline.summary?.expected_score?.state !== 'SETTLED') reasons.push('SETTLED_TIMELINE_REQUIRED');
  if (timeline.summary?.derived_score?.home !== memory.truth?.final_score?.home || timeline.summary?.derived_score?.away !== memory.truth?.final_score?.away) {
    reasons.push('TIMELINE_FINAL_SCORE_MEMORY_MISMATCH');
  }
  return { eligible: reasons.length === 0, reasons };
}

function deriveTeamObservation(timeline, memory, side) {
  if (!['HOME', 'AWAY'].includes(side)) throw new Error('BEHAVIOR_SIDE_INVALID');
  const identity = memory.identity;
  const truth = memory.truth;
  const subjectTeam = side === 'HOME' ? identity.home_team : identity.away_team;
  const opponentTeam = side === 'HOME' ? identity.away_team : identity.home_team;
  const finalScoreFor = side === 'HOME' ? truth.final_score.home : truth.final_score.away;
  const finalScoreAgainst = side === 'HOME' ? truth.final_score.away : truth.final_score.home;
  const finalResult = resultForSide(truth.actual_outcome, side);

  const events = timeline.events.filter(event => event.sequence_eligible === true);
  let firstLeadIndex = null;
  let firstLeadMinute = null;
  let firstTrailingIndex = null;
  let firstTrailingMinute = null;
  let firstOwnDismissalIndex = null;
  let firstOwnDismissalMinute = null;
  let firstSubstitutionMinute = null;
  let dismissalForN = 0;
  let dismissalAgainstN = 0;
  let substitutionN = 0;
  let equalizedAfterTrailing = false;
  let comebackGoAhead = false;
  let lateGoalScoredN = 0;
  let lateGoalConcededN = 0;
  let goalsScoredAfterOwnFirstDismissalN = 0;
  let goalsConcededAfterOwnFirstDismissalN = 0;
  const scoredByPeriod = emptyPeriodCounts();
  const concededByPeriod = emptyPeriodCounts();

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const minute = eventMinute(event);
    if (firstLeadIndex === null && sideLeading(event.score_state_after, side)) {
      firstLeadIndex = index;
      firstLeadMinute = minute;
    }
    if (firstTrailingIndex === null && sideTrailing(event.score_state_after, side)) {
      firstTrailingIndex = index;
      firstTrailingMinute = minute;
    }

    if (event.side === side && event.score_transition === 'EQUALIZER' && firstTrailingIndex !== null && index >= firstTrailingIndex) {
      equalizedAfterTrailing = true;
    }
    if (event.side === side && event.score_transition === 'COMEBACK_GO_AHEAD') comebackGoAhead = true;

    if (event.event_type === 'CARD' && event.card_effect === 'DISMISSAL') {
      if (event.side === side) {
        dismissalForN += 1;
        if (firstOwnDismissalIndex === null) {
          firstOwnDismissalIndex = index;
          firstOwnDismissalMinute = minute;
        }
      } else if (event.side !== 'UNKNOWN') {
        dismissalAgainstN += 1;
      }
    }

    if (event.event_type === 'SUBSTITUTION' && event.side === side) {
      substitutionN += 1;
      if (firstSubstitutionMinute === null) firstSubstitutionMinute = minute;
    }

    if (event.event_type === 'GOAL' && event.goal_effect === 'SCORE') {
      const bin = periodBin(minute);
      if (event.side === side) {
        if (bin) scoredByPeriod[bin] += 1;
        if (minute !== null && minute >= LATE_GOAL_MINUTE) lateGoalScoredN += 1;
      } else if (event.side !== 'UNKNOWN') {
        if (bin) concededByPeriod[bin] += 1;
        if (minute !== null && minute >= LATE_GOAL_MINUTE) lateGoalConcededN += 1;
      }
      if (firstOwnDismissalIndex !== null && index > firstOwnDismissalIndex) {
        if (event.side === side) goalsScoredAfterOwnFirstDismissalN += 1;
        else if (event.side !== 'UNKNOWN') goalsConcededAfterOwnFirstDismissalN += 1;
      }
    }
  }

  const ledAtAnyTime = firstLeadIndex !== null;
  const trailedAtAnyTime = firstTrailingIndex !== null;
  const leadSurrendered = ledAtAnyTime && events.slice(firstLeadIndex + 1).some(event => !sideLeading(event.score_state_after, side));
  const openingGoalSide = timeline.summary.opening_goal_side;

  const payload = {
    feature_version: BEHAVIORAL_STATE_FEATURES_VERSION,
    canonical_match_id: identity.match_id,
    canonical_match_date: identity.canonical_match_date,
    season: identity.season,
    league: identity.league,
    subject_team: subjectTeam,
    opponent_team: opponentTeam,
    venue_side: side,
    final_result: finalResult,
    final_score_for: finalScoreFor,
    final_score_against: finalScoreAgainst,
    led_at_any_time: ledAtAnyTime,
    first_lead_minute: firstLeadMinute,
    lead_surrendered: leadSurrendered,
    uninterrupted_lead_win: ledAtAnyTime && !leadSurrendered && finalResult === 'WIN',
    lead_surrendered_then_recovered_win: ledAtAnyTime && leadSurrendered && finalResult === 'WIN',
    points_dropped_after_leading: ledAtAnyTime && finalResult !== 'WIN',
    trailed_at_any_time: trailedAtAnyTime,
    first_trailing_minute: firstTrailingMinute,
    equalized_after_trailing: trailedAtAnyTime && equalizedAfterTrailing,
    comeback_go_ahead: trailedAtAnyTime && comebackGoAhead,
    recovered_nonloss_after_trailing: trailedAtAnyTime && finalResult !== 'LOSS',
    recovered_win_after_trailing: trailedAtAnyTime && finalResult === 'WIN',
    opening_goal_scored: openingGoalSide === side,
    opening_goal_conceded: openingGoalSide !== null && openingGoalSide !== side,
    opening_goal_observed: openingGoalSide !== null,
    late_goal_scored_n: lateGoalScoredN,
    late_goal_conceded_n: lateGoalConcededN,
    dismissal_for_n: dismissalForN,
    dismissal_against_n: dismissalAgainstN,
    first_own_dismissal_minute: firstOwnDismissalMinute,
    goals_scored_after_own_first_dismissal_n: goalsScoredAfterOwnFirstDismissalN,
    goals_conceded_after_own_first_dismissal_n: goalsConcededAfterOwnFirstDismissalN,
    substitution_n: substitutionN,
    first_substitution_minute: firstSubstitutionMinute,
    goals_scored_by_period: scoredByPeriod,
    goals_conceded_by_period: concededByPeriod,
    source_timeline_id: timeline.timeline_id,
    source_timeline_fingerprint: timeline.timeline_fingerprint,
    source_memory_id: memory.memory_id,
    source_memory_fingerprint: memory.memory_fingerprint,
    descriptive_only: true,
    predictive_weight: 0
  };
  return deepFreeze({ ...payload, observation_fingerprint: sha256(payload) });
}

function aggregateRows(rows, { includeSplits = true } = {}) {
  const matchN = rows.length;
  const count = predicate => rows.filter(predicate).length;
  const ledN = count(row => row.led_at_any_time);
  const surrenderedN = count(row => row.lead_surrendered);
  const trailedN = count(row => row.trailed_at_any_time);
  const ownDismissalN = count(row => row.dismissal_for_n > 0);
  const openingObservedN = count(row => row.opening_goal_observed);

  const periodScored = emptyPeriodCounts();
  const periodConceded = emptyPeriodCounts();
  for (const row of rows) {
    for (const bin of PERIOD_BINS) {
      periodScored[bin] += row.goals_scored_by_period[bin];
      periodConceded[bin] += row.goals_conceded_by_period[bin];
    }
  }

  const metrics = {
    match_n: matchN,
    outcomes: {
      win: proportion(count(row => row.final_result === 'WIN'), matchN),
      draw: proportion(count(row => row.final_result === 'DRAW'), matchN),
      loss: proportion(count(row => row.final_result === 'LOSS'), matchN)
    },
    lead_behavior: {
      led_match: proportion(ledN, matchN),
      uninterrupted_lead_win: proportion(count(row => row.uninterrupted_lead_win), ledN),
      lead_surrender: proportion(surrenderedN, ledN),
      points_dropped_after_leading: proportion(count(row => row.points_dropped_after_leading), ledN),
      lead_surrender_recovery_win: proportion(count(row => row.lead_surrendered_then_recovered_win), surrenderedN)
    },
    trailing_response: {
      trailed_match: proportion(trailedN, matchN),
      equalize_after_trailing: proportion(count(row => row.equalized_after_trailing), trailedN),
      nonloss_after_trailing: proportion(count(row => row.recovered_nonloss_after_trailing), trailedN),
      win_after_trailing: proportion(count(row => row.recovered_win_after_trailing), trailedN),
      comeback_go_ahead: proportion(count(row => row.comeback_go_ahead), trailedN)
    },
    opening_goal: {
      scored_share_when_observed: proportion(count(row => row.opening_goal_scored), openingObservedN),
      conceded_share_when_observed: proportion(count(row => row.opening_goal_conceded), openingObservedN),
      observed_match_n: openingObservedN
    },
    temporal_behavior: {
      late_goal_scored_match: proportion(count(row => row.late_goal_scored_n > 0), matchN),
      late_goal_conceded_match: proportion(count(row => row.late_goal_conceded_n > 0), matchN),
      late_goals_scored: countRate(rows.reduce((sum, row) => sum + row.late_goal_scored_n, 0), matchN),
      late_goals_conceded: countRate(rows.reduce((sum, row) => sum + row.late_goal_conceded_n, 0), matchN),
      goals_scored_by_period_per_match: Object.fromEntries(PERIOD_BINS.map(bin => [bin, matchN === 0 ? null : periodScored[bin] / matchN])),
      goals_conceded_by_period_per_match: Object.fromEntries(PERIOD_BINS.map(bin => [bin, matchN === 0 ? null : periodConceded[bin] / matchN])),
      goals_scored_by_period_count: periodScored,
      goals_conceded_by_period_count: periodConceded
    },
    dismissal_context: {
      own_dismissal_match: proportion(ownDismissalN, matchN),
      opponent_dismissal_match: proportion(count(row => row.dismissal_against_n > 0), matchN),
      goals_scored_after_own_first_dismissal: countRate(rows.reduce((sum, row) => sum + row.goals_scored_after_own_first_dismissal_n, 0), ownDismissalN),
      goals_conceded_after_own_first_dismissal: countRate(rows.reduce((sum, row) => sum + row.goals_conceded_after_own_first_dismissal_n, 0), ownDismissalN)
    },
    substitution_context: {
      substitutions: countRate(rows.reduce((sum, row) => sum + row.substitution_n, 0), matchN),
      first_substitution_minute_mean: (() => {
        const values = rows.map(row => row.first_substitution_minute).filter(Number.isInteger);
        return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      })()
    }
  };

  if (includeSplits) {
    metrics.venue_splits = {
      HOME: aggregateRows(rows.filter(row => row.venue_side === 'HOME'), { includeSplits: false }),
      AWAY: aggregateRows(rows.filter(row => row.venue_side === 'AWAY'), { includeSplits: false })
    };
  }
  return metrics;
}

function buildProfile(team, rows, materializedAt) {
  const sortedRows = [...rows].sort((a, b) => {
    const date = a.canonical_match_date.localeCompare(b.canonical_match_date);
    return date || a.canonical_match_id.localeCompare(b.canonical_match_id);
  });
  const metrics = aggregateRows(sortedRows);
  const competitionCounts = {};
  const seasonCounts = {};
  for (const row of sortedRows) {
    competitionCounts[row.league] = (competitionCounts[row.league] ?? 0) + 1;
    seasonCounts[String(row.season)] = (seasonCounts[String(row.season)] ?? 0) + 1;
  }
  const payload = {
    profile_version: BEHAVIORAL_STATE_FEATURES_VERSION,
    subject_team: team,
    materialized_at: materializedAt,
    match_n: sortedRows.length,
    discovery_min_n: FROZEN_DISCOVERY_MIN_N,
    discovery_sample_ready: sortedRows.length >= FROZEN_DISCOVERY_MIN_N,
    sample_state: sortedRows.length >= FROZEN_DISCOVERY_MIN_N
      ? 'FEATURE_SAMPLE_READY_FOR_GOVERNED_PATTERN_DISCOVERY'
      : 'DESCRIPTIVE_ONLY_INSUFFICIENT_FOR_PATTERN_DISCOVERY',
    competition_match_n: competitionCounts,
    season_match_n: seasonCounts,
    metrics,
    opponent_context: sortedRows.map(row => ({
      canonical_match_id: row.canonical_match_id,
      canonical_match_date: row.canonical_match_date,
      opponent_team: row.opponent_team,
      venue_side: row.venue_side,
      final_result: row.final_result,
      observation_fingerprint: row.observation_fingerprint
    })),
    source_observation_fingerprints: sortedRows.map(row => row.observation_fingerprint),
    existing_intelligence_bridge: {
      target_existing_domain: 'TEMPORAL_SCORING_DEFENDING',
      bridge_state: 'DESCRIPTIVE_NOT_SIGNAL',
      automatic_injection: false,
      automatic_impact_assignment: false,
      decision_weight: 0,
      requires_future_pattern_discovery_and_out_of_sample_validation: true
    },
    governance: {
      win_draw_loss_all_retained: true,
      home_away_context_retained: true,
      opponent_context_retained: true,
      psychology_label_is_feature: false,
      market_data_used: false,
      predictive_weight_assigned: false,
      automatic_retuning: false,
      automatic_pattern_promotion: false,
      p002_changed: false,
      capital_effect: 'NONE',
      real_money: 'NO'
    }
  };
  return deepFreeze({ ...payload, profile_fingerprint: sha256(payload) });
}

export function buildBehavioralStateFeatureCorpus({ matchPairs, materializedAt }) {
  if (!Array.isArray(matchPairs)) throw new Error('MATCH_PAIRS_ARRAY_REQUIRED');
  timestamp('BEHAVIORAL_FEATURES_MATERIALIZED_AT', materializedAt);

  const seenMatches = new Set();
  const observations = [];
  const retainedIneligible = [];

  for (let index = 0; index < matchPairs.length; index += 1) {
    const pair = matchPairs[index];
    if (!pair || typeof pair !== 'object') throw new Error('MATCH_PAIR_OBJECT_REQUIRED');
    const timeline = pair.timeline;
    const memory = pair.matchMemory;
    const matchId = memory?.identity?.match_id ?? timeline?.identity?.canonical_event_id ?? `INDEX-${index}`;
    if (seenMatches.has(matchId)) throw new Error('DUPLICATE_MATCH_PAIR');
    seenMatches.add(matchId);

    const eligibility = pairEligibility(timeline, memory);
    if (!eligibility.eligible) {
      retainedIneligible.push({
        canonical_match_id: matchId,
        timeline_id: timeline.timeline_id ?? null,
        timeline_fingerprint: timeline.timeline_fingerprint ?? null,
        memory_id: memory.memory_id ?? null,
        memory_fingerprint: memory.memory_fingerprint ?? null,
        reasons: eligibility.reasons,
        feature_influence: 0,
        retained: true
      });
      continue;
    }
    observations.push(deriveTeamObservation(timeline, memory, 'HOME'));
    observations.push(deriveTeamObservation(timeline, memory, 'AWAY'));
  }

  const grouped = new Map();
  for (const observation of observations) {
    const rows = grouped.get(observation.subject_team) ?? [];
    rows.push(observation);
    grouped.set(observation.subject_team, rows);
  }
  const profiles = [...grouped.entries()]
    .map(([team, rows]) => buildProfile(team, rows, materializedAt))
    .sort((a, b) => a.subject_team.localeCompare(b.subject_team));

  const payload = {
    corpus_version: BEHAVIORAL_STATE_FEATURES_VERSION,
    materialized_at: materializedAt,
    input_match_pair_n: matchPairs.length,
    accepted_match_n: observations.length / 2,
    retained_ineligible_match_n: retainedIneligible.length,
    team_observation_n: observations.length,
    team_profile_n: profiles.length,
    observations,
    retained_ineligible_inputs: retainedIneligible,
    profiles,
    governance: {
      each_eligible_match_creates_both_team_sides: true,
      outcome_based_deletion_forbidden: true,
      ineligible_structurally_valid_input_retained: true,
      tampered_or_cross_match_input_fails_closed: true,
      feature_layer_is_descriptive_only: true,
      pattern_discovery_performed_here: false,
      predictive_weight_assigned: false,
      automatic_retuning: false,
      automatic_pattern_promotion: false,
      market_data_used: false,
      p002_discovery_min_n: FROZEN_DISCOVERY_MIN_N,
      p002_changed: false,
      gate1_to_gate6_ownership_changed: false,
      capital_effect: 'NONE',
      real_money: 'NO'
    }
  };
  return deepFreeze({ ...payload, corpus_fingerprint: sha256(payload) });
}

export function verifyBehavioralStateFeatureCorpus(corpus) {
  if (!corpus || typeof corpus !== 'object') throw new Error('BEHAVIORAL_FEATURE_CORPUS_REQUIRED');
  if (corpus.corpus_version !== BEHAVIORAL_STATE_FEATURES_VERSION) throw new Error('BEHAVIORAL_FEATURE_CORPUS_VERSION_INVALID');
  if (corpus.governance?.predictive_weight_assigned !== false) throw new Error('BEHAVIORAL_FEATURE_PREDICTIVE_WEIGHT_FORBIDDEN');
  if (corpus.governance?.pattern_discovery_performed_here !== false) throw new Error('BEHAVIORAL_FEATURE_PATTERN_DISCOVERY_FORBIDDEN');
  if (corpus.governance?.p002_changed !== false) throw new Error('BEHAVIORAL_FEATURE_P002_MUTATION_FORBIDDEN');
  if (corpus.team_observation_n !== corpus.accepted_match_n * 2) throw new Error('BEHAVIORAL_FEATURE_BOTH_SIDES_INVARIANT_VIOLATION');

  for (const observation of corpus.observations ?? []) {
    const { observation_fingerprint, ...payload } = observation;
    if (sha256(payload) !== observation_fingerprint) throw new Error('BEHAVIORAL_OBSERVATION_FINGERPRINT_INVALID');
  }
  for (const profile of corpus.profiles ?? []) {
    const { profile_fingerprint, ...payload } = profile;
    if (sha256(payload) !== profile_fingerprint) throw new Error('BEHAVIORAL_PROFILE_FINGERPRINT_INVALID');
  }
  const { corpus_fingerprint, ...payload } = corpus;
  if (sha256(payload) !== corpus_fingerprint) throw new Error('BEHAVIORAL_CORPUS_FINGERPRINT_INVALID');
  return true;
}
