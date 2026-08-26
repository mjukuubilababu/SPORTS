import { createHash } from 'node:crypto';
import { FROZEN_DISCOVERY_MIN_N, verifyBehavioralStateFeatureCorpus } from './behavioral-state-features.mjs';
import {
  CONFIRMATORY_ALPHA,
  CONFIRMATORY_MIN_PRACTICAL_EFFECT,
  CONFIRMATORY_MULTIPLE_TESTING_METHOD,
  classifyConfirmatoryObservation,
  verifyPatternConfirmatoryFreeze
} from './pattern-candidate-confirmatory-freeze.mjs';

export const PATTERN_CONFIRMATORY_OOS_VERSION = 'PATTERN_CONFIRMATORY_OUT_OF_SAMPLE_EVALUATION_V0_1';
export const PATTERN_CONFIRMATORY_OOS_WAITING_STATE = 'WAITING_FOR_ALL_FROZEN_HYPOTHESES_MIN_N';
export const PATTERN_CONFIRMATORY_OOS_TESTED_STATE = 'CONFIRMATORY_OOS_FAMILY_TESTED';
export const PATTERN_CONFIRMATORY_RAW_TEST = 'ONE_SIDED_MATCH_CLUSTER_ROBUST_SCORE_CR1_NORMAL';
export const PATTERN_CONFIRMATORY_MIN_CLUSTER_N = 30;

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
    default: throw new Error('STEP6_UNKNOWN_OPPORTUNITY_DEFINITION');
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
    default: throw new Error('STEP6_UNKNOWN_SUCCESS_DEFINITION');
  }
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function groupCounts(rows, plan) {
  const opportunityDefinition = plan.confirmatory_test_plan.opportunity_definition;
  const successDefinition = plan.confirmatory_test_plan.success_definition;
  const opportunityRows = rows.filter(row => opportunityPredicate(opportunityDefinition, row));
  const successN = opportunityRows.filter(row => successPredicate(successDefinition, row)).length;
  const byMatch = new Map();
  for (const row of opportunityRows) {
    const id = row.canonical_match_id;
    const current = byMatch.get(id) ?? { match_id: id, opportunity_n: 0, success_n: 0 };
    current.opportunity_n += 1;
    if (successPredicate(successDefinition, row)) current.success_n += 1;
    byMatch.set(id, current);
  }
  return {
    match_n: uniqueSorted(rows.map(row => row.canonical_match_id)).length,
    opportunity_n: opportunityRows.length,
    success_n: successN,
    rate: opportunityRows.length ? successN / opportunityRows.length : null,
    cluster_n: byMatch.size,
    clusters: [...byMatch.values()].sort((a, b) => a.match_id.localeCompare(b.match_id)),
    match_ids: uniqueSorted(rows.map(row => row.canonical_match_id)),
    opportunity_match_ids: uniqueSorted(opportunityRows.map(row => row.canonical_match_id)),
    observation_fingerprints: opportunityRows.map(row => row.observation_fingerprint).sort()
  };
}

function cr1Variance(clusters, rate, totalOpportunityN, centreRate = rate) {
  const clusterN = clusters.length;
  if (!Number.isFinite(rate) || !Number.isFinite(centreRate) || totalOpportunityN <= 0 || clusterN <= 1) return null;
  let sumSq = 0;
  for (const cluster of clusters) {
    const residual = cluster.success_n - centreRate * cluster.opportunity_n;
    sumSq += residual * residual;
  }
  return (clusterN / (clusterN - 1)) * sumSq / (totalOpportunityN * totalOpportunityN);
}

