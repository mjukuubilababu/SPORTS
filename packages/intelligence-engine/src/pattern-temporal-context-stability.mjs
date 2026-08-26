import { createHash } from 'node:crypto';
import { verifyBehavioralStateFeatureCorpus } from './behavioral-state-features.mjs';
import {
  classifyConfirmatoryObservation,
  verifyPatternConfirmatoryFreeze
} from './pattern-candidate-confirmatory-freeze.mjs';
import {
  PATTERN_CONFIRMATORY_OOS_TESTED_STATE,
  verifyPatternConfirmatoryEvaluation
} from './pattern-confirmatory-out-of-sample-evaluation.mjs';

export const PATTERN_TEMPORAL_CONTEXT_STABILITY_VERSION = 'PATTERN_TEMPORAL_CONTEXT_STABILITY_V0_1';
export const PATTERN_STABILITY_WAITING_STATE = 'WAITING_FOR_STEP6_OOS_PASS_OR_STABILITY_COVERAGE';
export const PATTERN_STABILITY_ASSESSED_STATE = 'PATTERN_TEMPORAL_CONTEXT_STABILITY_ASSESSED';
export const TEMPORAL_WINDOW_N = 3;
export const STABILITY_MIN_WINDOW_OPPORTUNITY_N = 10;
export const STABILITY_MIN_WINDOW_CLUSTER_N = 10;
export const STABILITY_MIN_WINDOW_ORIENTED_EFFECT = 0.05;
export const STABILITY_MIN_MEDIAN_ORIENTED_EFFECT = 0.10;
export const STABILITY_MAX_TEMPORAL_ORIENTED_EFFECT_RANGE = 0.20;
export const STABILITY_MAX_OPPONENT_CLUSTER_SHARE = 0.20;
export const STABILITY_MIN_UNIQUE_OPPONENT_N = 10;
export const STABILITY_MIN_SEASON_CONTEXT_CLUSTER_N = 5;

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

