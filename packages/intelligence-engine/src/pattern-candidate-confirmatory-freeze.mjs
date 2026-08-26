import { createHash } from 'node:crypto';
import { FROZEN_DISCOVERY_MIN_N } from './behavioral-state-features.mjs';
import {
  DISCOVERY_EFFECT_FLOOR,
  PATTERN_DISCOVERY_CANDIDATES_VERSION,
  verifyPatternDiscoveryBatch
} from './pattern-discovery-candidates.mjs';

export const PATTERN_CONFIRMATORY_FREEZE_VERSION = 'PATTERN_CANDIDATE_CONFIRMATORY_FREEZE_V0_1';
export const CONFIRMATORY_FREEZE_STATE = 'CONFIRMATORY_PLAN_FROZEN_WAITING_FOR_DISJOINT_EVIDENCE';
export const CONFIRMATORY_ALPHA = 0.05;
export const CONFIRMATORY_MULTIPLE_TESTING_METHOD = 'HOLM_BONFERRONI';
export const CONFIRMATORY_MIN_PRACTICAL_EFFECT = DISCOVERY_EFFECT_FLOOR;

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

function parseDate(name, value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name}_INVALID_DATE`);
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(ms)) throw new Error(`${name}_INVALID_DATE`);
  return ms;
}

function nextUtcDate(timestampMs) {
  const date = new Date(timestampMs);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function expectedDirection(candidate) {
  const effect = candidate?.effect_estimate?.difference;
  if (typeof effect !== 'number' || !Number.isFinite(effect) || effect === 0) throw new Error('STEP5_CANDIDATE_EFFECT_INVALID');
  const derived = effect > 0 ? 'HIGHER_THAN_REFERENCE' : 'LOWER_THAN_REFERENCE';
  if (candidate?.target_definition?.direction !== derived) throw new Error('STEP5_CANDIDATE_DIRECTION_EFFECT_MISMATCH');
  return derived;
}

function planPayload(candidate, discoveryBatch, frozenAt, confirmatoryStartDate, familySize) {
  if (candidate.pattern_version !== PATTERN_DISCOVERY_CANDIDATES_VERSION) throw new Error('STEP5_CANDIDATE_VERSION_INVALID');
  if (candidate.state !== 'CANDIDATE') throw new Error('STEP5_SOURCE_CANDIDATE_STATE_INVALID');
  const direction = expectedDirection(candidate);
  const forbiddenMatchIds = uniqueSorted([
    ...(candidate.source_lineage?.discovery_match_ids ?? []),
    ...(candidate.source_lineage?.reference_match_ids ?? [])
  ]);
  if (!forbiddenMatchIds.length) throw new Error('STEP5_DISCOVERY_LINEAGE_MATCH_IDS_REQUIRED');

  return {
    confirmatory_plan_version: PATTERN_CONFIRMATORY_FREEZE_VERSION,
    confirmatory_plan_id: `CONFIRMATORY-${candidate.pattern_id}`,
    state: CONFIRMATORY_FREEZE_STATE,
    pattern_id: candidate.pattern_id,
    pattern_version: candidate.pattern_version,
    candidate_fingerprint: candidate.candidate_fingerprint,
    source_discovery_fingerprint: discoveryBatch.discovery_fingerprint,
    frozen_at: frozenAt,
    confirmatory_start_date: confirmatoryStartDate,
    lifecycle: {
      current_pattern_state: 'CANDIDATE',
      state_advanced_by_step5: false,
      validation_complete: false,
      automatic_transition: false
    },
    frozen_definition: {
      hypothesis: candidate.hypothesis,
      pattern_class: candidate.pattern_class,
      target_definition: candidate.target_definition,
      feature_definition: candidate.feature_definition,
      scope: candidate.scope,
      discovery_training_cutoff: candidate.training_cutoff,
      discovery_effect_estimate: candidate.effect_estimate,
      discovery_uncertainty: candidate.uncertainty,
      discovery_baseline_comparison: candidate.baseline_comparison,
      direction
    },
    confirmatory_test_plan: {
      primary_estimand: 'PROPORTION_DIFFERENCE_SUBJECT_MINUS_DISJOINT_REFERENCE',
      success_definition: candidate.target_definition.success_definition,
      opportunity_definition: candidate.target_definition.opportunity_definition,
      direction,
      reference_definition: 'SAME_LEAGUE_SAME_VENUE_CONTEXT_OTHER_TEAMS_EXCLUDING_MATCHES_INVOLVING_SUBJECT',
      minimum_practical_effect_absolute: CONFIRMATORY_MIN_PRACTICAL_EFFECT,
      subject_match_n_min: FROZEN_DISCOVERY_MIN_N,
      subject_metric_opportunity_n_min: FROZEN_DISCOVERY_MIN_N,
      reference_metric_opportunity_n_min: FROZEN_DISCOVERY_MIN_N,
      familywise_alpha: CONFIRMATORY_ALPHA,
      multiple_testing_method: CONFIRMATORY_MULTIPLE_TESTING_METHOD,
      multiple_testing_family_size: familySize,
      raw_p_value_order: 'ASCENDING_WITH_PATTERN_ID_TIEBREAK',
      significance_test_status: 'NOT_RUN_STEP_5',
      correction_status: 'NOT_RUN_STEP_5'
    },
    evidence_boundary: {
      confirmatory_match_date_gte: confirmatoryStartDate,
      discovery_and_reference_match_ids_forbidden: forbiddenMatchIds,
      forbidden_match_n: forbiddenMatchIds.length,
      discovery_match_reuse_allowed: false,
      same_league_required: true,
      same_venue_context_required: true,
      direct_subject_match_counterpart_may_enter_reference: false,
      step3_descriptive_source_required: true,
      step3_predictive_weight_required: 0,
      market_data_used_as_behavioral_truth: false,
      bookmaker_data_used_as_behavioral_truth: false
    },
    results: {
      out_of_sample_result: 'NOT_RUN_STEP_5',
      forward_result: 'NOT_RUN_STEP_5',
      temporal_stability: 'NOT_TESTED_STEP_5'
    },
    evidence_graph_bridge: {
      node_id: `EVIDENCE-CONFIRMATORY-${candidate.pattern_id}`,
      source_verified: true,
      plan_frozen: true,
      pattern_validated: false,
      decision_weight: 0,
      decision_eligible: false
    },
    governed_learning_bridge: {
      auto_apply: false,
      production_mutation_allowed: false,
      decision_weight_change: 'NO_CHANGE'
    },
    governance: {
      pattern_validation_performed: false,
      predictive_weight: 0,
      automatic_retuning: false,
      automatic_pattern_promotion: false,
      p002_changed: false,
      gate1_to_gate6_ownership_changed: false,
      market_data_used: false,
      capital_effect: 'NONE',
      real_money: 'NO'
    }
  };
}

export function freezePatternCandidateBatch({ discoveryBatch, frozenAt }) {
  verifyPatternDiscoveryBatch(discoveryBatch);
  const frozenMs = parseTimestamp('STEP5_FROZEN_AT', frozenAt);
  const discoveredMs = parseTimestamp('STEP4_DISCOVERED_AT', discoveryBatch.discovered_at);
  if (frozenMs <= discoveredMs) throw new Error('STEP5_FREEZE_MUST_FOLLOW_DISCOVERY');
  if (discoveryBatch.candidate_n !== (discoveryBatch.candidates ?? []).length) throw new Error('STEP5_STEP4_CANDIDATE_COUNT_MISMATCH');
  if (discoveryBatch.candidate_n < 1) throw new Error('STEP5_NO_CANDIDATES_TO_FREEZE');

  const sortedCandidates = [...discoveryBatch.candidates].sort((a, b) => a.pattern_id.localeCompare(b.pattern_id));
  const confirmatoryStartDate = nextUtcDate(frozenMs);
  const frozenCandidates = sortedCandidates.map(candidate => {
    const payload = planPayload(candidate, discoveryBatch, frozenAt, confirmatoryStartDate, sortedCandidates.length);
    return deepFreeze({ ...payload, confirmatory_plan_fingerprint: sha256(payload) });
  });

  const payload = {
    freeze_version: PATTERN_CONFIRMATORY_FREEZE_VERSION,
    state: CONFIRMATORY_FREEZE_STATE,
    frozen_at: frozenAt,
    confirmatory_start_date: confirmatoryStartDate,
    source_discovery_version: discoveryBatch.discovery_version,
    source_discovery_fingerprint: discoveryBatch.discovery_fingerprint,
    source_discovered_at: discoveryBatch.discovered_at,
    source_training_cutoff: discoveryBatch.training_cutoff,
    source_candidate_n: discoveryBatch.candidate_n,
    selection_policy: {
      rule: 'FREEZE_ALL_STEP4_CANDIDATES_NO_MANUAL_SUBSET',
      manual_subset_allowed: false,
      post_discovery_cherry_picking_allowed: false,
      deterministic_order: 'PATTERN_ID_ASC',
      source_candidate_fingerprints: sortedCandidates.map(candidate => candidate.candidate_fingerprint),
      frozen_candidate_fingerprints: frozenCandidates.map(plan => plan.candidate_fingerprint)
    },
    multiple_testing_control: {
      family_definition: 'ALL_STEP4_CANDIDATES_IN_FROZEN_DISCOVERY_BATCH',
      exploratory_comparison_n: discoveryBatch.multiple_testing_ledger?.exploratory_comparison_n ?? null,
      frozen_hypothesis_n: frozenCandidates.length,
      familywise_alpha: CONFIRMATORY_ALPHA,
      method: CONFIRMATORY_MULTIPLE_TESTING_METHOD,
      confirmatory_alpha_spent: false,
      significance_test_run: false,
      correction_run: false
    },
    confirmatory_plans: frozenCandidates,
    governance: {
      pattern_discovery_rewritten: false,
      pattern_validation_performed: false,
      predictive_weight_assigned: false,
      automatic_retuning: false,
      automatic_pattern_promotion: false,
      p002_discovery_min_n: FROZEN_DISCOVERY_MIN_N,
      p002_independent_validation_min_n: FROZEN_DISCOVERY_MIN_N,
      p002_changed: false,
      gate1_to_gate6_ownership_changed: false,
      market_data_used: false,
      capital_effect: 'NONE',
      real_money: 'NO'
    },
    next_stage: 'STEP_6_PATTERN_CONFIRMATORY_OUT_OF_SAMPLE_EVALUATION'
  };
  return deepFreeze({ ...payload, confirmatory_freeze_fingerprint: sha256(payload) });
}

function verifyConfirmatoryPlan(plan, candidate, freeze) {
  const { confirmatory_plan_fingerprint, ...payload } = plan;
  if (!confirmatory_plan_fingerprint || sha256(payload) !== confirmatory_plan_fingerprint) throw new Error('STEP5_CONFIRMATORY_PLAN_FINGERPRINT_INVALID');
  if (plan.confirmatory_plan_version !== PATTERN_CONFIRMATORY_FREEZE_VERSION) throw new Error('STEP5_CONFIRMATORY_PLAN_VERSION_INVALID');
  if (plan.state !== CONFIRMATORY_FREEZE_STATE) throw new Error('STEP5_CONFIRMATORY_PLAN_STATE_INVALID');
  if (plan.pattern_id !== candidate.pattern_id || plan.candidate_fingerprint !== candidate.candidate_fingerprint) throw new Error('STEP5_CONFIRMATORY_PLAN_CANDIDATE_MISMATCH');
  if (plan.source_discovery_fingerprint !== freeze.source_discovery_fingerprint) throw new Error('STEP5_CONFIRMATORY_PLAN_DISCOVERY_MISMATCH');
  if (plan.confirmatory_start_date !== freeze.confirmatory_start_date) throw new Error('STEP5_CONFIRMATORY_START_DATE_DRIFT');
  if (plan.lifecycle?.current_pattern_state !== 'CANDIDATE' || plan.lifecycle?.state_advanced_by_step5 !== false) throw new Error('STEP5_PATTERN_LIFECYCLE_ADVANCE_FORBIDDEN');
  if (plan.frozen_definition?.hypothesis !== candidate.hypothesis) throw new Error('STEP5_HYPOTHESIS_DRIFT');
  if (stableStringify(plan.frozen_definition?.target_definition) !== stableStringify(candidate.target_definition)) throw new Error('STEP5_TARGET_DEFINITION_DRIFT');
  if (stableStringify(plan.frozen_definition?.feature_definition) !== stableStringify(candidate.feature_definition)) throw new Error('STEP5_FEATURE_DEFINITION_DRIFT');
  if (stableStringify(plan.frozen_definition?.scope) !== stableStringify(candidate.scope)) throw new Error('STEP5_SCOPE_DRIFT');
  if (plan.frozen_definition?.direction !== expectedDirection(candidate)) throw new Error('STEP5_DIRECTION_DRIFT');
  if (plan.confirmatory_test_plan?.minimum_practical_effect_absolute !== CONFIRMATORY_MIN_PRACTICAL_EFFECT) throw new Error('STEP5_PRACTICAL_EFFECT_DRIFT');
  if (plan.confirmatory_test_plan?.subject_match_n_min !== FROZEN_DISCOVERY_MIN_N) throw new Error('STEP5_SUBJECT_MATCH_MIN_N_DRIFT');
  if (plan.confirmatory_test_plan?.subject_metric_opportunity_n_min !== FROZEN_DISCOVERY_MIN_N) throw new Error('STEP5_SUBJECT_OPPORTUNITY_MIN_N_DRIFT');
  if (plan.confirmatory_test_plan?.reference_metric_opportunity_n_min !== FROZEN_DISCOVERY_MIN_N) throw new Error('STEP5_REFERENCE_OPPORTUNITY_MIN_N_DRIFT');
  if (plan.confirmatory_test_plan?.familywise_alpha !== CONFIRMATORY_ALPHA) throw new Error('STEP5_CONFIRMATORY_ALPHA_DRIFT');
  if (plan.confirmatory_test_plan?.multiple_testing_method !== CONFIRMATORY_MULTIPLE_TESTING_METHOD) throw new Error('STEP5_MULTIPLE_TESTING_METHOD_DRIFT');
  if (plan.confirmatory_test_plan?.multiple_testing_family_size !== freeze.source_candidate_n) throw new Error('STEP5_MULTIPLE_TESTING_FAMILY_SIZE_DRIFT');
  if (plan.confirmatory_test_plan?.significance_test_status !== 'NOT_RUN_STEP_5' || plan.confirmatory_test_plan?.correction_status !== 'NOT_RUN_STEP_5') throw new Error('STEP5_CONFIRMATORY_TEST_EXECUTION_FORBIDDEN');
  if (plan.results?.out_of_sample_result !== 'NOT_RUN_STEP_5' || plan.results?.forward_result !== 'NOT_RUN_STEP_5' || plan.results?.temporal_stability !== 'NOT_TESTED_STEP_5') throw new Error('STEP5_RESULT_FABRICATION_FORBIDDEN');
  if (plan.governance?.pattern_validation_performed !== false || plan.governance?.predictive_weight !== 0) throw new Error('STEP5_PATTERN_INFLUENCE_FORBIDDEN');

  const expectedForbidden = uniqueSorted([
    ...(candidate.source_lineage?.discovery_match_ids ?? []),
    ...(candidate.source_lineage?.reference_match_ids ?? [])
  ]);
  if (stableStringify(plan.evidence_boundary?.discovery_and_reference_match_ids_forbidden) !== stableStringify(expectedForbidden)) throw new Error('STEP5_FORBIDDEN_MATCH_SET_DRIFT');
  return true;
}

export function verifyPatternConfirmatoryFreeze(freeze, { discoveryBatch }) {
  verifyPatternDiscoveryBatch(discoveryBatch);
  if (!freeze || freeze.freeze_version !== PATTERN_CONFIRMATORY_FREEZE_VERSION) throw new Error('STEP5_CONFIRMATORY_FREEZE_VERSION_INVALID');
  if (freeze.state !== CONFIRMATORY_FREEZE_STATE) throw new Error('STEP5_CONFIRMATORY_FREEZE_STATE_INVALID');
  if (freeze.source_discovery_fingerprint !== discoveryBatch.discovery_fingerprint) throw new Error('STEP5_SOURCE_DISCOVERY_FINGERPRINT_MISMATCH');
  if (freeze.source_candidate_n !== discoveryBatch.candidate_n || freeze.confirmatory_plans?.length !== discoveryBatch.candidate_n) throw new Error('STEP5_ALL_CANDIDATES_NOT_FROZEN');
  if (freeze.selection_policy?.manual_subset_allowed !== false || freeze.selection_policy?.post_discovery_cherry_picking_allowed !== false) throw new Error('STEP5_CANDIDATE_SUBSET_SELECTION_FORBIDDEN');

  const frozenMs = parseTimestamp('STEP5_FROZEN_AT', freeze.frozen_at);
  const discoveredMs = parseTimestamp('STEP4_DISCOVERED_AT', discoveryBatch.discovered_at);
  if (frozenMs <= discoveredMs) throw new Error('STEP5_FREEZE_MUST_FOLLOW_DISCOVERY');
  if (freeze.confirmatory_start_date !== nextUtcDate(frozenMs)) throw new Error('STEP5_CONFIRMATORY_START_DATE_INVALID');

  const sortedCandidates = [...discoveryBatch.candidates].sort((a, b) => a.pattern_id.localeCompare(b.pattern_id));
  const expectedFingerprints = sortedCandidates.map(candidate => candidate.candidate_fingerprint);
  if (stableStringify(freeze.selection_policy?.source_candidate_fingerprints) !== stableStringify(expectedFingerprints)) throw new Error('STEP5_SOURCE_CANDIDATE_SET_DRIFT');
  if (stableStringify(freeze.selection_policy?.frozen_candidate_fingerprints) !== stableStringify(expectedFingerprints)) throw new Error('STEP5_FROZEN_CANDIDATE_SET_DRIFT');

  for (let index = 0; index < sortedCandidates.length; index += 1) {
    verifyConfirmatoryPlan(freeze.confirmatory_plans[index], sortedCandidates[index], freeze);
  }

  if (freeze.multiple_testing_control?.frozen_hypothesis_n !== sortedCandidates.length) throw new Error('STEP5_FROZEN_HYPOTHESIS_N_DRIFT');
  if (freeze.multiple_testing_control?.familywise_alpha !== CONFIRMATORY_ALPHA || freeze.multiple_testing_control?.method !== CONFIRMATORY_MULTIPLE_TESTING_METHOD) throw new Error('STEP5_MULTIPLE_TESTING_CONTROL_DRIFT');
  if (freeze.multiple_testing_control?.confirmatory_alpha_spent !== false || freeze.multiple_testing_control?.significance_test_run !== false || freeze.multiple_testing_control?.correction_run !== false) throw new Error('STEP5_CONFIRMATORY_EXECUTION_FORBIDDEN');
  if (freeze.governance?.pattern_validation_performed !== false || freeze.governance?.predictive_weight_assigned !== false || freeze.governance?.p002_changed !== false) throw new Error('STEP5_GOVERNANCE_BOUNDARY_VIOLATION');

  const { confirmatory_freeze_fingerprint, ...payload } = freeze;
  if (!confirmatory_freeze_fingerprint || sha256(payload) !== confirmatory_freeze_fingerprint) throw new Error('STEP5_CONFIRMATORY_FREEZE_FINGERPRINT_INVALID');
  return true;
}

export function patternConfirmatoryPlanEvidenceNode(plan) {
  if (!plan || plan.confirmatory_plan_version !== PATTERN_CONFIRMATORY_FREEZE_VERSION) throw new Error('STEP5_CONFIRMATORY_PLAN_VERSION_INVALID');
  return Object.freeze({
    id: plan.evidence_graph_bridge.node_id,
    type: 'PATTERN_CONFIRMATORY_PLAN_FREEZE',
    verified: false,
    sourceVerified: plan.evidence_graph_bridge.source_verified === true,
    planFrozen: plan.evidence_graph_bridge.plan_frozen === true,
    patternValidated: false,
    decisionWeight: 0,
    critical: false,
    patternId: plan.pattern_id,
    fingerprint: plan.confirmatory_plan_fingerprint
  });
}

export function classifyConfirmatoryObservation({ plan, observation }) {
  if (!plan || plan.confirmatory_plan_version !== PATTERN_CONFIRMATORY_FREEZE_VERSION) throw new Error('STEP5_CONFIRMATORY_PLAN_REQUIRED');
  if (!observation || typeof observation !== 'object') throw new Error('STEP5_CONFIRMATORY_OBSERVATION_REQUIRED');
  const reasons = [];
  const matchId = String(observation.canonical_match_id ?? '');
  if (!matchId) reasons.push('MATCH_ID_REQUIRED');
  let matchDateMs = null;
  try { matchDateMs = parseDate('CONFIRMATORY_MATCH_DATE', observation.canonical_match_date); } catch { reasons.push('MATCH_DATE_INVALID'); }
  const startMs = parseDate('CONFIRMATORY_START_DATE', plan.confirmatory_start_date);
  if (matchDateMs !== null && matchDateMs < startMs) reasons.push('PRE_FREEZE_DATE_EVIDENCE_FORBIDDEN');
  if ((plan.evidence_boundary?.discovery_and_reference_match_ids_forbidden ?? []).includes(matchId)) reasons.push('DISCOVERY_MATCH_REUSE_FORBIDDEN');
  if (observation.league !== plan.frozen_definition?.scope?.league) reasons.push('LEAGUE_SCOPE_MISMATCH');
  const context = plan.frozen_definition?.scope?.venue_context;
  if (context !== 'ALL' && observation.venue_side !== context) reasons.push('VENUE_CONTEXT_MISMATCH');
  if (observation.descriptive_only !== true || observation.predictive_weight !== 0) reasons.push('STEP3_DESCRIPTIVE_BOUNDARY_REQUIRED');

  const subjectTeam = plan.frozen_definition?.scope?.subject_team;
  let role = 'REFERENCE';
  if (observation.subject_team === subjectTeam) role = 'SUBJECT';
  else if (observation.opponent_team === subjectTeam) {
    role = 'EXCLUDED_DIRECT_SUBJECT_MATCH_COUNTERPART';
    reasons.push('DIRECT_SUBJECT_MATCH_COUNTERPART_REFERENCE_FORBIDDEN');
  }

  return deepFreeze({
    eligible: reasons.length === 0,
    role,
    reasons,
    pattern_id: plan.pattern_id,
    canonical_match_id: matchId || null,
    confirmatory_start_date: plan.confirmatory_start_date,
    statistical_test_performed: false,
    decision_weight: 0
  });
}