function evaluatePlanEvidence(plan, corpus) {
  const subjectRows = [];
  const referenceRows = [];
  const exclusionCounts = {};

  for (const observation of corpus.observations ?? []) {
    const classification = classifyConfirmatoryObservation({ plan, observation });
    if (classification.eligible === true && classification.role === 'SUBJECT') subjectRows.push(observation);
    else if (classification.eligible === true && classification.role === 'REFERENCE') referenceRows.push(observation);
    else {
      for (const reason of classification.reasons ?? []) exclusionCounts[reason] = (exclusionCounts[reason] ?? 0) + 1;
    }
  }

  const subject = groupCounts(subjectRows, plan);
  const reference = groupCounts(referenceRows, plan);
  const required = plan.confirmatory_test_plan;
  const gates = {
    subject_match_n: subject.match_n >= required.subject_match_n_min,
    subject_opportunity_n: subject.opportunity_n >= required.subject_metric_opportunity_n_min,
    reference_opportunity_n: reference.opportunity_n >= required.reference_metric_opportunity_n_min,
    subject_cluster_n: subject.cluster_n >= PATTERN_CONFIRMATORY_MIN_CLUSTER_N,
    reference_cluster_n: reference.cluster_n >= PATTERN_CONFIRMATORY_MIN_CLUSTER_N
  };
  const ready = Object.values(gates).every(Boolean);
  return {
    pattern_id: plan.pattern_id,
    candidate_fingerprint: plan.candidate_fingerprint,
    confirmatory_plan_fingerprint: plan.confirmatory_plan_fingerprint,
    expected_direction: plan.frozen_definition.direction,
    subject,
    reference,
    exclusion_counts: Object.fromEntries(Object.entries(exclusionCounts).sort(([a], [b]) => a.localeCompare(b))),
    readiness_gates: gates,
    ready_for_family_test: ready
  };
}

function scoreTest(evidence) {
  const subject = evidence.subject;
  const reference = evidence.reference;
  const effect = subject.rate - reference.rate;
  const pooledRate = (subject.success_n + reference.success_n) / (subject.opportunity_n + reference.opportunity_n);
  const subjectNullVar = cr1Variance(subject.clusters, subject.rate, subject.opportunity_n, pooledRate);
  const referenceNullVar = cr1Variance(reference.clusters, reference.rate, reference.opportunity_n, pooledRate);
  if (subjectNullVar === null || referenceNullVar === null) throw new Error('STEP6_CLUSTER_VARIANCE_UNAVAILABLE');
  const nullVariance = subjectNullVar + referenceNullVar;
  if (!(nullVariance > 0)) throw new Error('STEP6_CLUSTER_NULL_VARIANCE_DEGENERATE');
  const nullSe = Math.sqrt(nullVariance);
  const orientation = evidence.expected_direction === 'HIGHER_THAN_REFERENCE' ? 1 : -1;
  const orientedEffect = orientation * effect;
  const z = orientedEffect / nullSe;
  const rawP = clamp01(1 - normalCdf(z));

  const subjectEstimateVar = cr1Variance(subject.clusters, subject.rate, subject.opportunity_n);
  const referenceEstimateVar = cr1Variance(reference.clusters, reference.rate, reference.opportunity_n);
  const estimateVariance = (subjectEstimateVar ?? 0) + (referenceEstimateVar ?? 0);
  const estimateSe = Math.sqrt(Math.max(0, estimateVariance));
  const z95 = 1.959963984540054;
  const ci = {
    method: 'MATCH_CLUSTER_ROBUST_CR1_NORMAL_95',
    low: effect - z95 * estimateSe,
    high: effect + z95 * estimateSe
  };

  return {
    effect,
    effect_pp: effect * 100,
    oriented_effect: orientedEffect,
    direction_replicated: orientedEffect > 0,
    minimum_practical_effect_met: orientedEffect >= CONFIRMATORY_MIN_PRACTICAL_EFFECT,
    pooled_null_rate: pooledRate,
    raw_test_method: PATTERN_CONFIRMATORY_RAW_TEST,
    cluster_robust_null_se: nullSe,
    z_statistic: z,
    raw_one_sided_p_value: rawP,
    effect_confidence_interval: ci
  };
}

export function holmBonferroni(rows, alpha = CONFIRMATORY_ALPHA) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const sorted = [...rows].sort((a, b) => {
    const diff = a.raw_one_sided_p_value - b.raw_one_sided_p_value;
    return diff !== 0 ? diff : a.pattern_id.localeCompare(b.pattern_id);
  });
  let runningAdjusted = 0;
  let stillRejecting = true;
  const byPattern = new Map();
  const m = sorted.length;
  sorted.forEach((row, index) => {
    const multiplier = m - index;
    const threshold = alpha / multiplier;
    const adjusted = clamp01(Math.max(runningAdjusted, row.raw_one_sided_p_value * multiplier));
    runningAdjusted = adjusted;
    const reject = stillRejecting && row.raw_one_sided_p_value <= threshold;
    if (!reject) stillRejecting = false;
    byPattern.set(row.pattern_id, {
      holm_rank: index + 1,
      holm_threshold: threshold,
      holm_adjusted_p_value: adjusted,
      holm_reject_null: reject
    });
  });
  return rows.map(row => ({ ...row, ...byPattern.get(row.pattern_id) }));
}