function parseTimestamp(name, value) {
  const ms = Date.parse(value);
  if (!value || Number.isNaN(ms)) throw new Error(`${name}_INVALID_TIMESTAMP`);
  return ms;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function opportunityPredicate(definition, row) {
  switch (definition) {
    case 'MATCH': return true;
    case 'led_at_any_time': return row.led_at_any_time === true;
    case 'trailed_at_any_time': return row.trailed_at_any_time === true;
    case 'opening_goal_observed': return row.opening_goal_observed === true;
    default: throw new Error('STEP7_UNKNOWN_OPPORTUNITY_DEFINITION');
  }
}

function successPredicate(definition, row) {
  switch (definition) {
    case 'lead_surrendered': return row.lead_surrendered === true;
    case 'points_dropped_after_leading': return row.points_dropped_after_leading === true;
    case 'equalized_after_trailing': return row.equalized_after_trailing === true;
    case 'recovered_win_after_trailing': return row.recovered_win_after_trailing === true;
    case 'comeback_go_ahead': return row.comeback_go_ahead === true;
    case 'late_goal_scored_n_gt_0': return Number(row.late_goal_scored_n) > 0;
    case 'late_goal_conceded_n_gt_0': return Number(row.late_goal_conceded_n) > 0;
    case 'opening_goal_scored': return row.opening_goal_scored === true;
    default: throw new Error('STEP7_UNKNOWN_SUCCESS_DEFINITION');
  }
}

function orientation(direction) {
  if (direction === 'HIGHER_THAN_REFERENCE') return 1;
  if (direction === 'LOWER_THAN_REFERENCE') return -1;
  throw new Error('STEP7_DIRECTION_INVALID');
}

function groupCounts(rows, plan) {
  const opportunityRows = rows.filter(row => opportunityPredicate(plan.confirmatory_test_plan.opportunity_definition, row));
  const successN = opportunityRows.filter(row => successPredicate(plan.confirmatory_test_plan.success_definition, row)).length;
  return {
    match_n: uniqueSorted(rows.map(row => row.canonical_match_id)).length,
    opportunity_n: opportunityRows.length,
    success_n: successN,
    rate: opportunityRows.length ? successN / opportunityRows.length : null,
    cluster_n: uniqueSorted(opportunityRows.map(row => row.canonical_match_id)).length,
    match_ids: uniqueSorted(rows.map(row => row.canonical_match_id)),
    opportunity_match_ids: uniqueSorted(opportunityRows.map(row => row.canonical_match_id)),
    observation_fingerprints: opportunityRows.map(row => row.observation_fingerprint).sort(),
    opportunity_rows: opportunityRows
  };
}

function effectSummary(subjectRows, referenceRows, plan) {
  const subject = groupCounts(subjectRows, plan);
  const reference = groupCounts(referenceRows, plan);
  const effect = subject.rate === null || reference.rate === null ? null : subject.rate - reference.rate;
  const orientedEffect = effect === null ? null : orientation(plan.frozen_definition.direction) * effect;
  return {
    subject: { ...subject, opportunity_rows: undefined },
    reference: { ...reference, opportunity_rows: undefined },
    effect,
    effect_pp: effect === null ? null : effect * 100,
    oriented_effect: orientedEffect,
    oriented_effect_pp: orientedEffect === null ? null : orientedEffect * 100,
    direction_consistent: orientedEffect !== null && orientedEffect > 0
  };
}

function exactStep6EvidenceRows(plan, step6Result, corpus) {
  const subjectRows = [];
  const referenceRows = [];
  for (const observation of corpus.observations ?? []) {
    const classification = classifyConfirmatoryObservation({ plan, observation });
    if (classification.eligible === true && classification.role === 'SUBJECT') subjectRows.push(observation);
    if (classification.eligible === true && classification.role === 'REFERENCE') referenceRows.push(observation);
  }
  const subject = groupCounts(subjectRows, plan);
  const reference = groupCounts(referenceRows, plan);
  if (stableStringify(subject.observation_fingerprints) !== stableStringify(step6Result.subject?.observation_fingerprints ?? [])) {
    throw new Error('STEP7_SUBJECT_EVIDENCE_FINGERPRINT_SET_MISMATCH');
  }
  if (stableStringify(reference.observation_fingerprints) !== stableStringify(step6Result.reference?.observation_fingerprints ?? [])) {
    throw new Error('STEP7_REFERENCE_EVIDENCE_FINGERPRINT_SET_MISMATCH');
  }
  if (stableStringify(subject.opportunity_match_ids) !== stableStringify(step6Result.subject?.opportunity_match_ids ?? [])) {
    throw new Error('STEP7_SUBJECT_MATCH_SET_MISMATCH');
  }
  if (stableStringify(reference.opportunity_match_ids) !== stableStringify(step6Result.reference?.opportunity_match_ids ?? [])) {
    throw new Error('STEP7_REFERENCE_MATCH_SET_MISMATCH');
  }
  return { subjectRows: subject.opportunity_rows, referenceRows: reference.opportunity_rows };
}

function partitionSubjectClusters(subjectRows) {
  const byMatch = new Map();
  for (const row of subjectRows) {
    if (!byMatch.has(row.canonical_match_id)) {
      byMatch.set(row.canonical_match_id, {
        match_id: row.canonical_match_id,
        date: row.canonical_match_date
      });
    }
  }
  const clusters = [...byMatch.values()].sort((a, b) => a.date.localeCompare(b.date) || a.match_id.localeCompare(b.match_id));
  if (!clusters.length) return [];
  const base = Math.floor(clusters.length / TEMPORAL_WINDOW_N);
  const remainder = clusters.length % TEMPORAL_WINDOW_N;
  const windows = [];
  let cursor = 0;
  for (let index = 0; index < TEMPORAL_WINDOW_N; index += 1) {
    const size = base + (index < remainder ? 1 : 0);
    const slice = clusters.slice(cursor, cursor + size);
    cursor += size;
    windows.push({
      index: index + 1,
      label: ['EARLY', 'MIDDLE', 'LATE'][index],
      match_ids: slice.map(row => row.match_id),
      start_date: slice.length ? slice[0].date : null,
      end_date: slice.length ? slice[slice.length - 1].date : null
    });
  }
  return windows;
}

function temporalStability(subjectRows, referenceRows, plan) {
  const windows = partitionSubjectClusters(subjectRows).map(window => {
    const subjectSet = new Set(window.match_ids);
    const sRows = subjectRows.filter(row => subjectSet.has(row.canonical_match_id));
    const rRows = window.start_date === null
      ? []
      : referenceRows.filter(row => row.canonical_match_date >= window.start_date && row.canonical_match_date <= window.end_date);
    const effect = effectSummary(sRows, rRows, plan);
    const ready = effect.subject.opportunity_n >= STABILITY_MIN_WINDOW_OPPORTUNITY_N
      && effect.reference.opportunity_n >= STABILITY_MIN_WINDOW_OPPORTUNITY_N
      && effect.subject.cluster_n >= STABILITY_MIN_WINDOW_CLUSTER_N
      && effect.reference.cluster_n >= STABILITY_MIN_WINDOW_CLUSTER_N;
    return {
      ...window,
      ...effect,
      readiness: {
        subject_opportunity_n: effect.subject.opportunity_n >= STABILITY_MIN_WINDOW_OPPORTUNITY_N,
        reference_opportunity_n: effect.reference.opportunity_n >= STABILITY_MIN_WINDOW_OPPORTUNITY_N,
        subject_cluster_n: effect.subject.cluster_n >= STABILITY_MIN_WINDOW_CLUSTER_N,
        reference_cluster_n: effect.reference.cluster_n >= STABILITY_MIN_WINDOW_CLUSTER_N
      },
      ready
    };
  });

  const allReady = windows.length === TEMPORAL_WINDOW_N && windows.every(row => row.ready === true);
  const oriented = windows.filter(row => row.ready && Number.isFinite(row.oriented_effect)).map(row => row.oriented_effect);
  const sorted = [...oriented].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const min = sorted.length ? sorted[0] : null;
  const max = sorted.length ? sorted[sorted.length - 1] : null;
  const range = min === null || max === null ? null : max - min;
  const directionConsistent = allReady && windows.every(row => row.direction_consistent === true);
  const minimumWindowEffectMet = allReady && min >= STABILITY_MIN_WINDOW_ORIENTED_EFFECT;
  const medianEffectMet = allReady && median >= STABILITY_MIN_MEDIAN_ORIENTED_EFFECT;
  const rangeMet = allReady && range <= STABILITY_MAX_TEMPORAL_ORIENTED_EFFECT_RANGE;
  return {
    method: 'DETERMINISTIC_CHRONOLOGICAL_SUBJECT_CLUSTER_THIRDS_NO_NEW_ALPHA',
    window_n: TEMPORAL_WINDOW_N,
    windows,
    all_windows_ready: allReady,
    direction_consistent_all_windows: directionConsistent,
    minimum_oriented_effect: min,
    median_oriented_effect: median,
    maximum_oriented_effect: max,
    oriented_effect_range: range,
    minimum_window_effect_floor: STABILITY_MIN_WINDOW_ORIENTED_EFFECT,
    median_effect_floor: STABILITY_MIN_MEDIAN_ORIENTED_EFFECT,
    maximum_effect_range: STABILITY_MAX_TEMPORAL_ORIENTED_EFFECT_RANGE,
    minimum_window_effect_met: minimumWindowEffectMet,
    median_effect_met: medianEffectMet,
    effect_range_met: rangeMet,
    pass: allReady && directionConsistent && minimumWindowEffectMet && medianEffectMet && rangeMet
  };
}

function venueContextStability(subjectRows, referenceRows, plan) {
  const frozenContext = plan.frozen_definition.scope.venue_context;
  if (frozenContext !== 'ALL') {
    const scoped = effectSummary(subjectRows, referenceRows, plan);
    return {
      frozen_context: frozenContext,
      cross_venue_generalization_tested: false,
      state: 'FROZEN_SINGLE_VENUE_SCOPE_NOT_CROSS_VENUE_GENERALIZED',
      scoped_effect: scoped,
      scope_limitation: `VALID_ONLY_WITHIN_${frozenContext}_CONTEXT`,
      pass_within_frozen_scope: scoped.direction_consistent === true
    };
  }

  const contexts = ['HOME', 'AWAY'].map(context => {
    const sRows = subjectRows.filter(row => row.venue_side === context);
    const rRows = referenceRows.filter(row => row.venue_side === context);
    const effect = effectSummary(sRows, rRows, plan);
    const ready = effect.subject.opportunity_n >= STABILITY_MIN_WINDOW_OPPORTUNITY_N
      && effect.reference.opportunity_n >= STABILITY_MIN_WINDOW_OPPORTUNITY_N
      && effect.subject.cluster_n >= STABILITY_MIN_WINDOW_CLUSTER_N
      && effect.reference.cluster_n >= STABILITY_MIN_WINDOW_CLUSTER_N;
    return {
      context,
      ...effect,
      ready,
      minimum_oriented_effect_floor: STABILITY_MIN_WINDOW_ORIENTED_EFFECT,
      effect_floor_met: ready && effect.oriented_effect >= STABILITY_MIN_WINDOW_ORIENTED_EFFECT
    };
  });
  const allReady = contexts.every(row => row.ready === true);
  const pass = allReady && contexts.every(row => row.direction_consistent === true && row.effect_floor_met === true);
  return {
    frozen_context: 'ALL',
    cross_venue_generalization_tested: true,
    contexts,
    all_contexts_ready: allReady,
    pass
  };
}

function opponentDiversity(subjectRows) {
  const byMatch = new Map();
  for (const row of subjectRows) {
    if (!byMatch.has(row.canonical_match_id)) byMatch.set(row.canonical_match_id, row.opponent_team);
  }
  const opponentCounts = new Map();
  for (const opponent of byMatch.values()) opponentCounts.set(opponent, (opponentCounts.get(opponent) ?? 0) + 1);
  const clusterN = byMatch.size;
  const shares = [...opponentCounts.entries()].map(([opponent, n]) => ({
    opponent,
    cluster_n: n,
    cluster_share: clusterN ? n / clusterN : null
  })).sort((a, b) => b.cluster_share - a.cluster_share || a.opponent.localeCompare(b.opponent));
  const maxShare = shares.length ? shares[0].cluster_share : null;
  const hhi = shares.reduce((sum, row) => sum + (row.cluster_share ?? 0) ** 2, 0);
  const uniqueOpponentN = shares.length;
  return {
    opportunity_cluster_n: clusterN,
    unique_opponent_n: uniqueOpponentN,
    minimum_unique_opponent_n: STABILITY_MIN_UNIQUE_OPPONENT_N,
    max_single_opponent_cluster_share: maxShare,
    maximum_allowed_single_opponent_cluster_share: STABILITY_MAX_OPPONENT_CLUSTER_SHARE,
    opponent_cluster_hhi: hhi,
    top_opponents: shares.slice(0, 10),
    unique_opponent_gate: uniqueOpponentN >= STABILITY_MIN_UNIQUE_OPPONENT_N,
    concentration_gate: maxShare !== null && maxShare <= STABILITY_MAX_OPPONENT_CLUSTER_SHARE,
    pass: uniqueOpponentN >= STABILITY_MIN_UNIQUE_OPPONENT_N && maxShare !== null && maxShare <= STABILITY_MAX_OPPONENT_CLUSTER_SHARE
  };
}

function seasonContext(subjectRows, referenceRows, plan) {
  const seasons = uniqueSorted(subjectRows.map(row => String(row.season)));
  const rows = seasons.map(season => {
    const sRows = subjectRows.filter(row => String(row.season) === season);
    const rRows = referenceRows.filter(row => String(row.season) === season);
    const effect = effectSummary(sRows, rRows, plan);
    const ready = effect.subject.opportunity_n >= STABILITY_MIN_SEASON_CONTEXT_CLUSTER_N
      && effect.reference.opportunity_n >= STABILITY_MIN_SEASON_CONTEXT_CLUSTER_N
      && effect.subject.cluster_n >= STABILITY_MIN_SEASON_CONTEXT_CLUSTER_N
      && effect.reference.cluster_n >= STABILITY_MIN_SEASON_CONTEXT_CLUSTER_N;
    return { season, ...effect, ready };
  });
  const testable = rows.filter(row => row.ready === true);
  const crossSeasonTested = testable.length >= 2;
  const directionConsistent = crossSeasonTested ? testable.every(row => row.direction_consistent === true) : null;
  return {
    observed_season_n: seasons.length,
    testable_season_n: testable.length,
    minimum_clusters_per_testable_season: STABILITY_MIN_SEASON_CONTEXT_CLUSTER_N,
    seasons: rows,
    cross_season_generalization_tested: crossSeasonTested,
    direction_consistent_across_testable_seasons: directionConsistent,
    scope_limitation: crossSeasonTested ? null : 'CROSS_SEASON_GENERALIZATION_NOT_ESTABLISHED',
    diagnostic_pass_if_testable: crossSeasonTested ? directionConsistent : null
  };
}

function waitingResult(step6Result, reason) {
  const payload = {
    pattern_id: step6Result.pattern_id,
    state: reason,
    source_step6_state: step6Result.state,
    source_step6_result_fingerprint: step6Result.result_fingerprint,
    temporal_stability: 'NOT_TESTED',
    context_stability: 'NOT_TESTED',
    pattern_validated: false,
    decision_weight: 0,
    rejected_evidence_retained: step6Result.out_of_sample_result === 'FAIL'
  };
  return deepFreeze({ ...payload, stability_result_fingerprint: sha256(payload) });
}

function assessPassedResult(plan, step6Result, corpus) {
  const { subjectRows, referenceRows } = exactStep6EvidenceRows(plan, step6Result, corpus);
  const temporal = temporalStability(subjectRows, referenceRows, plan);
  const venue = venueContextStability(subjectRows, referenceRows, plan);
  const opponents = opponentDiversity(subjectRows);
  const seasons = seasonContext(subjectRows, referenceRows, plan);

  const venueReady = plan.frozen_definition.scope.venue_context === 'ALL' ? venue.all_contexts_ready === true : true;
  const venuePass = plan.frozen_definition.scope.venue_context === 'ALL' ? venue.pass === true : venue.pass_within_frozen_scope === true;
  const coverageReady = temporal.all_windows_ready === true && venueReady;
  const stabilityPass = coverageReady && temporal.pass === true && venuePass && opponents.pass === true
    && (seasons.cross_season_generalization_tested !== true || seasons.diagnostic_pass_if_testable === true);

  let state;
  if (!coverageReady) state = 'INSUFFICIENT_STABILITY_COVERAGE_RETAIN_OOS_PASS';
  else if (temporal.pass !== true) state = 'REJECTED_TEMPORAL_STABILITY';
  else if (!venuePass) state = 'REJECTED_VENUE_CONTEXT_STABILITY';
  else if (!opponents.pass) state = 'REJECTED_OPPONENT_DIVERSITY_STABILITY';
  else if (seasons.cross_season_generalization_tested === true && seasons.diagnostic_pass_if_testable !== true) state = 'REJECTED_CROSS_SEASON_DIRECTION_STABILITY';
  else state = 'VALIDATED_PATTERN_EVIDENCE_ZERO_WEIGHT';

  const payload = {
    pattern_id: step6Result.pattern_id,
    state,
    source_step6_state: step6Result.state,
    source_step6_result_fingerprint: step6Result.result_fingerprint,
    frozen_scope: plan.frozen_definition.scope,
    frozen_direction: plan.frozen_definition.direction,
    temporal_stability: temporal,
    context_stability: {
      venue,
      opponent_diversity: opponents,
      season: seasons
    },
    coverage_ready: coverageReady,
    stability_pass: stabilityPass,
    pattern_validated: stabilityPass,
    validation_scope: stabilityPass
      ? {
          league: plan.frozen_definition.scope.league,
          venue_context: plan.frozen_definition.scope.venue_context,
          cross_venue_generalized: venue.cross_venue_generalization_tested === true && venue.pass === true,
          cross_season_generalized: seasons.cross_season_generalization_tested === true && seasons.diagnostic_pass_if_testable === true
        }
      : null,
    decision_weight: 0,
    automatic_promotion: false,
    rejected_evidence_retained: !stabilityPass,
    new_significance_test_run: false,
    additional_alpha_spent: false
  };
  return deepFreeze({ ...payload, stability_result_fingerprint: sha256(payload) });
}

export function evaluatePatternTemporalContextStability({ freeze, discoveryBatch, step6Evaluation, corpus, evaluatedAt }) {
  verifyPatternConfirmatoryFreeze(freeze, { discoveryBatch });
  verifyPatternConfirmatoryEvaluation(step6Evaluation);
  verifyBehavioralStateFeatureCorpus(corpus);
  const evaluatedMs = parseTimestamp('STEP7_EVALUATED_AT', evaluatedAt);
  const step6Ms = parseTimestamp('STEP6_EVALUATED_AT', step6Evaluation.evaluated_at);
  if (evaluatedMs < step6Ms) throw new Error('STEP7_EVALUATION_BEFORE_STEP6_FORBIDDEN');
  if (step6Evaluation.source_corpus_fingerprint !== corpus.corpus_fingerprint) throw new Error('STEP7_CORPUS_MUST_EQUAL_STEP6_LOCKED_CORPUS');
  if (step6Evaluation.source_confirmatory_freeze_fingerprint !== freeze.confirmatory_freeze_fingerprint) throw new Error('STEP7_FREEZE_FINGERPRINT_MISMATCH');
  if (corpus.governance?.market_data_used !== false) throw new Error('STEP7_MARKET_DERIVED_BEHAVIORAL_TRUTH_FORBIDDEN');
  if (corpus.governance?.predictive_weight_assigned !== false) throw new Error('STEP7_PREDICTIVE_SOURCE_FORBIDDEN');

  const plans = new Map(freeze.confirmatory_plans.map(plan => [plan.pattern_id, plan]));
  const results = (step6Evaluation.candidate_results ?? []).map(step6Result => {
    const plan = plans.get(step6Result.pattern_id);
    if (!plan) throw new Error('STEP7_STEP6_RESULT_PLAN_NOT_FOUND');
    if (step6Evaluation.state !== PATTERN_CONFIRMATORY_OOS_TESTED_STATE) return waitingResult(step6Result, 'WAITING_FOR_STEP6_FAMILY_TEST');
    if (step6Result.out_of_sample_result === 'WAITING_FOR_CONFIRMATORY_MIN_N') return waitingResult(step6Result, 'WAITING_FOR_STEP6_OOS_RESULT');
    if (step6Result.out_of_sample_result === 'FAIL') return waitingResult(step6Result, 'NOT_ELIGIBLE_STEP6_OOS_REJECTED');
    if (step6Result.out_of_sample_result !== 'PASS') throw new Error('STEP7_UNKNOWN_STEP6_OUTCOME');
    return assessPassedResult(plan, step6Result, corpus);
  });

  const assessedN = results.filter(row => row.source_step6_state === 'OUT_OF_SAMPLE_CONFIRMED_PENDING_STABILITY').length;
  const validatedN = results.filter(row => row.pattern_validated === true).length;
  const payload = {
    stability_version: PATTERN_TEMPORAL_CONTEXT_STABILITY_VERSION,
    state: assessedN > 0 ? PATTERN_STABILITY_ASSESSED_STATE : PATTERN_STABILITY_WAITING_STATE,
    evaluated_at: evaluatedAt,
    source_step6_evaluation_fingerprint: step6Evaluation.evaluation_fingerprint,
    source_confirmatory_freeze_fingerprint: freeze.confirmatory_freeze_fingerprint,
    source_discovery_fingerprint: discoveryBatch.discovery_fingerprint,
    source_corpus_fingerprint: corpus.corpus_fingerprint,
    stability_protocol: {
      new_significance_test_run: false,
      additional_alpha_spent: false,
      exact_step6_corpus_required: true,
      temporal_method: 'THREE_DETERMINISTIC_CHRONOLOGICAL_SUBJECT_CLUSTER_WINDOWS',
      temporal_window_n: TEMPORAL_WINDOW_N,
      minimum_window_opportunity_n: STABILITY_MIN_WINDOW_OPPORTUNITY_N,
      minimum_window_cluster_n: STABILITY_MIN_WINDOW_CLUSTER_N,
      minimum_window_oriented_effect: STABILITY_MIN_WINDOW_ORIENTED_EFFECT,
      minimum_median_oriented_effect: STABILITY_MIN_MEDIAN_ORIENTED_EFFECT,
      maximum_temporal_oriented_effect_range: STABILITY_MAX_TEMPORAL_ORIENTED_EFFECT_RANGE,
      maximum_single_opponent_cluster_share: STABILITY_MAX_OPPONENT_CLUSTER_SHARE,
      minimum_unique_opponent_n: STABILITY_MIN_UNIQUE_OPPONENT_N,
      all_context_candidate_requires_home_and_away_check: true,
      scope_specific_candidate_cross_venue_generalization_forbidden: true,
      cross_season_generalization_requires_two_testable_seasons: true
    },
    pattern_results: results,
    summary: {
      step6_result_n: results.length,
      assessed_oos_pass_n: assessedN,
      validated_pattern_evidence_n: validatedN,
      zero_weight_n: results.filter(row => row.decision_weight === 0).length,
      rejected_or_insufficient_n: results.filter(row => row.pattern_validated !== true).length
    },
    governance: {
      real_canonical_step6_pass_required_for_real_validation: true,
      synthetic_unit_test_evidence_may_count_as_real_validation: false,
      pattern_validation_possible_only_after_real_step6_pass: true,
      predictive_weight_assigned: false,
      automatic_retuning: false,
      automatic_pattern_promotion: false,
      p002_changed: false,
      gate1_to_gate6_ownership_changed: false,
      market_data_used: false,
      capital_effect: 'NONE',
      real_money: 'NO'
    },
    next_stage: validatedN > 0
      ? 'STEP_8_PATTERN_PROMOTION_GOVERNANCE_AND_SHADOW_INTEGRATION'
      : 'RETAIN_EVIDENCE_AND_CONTINUE_GOVERNED_DATA_COLLECTION'
  };
  return deepFreeze({ ...payload, stability_fingerprint: sha256(payload) });
}

export function verifyPatternTemporalContextStability(evaluation) {
  if (!evaluation || evaluation.stability_version !== PATTERN_TEMPORAL_CONTEXT_STABILITY_VERSION) throw new Error('STEP7_STABILITY_VERSION_INVALID');
  const { stability_fingerprint, ...payload } = evaluation;
  if (!stability_fingerprint || sha256(payload) !== stability_fingerprint) throw new Error('STEP7_STABILITY_FINGERPRINT_INVALID');
  if (![PATTERN_STABILITY_WAITING_STATE, PATTERN_STABILITY_ASSESSED_STATE].includes(evaluation.state)) throw new Error('STEP7_STABILITY_STATE_INVALID');
  if (evaluation.stability_protocol?.new_significance_test_run !== false || evaluation.stability_protocol?.additional_alpha_spent !== false) throw new Error('STEP7_NEW_ALPHA_FORBIDDEN');
  if (evaluation.governance?.predictive_weight_assigned !== false || evaluation.governance?.automatic_pattern_promotion !== false) throw new Error('STEP7_PATTERN_INFLUENCE_FORBIDDEN');
  if (evaluation.governance?.p002_changed !== false || evaluation.governance?.market_data_used !== false) throw new Error('STEP7_GOVERNANCE_DRIFT');
  for (const result of evaluation.pattern_results ?? []) {
    const { stability_result_fingerprint, ...resultPayload } = result;
    if (!stability_result_fingerprint || sha256(resultPayload) !== stability_result_fingerprint) throw new Error('STEP7_RESULT_FINGERPRINT_INVALID');
    if (result.decision_weight !== 0) throw new Error('STEP7_DECISION_WEIGHT_FORBIDDEN');
    if (result.pattern_validated === true && result.state !== 'VALIDATED_PATTERN_EVIDENCE_ZERO_WEIGHT') throw new Error('STEP7_VALIDATED_STATE_MISMATCH');
  }
  return true;
}

export function patternStabilityEvidenceNode(result) {
  if (!result?.stability_result_fingerprint || !result?.pattern_id) throw new Error('STEP7_RESULT_REQUIRED');
  return Object.freeze({
    id: `EVIDENCE-STABILITY-${result.pattern_id}`,
    type: 'PATTERN_TEMPORAL_CONTEXT_STABILITY_RESULT',
    verified: false,
    sourceVerified: true,
    patternValidated: result.pattern_validated === true,
    temporalContextStable: result.stability_pass === true,
    decisionWeight: 0,
    critical: false,
    patternId: result.pattern_id,
    fingerprint: result.stability_result_fingerprint
  });
}