function waitingCandidateResult(evidence) {
  return {
    pattern_id: evidence.pattern_id,
    state: 'WAITING_FOR_CONFIRMATORY_MIN_N',
    candidate_state_after_step6: 'CANDIDATE',
    ready_for_family_test: false,
    subject: evidence.subject,
    reference: evidence.reference,
    readiness_gates: evidence.readiness_gates,
    exclusion_counts: evidence.exclusion_counts,
    raw_test_method: PATTERN_CONFIRMATORY_RAW_TEST,
    raw_one_sided_p_value: null,
    holm_adjusted_p_value: null,
    holm_reject_null: false,
    practical_effect_gate: 'NOT_EVALUATED',
    out_of_sample_result: 'WAITING_FOR_CONFIRMATORY_MIN_N',
    decision_weight: 0,
    pattern_validated: false
  };
}

function testedCandidateResult(evidence, corrected) {
  const pass = corrected.holm_reject_null === true && corrected.minimum_practical_effect_met === true && corrected.direction_replicated === true;
  let state;
  if (pass) state = 'OUT_OF_SAMPLE_CONFIRMED_PENDING_STABILITY';
  else if (!corrected.direction_replicated) state = 'REJECTED_OOS_DIRECTION_NOT_REPLICATED';
  else if (!corrected.minimum_practical_effect_met) state = 'REJECTED_OOS_PRACTICAL_EFFECT_NOT_MET';
  else state = 'REJECTED_OOS_HOLM_SIGNIFICANCE_NOT_MET';
  return {
    pattern_id: evidence.pattern_id,
    state,
    candidate_state_after_step6: state,
    ready_for_family_test: true,
    subject: evidence.subject,
    reference: evidence.reference,
    readiness_gates: evidence.readiness_gates,
    exclusion_counts: evidence.exclusion_counts,
    effect_estimate: {
      difference: corrected.effect,
      difference_pp: corrected.effect_pp,
      oriented_difference: corrected.oriented_effect,
      direction_replicated: corrected.direction_replicated,
      minimum_practical_effect_absolute: CONFIRMATORY_MIN_PRACTICAL_EFFECT,
      minimum_practical_effect_met: corrected.minimum_practical_effect_met
    },
    uncertainty: corrected.effect_confidence_interval,
    significance: {
      raw_test_method: corrected.raw_test_method,
      cluster_robust_null_se: corrected.cluster_robust_null_se,
      z_statistic: corrected.z_statistic,
      raw_one_sided_p_value: corrected.raw_one_sided_p_value,
      holm_rank: corrected.holm_rank,
      holm_threshold: corrected.holm_threshold,
      holm_adjusted_p_value: corrected.holm_adjusted_p_value,
      holm_reject_null: corrected.holm_reject_null
    },
    practical_effect_gate: corrected.minimum_practical_effect_met ? 'PASS' : 'FAIL',
    out_of_sample_result: pass ? 'PASS' : 'FAIL',
    rejected_evidence_retained: !pass,
    decision_weight: 0,
    pattern_validated: false
  };
}

export function evaluatePatternConfirmatoryOutOfSample({ freeze, discoveryBatch, corpus, evaluatedAt, priorEvaluation = null }) {
  verifyPatternConfirmatoryFreeze(freeze, { discoveryBatch });
  verifyBehavioralStateFeatureCorpus(corpus);
  const evaluatedMs = parseTimestamp('STEP6_EVALUATED_AT', evaluatedAt);
  const materializedMs = parseTimestamp('STEP6_CORPUS_MATERIALIZED_AT', corpus.materialized_at);
  const frozenMs = parseTimestamp('STEP5_FROZEN_AT', freeze.frozen_at);
  if (evaluatedMs < materializedMs) throw new Error('STEP6_EVALUATION_BEFORE_CORPUS_MATERIALIZATION_FORBIDDEN');
  if (evaluatedMs <= frozenMs) throw new Error('STEP6_EVALUATION_MUST_FOLLOW_FREEZE');
  if (corpus.governance?.market_data_used !== false) throw new Error('STEP6_MARKET_DERIVED_BEHAVIORAL_TRUTH_FORBIDDEN');
  if (corpus.governance?.predictive_weight_assigned !== false) throw new Error('STEP6_PREDICTIVE_SOURCE_FORBIDDEN');
  if (corpus.governance?.p002_discovery_min_n !== FROZEN_DISCOVERY_MIN_N) throw new Error('STEP6_P002_DISCOVERY_MIN_N_DRIFT');

  if (priorEvaluation) {
    verifyPatternConfirmatoryEvaluation(priorEvaluation);
    if (priorEvaluation.state === PATTERN_CONFIRMATORY_OOS_TESTED_STATE) {
      if (priorEvaluation.source_corpus_fingerprint !== corpus.corpus_fingerprint || priorEvaluation.evaluated_at !== evaluatedAt) {
        throw new Error('STEP6_CONFIRMATORY_RETEST_AFTER_ALPHA_SPEND_FORBIDDEN');
      }
      return priorEvaluation;
    }
  }

  const planEvidence = freeze.confirmatory_plans.map(plan => evaluatePlanEvidence(plan, corpus));
  const familyReady = planEvidence.every(row => row.ready_for_family_test === true);
  let candidateResults;
  let alphaSpent = false;
  let testRun = false;

  if (!familyReady) {
    candidateResults = planEvidence.map(waitingCandidateResult);
  } else {
    const raw = planEvidence.map(evidence => ({ pattern_id: evidence.pattern_id, ...scoreTest(evidence) }));
    const corrected = holmBonferroni(raw, CONFIRMATORY_ALPHA);
    const correctedMap = new Map(corrected.map(row => [row.pattern_id, row]));
    candidateResults = planEvidence.map(evidence => testedCandidateResult(evidence, correctedMap.get(evidence.pattern_id)));
    alphaSpent = true;
    testRun = true;
  }

  candidateResults = candidateResults.map(result => {
    const payload = { ...result };
    return deepFreeze({ ...payload, result_fingerprint: sha256(payload) });
  });

  const state = familyReady ? PATTERN_CONFIRMATORY_OOS_TESTED_STATE : PATTERN_CONFIRMATORY_OOS_WAITING_STATE;
  const payload = {
    evaluation_version: PATTERN_CONFIRMATORY_OOS_VERSION,
    state,
    evaluated_at: evaluatedAt,
    source_confirmatory_freeze_fingerprint: freeze.confirmatory_freeze_fingerprint,
    source_discovery_fingerprint: discoveryBatch.discovery_fingerprint,
    source_corpus_version: corpus.corpus_version,
    source_corpus_fingerprint: corpus.corpus_fingerprint,
    family_hypothesis_n: freeze.confirmatory_plans.length,
    family_ready_for_test: familyReady,
    statistical_protocol: {
      primary_estimand: 'PROPORTION_DIFFERENCE_SUBJECT_MINUS_DISJOINT_REFERENCE',
      raw_test_method: PATTERN_CONFIRMATORY_RAW_TEST,
      cluster_unit: 'CANONICAL_MATCH_ID',
      minimum_subject_cluster_n: PATTERN_CONFIRMATORY_MIN_CLUSTER_N,
      minimum_reference_cluster_n: PATTERN_CONFIRMATORY_MIN_CLUSTER_N,
      familywise_alpha: CONFIRMATORY_ALPHA,
      multiple_testing_method: CONFIRMATORY_MULTIPLE_TESTING_METHOD,
      minimum_practical_effect_absolute: CONFIRMATORY_MIN_PRACTICAL_EFFECT,
      all_frozen_hypotheses_must_be_ready_before_alpha_spend: true,
      repeated_retesting_after_alpha_spend_allowed: false
    },
    multiple_testing: {
      family_definition: 'ALL_STEP4_CANDIDATES_IN_FROZEN_STEP5_BATCH',
      significance_test_run: testRun,
      correction_run: testRun,
      confirmatory_alpha_spent: alphaSpent
    },
    candidate_results: candidateResults,
    summary: {
      waiting_n: candidateResults.filter(row => row.out_of_sample_result === 'WAITING_FOR_CONFIRMATORY_MIN_N').length,
      pass_n: candidateResults.filter(row => row.out_of_sample_result === 'PASS').length,
      fail_n: candidateResults.filter(row => row.out_of_sample_result === 'FAIL').length,
      retained_rejected_n: candidateResults.filter(row => row.rejected_evidence_retained === true).length
    },
    governance: {
      real_canonical_evidence_required_for_real_result: true,
      synthetic_test_evidence_may_count_as_real_confirmation: false,
      pattern_validation_performed: false,
      predictive_weight_assigned: false,
      automatic_retuning: false,
      automatic_pattern_promotion: false,
      p002_changed: false,
      gate1_to_gate6_ownership_changed: false,
      market_data_used: false,
      capital_effect: 'NONE',
      real_money: 'NO'
    },
    next_stage: familyReady ? 'STEP_7_PATTERN_TEMPORAL_AND_CONTEXT_STABILITY' : 'WAIT_FOR_DISJOINT_CONFIRMATORY_EVIDENCE'
  };
  return deepFreeze({ ...payload, evaluation_fingerprint: sha256(payload) });
}

export function verifyPatternConfirmatoryEvaluation(evaluation) {
  if (!evaluation || evaluation.evaluation_version !== PATTERN_CONFIRMATORY_OOS_VERSION) throw new Error('STEP6_EVALUATION_VERSION_INVALID');
  const { evaluation_fingerprint, ...payload } = evaluation;
  if (!evaluation_fingerprint || sha256(payload) !== evaluation_fingerprint) throw new Error('STEP6_EVALUATION_FINGERPRINT_INVALID');
  if (![PATTERN_CONFIRMATORY_OOS_WAITING_STATE, PATTERN_CONFIRMATORY_OOS_TESTED_STATE].includes(evaluation.state)) throw new Error('STEP6_EVALUATION_STATE_INVALID');
  if (evaluation.governance?.pattern_validation_performed !== false || evaluation.governance?.predictive_weight_assigned !== false) throw new Error('STEP6_PATTERN_INFLUENCE_FORBIDDEN');
  if (evaluation.governance?.p002_changed !== false || evaluation.governance?.market_data_used !== false) throw new Error('STEP6_GOVERNANCE_DRIFT');
  const expectedTestRun = evaluation.state === PATTERN_CONFIRMATORY_OOS_TESTED_STATE;
  if (evaluation.multiple_testing?.confirmatory_alpha_spent !== expectedTestRun) throw new Error('STEP6_ALPHA_SPEND_STATE_MISMATCH');
  if (evaluation.multiple_testing?.significance_test_run !== expectedTestRun || evaluation.multiple_testing?.correction_run !== expectedTestRun) throw new Error('STEP6_TEST_EXECUTION_STATE_MISMATCH');
  for (const result of evaluation.candidate_results ?? []) {
    const { result_fingerprint, ...resultPayload } = result;
    if (!result_fingerprint || sha256(resultPayload) !== result_fingerprint) throw new Error('STEP6_RESULT_FINGERPRINT_INVALID');
    if (result.decision_weight !== 0 || result.pattern_validated !== false) throw new Error('STEP6_RESULT_DECISION_WEIGHT_FORBIDDEN');
  }
  return true;
}

export function patternConfirmatoryEvaluationEvidenceNode(result) {
  if (!result?.result_fingerprint || !result?.pattern_id) throw new Error('STEP6_RESULT_REQUIRED');
  const passed = result.out_of_sample_result === 'PASS';
  return Object.freeze({
    id: `EVIDENCE-OOS-${result.pattern_id}`,
    type: 'PATTERN_CONFIRMATORY_OOS_RESULT',
    verified: false,
    sourceVerified: true,
    confirmatoryOosPassed: passed,
    patternValidated: false,
    decisionWeight: 0,
    critical: false,
    patternId: result.pattern_id,
    fingerprint: result.result_fingerprint
  });
}
