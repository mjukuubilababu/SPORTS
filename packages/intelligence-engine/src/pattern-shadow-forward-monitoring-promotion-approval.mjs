import { createHash } from 'node:crypto';
import {
  PATTERN_PROMOTION_SHADOW_VERSION,
  evaluatePatternShadow,
  verifyPatternShadowEvaluation
} from './pattern-promotion-shadow-integration.mjs';

export const PATTERN_SHADOW_FORWARD_APPROVAL_VERSION = 'PATTERN_SHADOW_FORWARD_MONITORING_PROMOTION_APPROVAL_V0_1';
export const FORWARD_MIN_SETTLED_N = 30;
export const FORWARD_MAX_ECE_DEGRADATION = 0.01;

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

function keyOf(row) {
  return `${row.match_id}|${row.market_key}|${row.selection}`;
}

function verifyStep8Settlement(row) {
  const { settlement_fingerprint, ...payload } = row ?? {};
  if (!settlement_fingerprint || sha256(payload) !== settlement_fingerprint) {
    throw new Error('STEP9_STEP8_SETTLEMENT_FINGERPRINT_INVALID');
  }
  if (row.settlement_version !== PATTERN_PROMOTION_SHADOW_VERSION) throw new Error('STEP9_STEP8_SETTLEMENT_VERSION_INVALID');
  if (row.governance?.shadow_only !== true || row.governance?.decision_weight !== 0 || row.governance?.settlement_rewrites_prediction !== false) {
    throw new Error('STEP9_STEP8_SETTLEMENT_GOVERNANCE_INVALID');
  }
  return true;
}

function verifyStep8ShadowPrediction(row) {
  const { shadow_prediction_fingerprint, ...payload } = row ?? {};
  if (!shadow_prediction_fingerprint || sha256(payload) !== shadow_prediction_fingerprint) {
    throw new Error('STEP9_SHADOW_PREDICTION_FINGERPRINT_INVALID');
  }
  if (row.shadow_version !== PATTERN_PROMOTION_SHADOW_VERSION) throw new Error('STEP9_SHADOW_PREDICTION_VERSION_INVALID');
  if (row.governance?.shadow_only !== true || row.governance?.decision_weight !== 0 || row.governance?.production_decision_affected !== false) {
    throw new Error('STEP9_SHADOW_PREDICTION_GOVERNANCE_INVALID');
  }
  return true;
}

export function freezePatternPromotionDossier({ step8Evaluation, step8Settlements, frozenAt }) {
  verifyPatternShadowEvaluation(step8Evaluation);
  if (step8Evaluation.state !== 'ELIGIBLE_FOR_MANUAL_GOVERNANCE_REVIEW_ZERO_WEIGHT') {
    throw new Error('STEP9_STEP8_MANUAL_REVIEW_ELIGIBILITY_REQUIRED');
  }
  if (!Array.isArray(step8Settlements) || step8Settlements.length !== step8Evaluation.settled_n) {
    throw new Error('STEP9_EXACT_STEP8_SETTLEMENT_COHORT_REQUIRED');
  }
  for (const row of step8Settlements) verifyStep8Settlement(row);
  const rerun = evaluatePatternShadow({
    settlements: step8Settlements,
    evaluatedAt: step8Evaluation.evaluated_at
  });
  if (rerun.shadow_evaluation_fingerprint !== step8Evaluation.shadow_evaluation_fingerprint) {
    throw new Error('STEP9_STEP8_EVALUATION_SETTLEMENT_COHORT_MISMATCH');
  }
  const frozenMs = parseTimestamp('STEP9_DOSSIER_FROZEN_AT', frozenAt);
  if (frozenMs <= parseTimestamp('STEP9_STEP8_EVALUATED_AT', step8Evaluation.evaluated_at)) {
    throw new Error('STEP9_DOSSIER_FREEZE_MUST_FOLLOW_STEP8_EVALUATION');
  }
  const keys = step8Settlements.map(keyOf);
  if (new Set(keys).size !== keys.length) throw new Error('STEP9_STEP8_DUPLICATE_SETTLEMENT_KEY');
  const fingerprints = step8Settlements.map(row => row.settlement_fingerprint).sort();
  const payload = {
    dossier_version: PATTERN_SHADOW_FORWARD_APPROVAL_VERSION,
    state: 'PROMOTION_DOSSIER_FROZEN_FORWARD_MONITORING_ONLY',
    frozen_at: frozenAt,
    source_step8_evaluation_fingerprint: step8Evaluation.shadow_evaluation_fingerprint,
    source_step8_settled_n: step8Evaluation.settled_n,
    source_step8_settlement_fingerprints: fingerprints,
    excluded_step8_match_market_selection_keys: [...keys].sort(),
    source_step8_metrics: {
      champion: step8Evaluation.champion,
      shadow_challenger: step8Evaluation.shadow_challenger
    },
    forward_plan: {
      minimum_new_settled_n: FORWARD_MIN_SETTLED_N,
      step8_row_reuse_allowed: false,
      generated_after_dossier_freeze_required: true,
      chronological_half_non_degradation_required: true,
      maximum_ece_degradation: FORWARD_MAX_ECE_DEGRADATION,
      verified_market_clv_required: true,
      additional_alpha_spent: false
    },
    rollback_policy_for_next_stage: {
      provenance_or_fingerprint_failure: 'ROLLBACK_TO_CHAMPION',
      post_kickoff_leakage: 'ROLLBACK_TO_CHAMPION',
      brier_degradation: 'ROLLBACK_TO_CHAMPION',
      log_loss_degradation: 'ROLLBACK_TO_CHAMPION',
      ece_degradation_above: FORWARD_MAX_ECE_DEGRADATION,
      calibration_or_pattern_lineage_drift: 'ROLLBACK_TO_CHAMPION'
    },
    governance: {
      decision_weight: 0,
      automatic_approval: false,
      automatic_promotion: false,
      automatic_retuning: false,
      production_mutation_allowed: false,
      champion_remains_authoritative: true,
      p002_changed: false,
      gate1_to_gate6_ownership_changed: false,
      capital_effect: 'NONE',
      real_money: 'NO'
    }
  };
  return deepFreeze({ ...payload, dossier_fingerprint: sha256(payload) });
}

export function verifyPatternPromotionDossier(dossier) {
  if (!dossier || dossier.dossier_version !== PATTERN_SHADOW_FORWARD_APPROVAL_VERSION) throw new Error('STEP9_DOSSIER_VERSION_INVALID');
  const { dossier_fingerprint, ...payload } = dossier;
  if (!dossier_fingerprint || sha256(payload) !== dossier_fingerprint) throw new Error('STEP9_DOSSIER_FINGERPRINT_INVALID');
  if (dossier.governance?.decision_weight !== 0 || dossier.governance?.production_mutation_allowed !== false) {
    throw new Error('STEP9_DOSSIER_PRODUCTION_INFLUENCE_FORBIDDEN');
  }
  return true;
}

export function registerPatternForwardShadowObservation({ dossier, shadowPrediction, settlement, registeredAt }) {
  verifyPatternPromotionDossier(dossier);
  verifyStep8ShadowPrediction(shadowPrediction);
  verifyStep8Settlement(settlement);
  const registeredMs = parseTimestamp('STEP9_REGISTERED_AT', registeredAt);
  const frozenMs = parseTimestamp('STEP9_DOSSIER_FROZEN_AT', dossier.frozen_at);
  const generatedMs = parseTimestamp('STEP9_SHADOW_GENERATED_AT', shadowPrediction.generated_at);
  const kickoffMs = parseTimestamp('STEP9_KICKOFF_AT', shadowPrediction.kickoff_at);
  const settledMs = parseTimestamp('STEP9_SETTLED_AT', settlement.settled_at);
  if (generatedMs <= frozenMs) throw new Error('STEP9_FORWARD_PREDICTION_MUST_FOLLOW_DOSSIER_FREEZE');
  if (generatedMs >= kickoffMs) throw new Error('STEP9_POST_KICKOFF_SHADOW_PREDICTION_FORBIDDEN');
  if (settledMs <= kickoffMs) throw new Error('STEP9_FORWARD_SETTLEMENT_MUST_FOLLOW_KICKOFF');
  if (registeredMs < settledMs) throw new Error('STEP9_REGISTRATION_CANNOT_PREDATE_SETTLEMENT');
  if (settlement.source_shadow_prediction_fingerprint !== shadowPrediction.shadow_prediction_fingerprint) {
    throw new Error('STEP9_SETTLEMENT_PREDICTION_LINEAGE_MISMATCH');
  }
  if (shadowPrediction.match_id !== settlement.match_id || shadowPrediction.market_key !== settlement.market_key || shadowPrediction.selection !== settlement.selection) {
    throw new Error('STEP9_MATCH_MARKET_SELECTION_LINEAGE_MISMATCH');
  }
  const key = keyOf(settlement);
  if (dossier.excluded_step8_match_market_selection_keys.includes(key)) throw new Error('STEP9_STEP8_EVIDENCE_REUSE_FORBIDDEN');
  if (!Number.isFinite(settlement.verified_market_clv)) throw new Error('STEP9_VERIFIED_MARKET_CLV_REQUIRED');
  const payload = {
    observation_version: PATTERN_SHADOW_FORWARD_APPROVAL_VERSION,
    registered_at: registeredAt,
    dossier_fingerprint: dossier.dossier_fingerprint,
    match_id: settlement.match_id,
    market_key: settlement.market_key,
    selection: settlement.selection,
    kickoff_at: shadowPrediction.kickoff_at,
    generated_at: shadowPrediction.generated_at,
    settled_at: settlement.settled_at,
    source_shadow_prediction_fingerprint: shadowPrediction.shadow_prediction_fingerprint,
    source_settlement_fingerprint: settlement.settlement_fingerprint,
    baseline_probability: settlement.baseline_probability,
    shadow_probability: settlement.shadow_probability,
    outcome: settlement.outcome,
    baseline_loss: settlement.baseline_loss,
    shadow_loss: settlement.shadow_loss,
    verified_market_clv: settlement.verified_market_clv,
    governance: {
      forward_only: true,
      step8_row_reused: false,
      shadow_only: true,
      decision_weight: 0,
      production_decision_affected: false
    }
  };
  return deepFreeze({ ...payload, forward_observation_fingerprint: sha256(payload) });
}

export function verifyPatternForwardShadowObservation(observation) {
  if (!observation || observation.observation_version !== PATTERN_SHADOW_FORWARD_APPROVAL_VERSION) throw new Error('STEP9_FORWARD_OBSERVATION_VERSION_INVALID');
  const { forward_observation_fingerprint, ...payload } = observation;
  if (!forward_observation_fingerprint || sha256(payload) !== forward_observation_fingerprint) throw new Error('STEP9_FORWARD_OBSERVATION_FINGERPRINT_INVALID');
  if (observation.governance?.forward_only !== true || observation.governance?.step8_row_reused !== false || observation.governance?.decision_weight !== 0) {
    throw new Error('STEP9_FORWARD_OBSERVATION_GOVERNANCE_INVALID');
  }
  return true;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ece(rows, probabilityKey, bins = 10) {
  let total = 0;
  for (let b = 0; b < bins; b += 1) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const bucket = rows.filter(row => row[probabilityKey] >= lo && (b === bins - 1 ? row[probabilityKey] <= hi : row[probabilityKey] < hi));
    if (!bucket.length) continue;
    const avgP = mean(bucket.map(row => row[probabilityKey]));
    const avgY = mean(bucket.map(row => row.outcome));
    total += (bucket.length / rows.length) * Math.abs(avgP - avgY);
  }
  return total;
}

function metrics(rows) {
  if (!rows.length) return { n: 0, brier: null, logLoss: null, ece: null, clv: null };
  return {
    n: rows.length,
    brier: mean(rows.map(row => row.shadow_loss.brier)),
    logLoss: mean(rows.map(row => row.shadow_loss.log_loss)),
    ece: ece(rows, 'shadow_probability'),
    clv: mean(rows.map(row => row.verified_market_clv))
  };
}

function championMetrics(rows) {
  if (!rows.length) return { n: 0, brier: null, logLoss: null, ece: null, clv: 0 };
  return {
    n: rows.length,
    brier: mean(rows.map(row => row.baseline_loss.brier)),
    logLoss: mean(rows.map(row => row.baseline_loss.log_loss)),
    ece: ece(rows, 'baseline_probability'),
    clv: 0
  };
}

function chronologicalHalves(rows) {
  const ordered = [...rows].sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at) || keyOf(a).localeCompare(keyOf(b)));
  const cut = Math.floor(ordered.length / 2);
  return [ordered.slice(0, cut), ordered.slice(cut)];
}

function halfSummary(rows, label) {
  const champion = championMetrics(rows);
  const shadow = metrics(rows);
  return {
    label,
    champion,
    shadow,
    brier_non_degraded: rows.length > 0 && shadow.brier <= champion.brier,
    log_loss_non_degraded: rows.length > 0 && shadow.logLoss <= champion.logLoss
  };
}

export function evaluatePatternForwardMonitoring({ dossier, observations, evaluatedAt }) {
  verifyPatternPromotionDossier(dossier);
  parseTimestamp('STEP9_FORWARD_EVALUATED_AT', evaluatedAt);
  if (!Array.isArray(observations)) throw new Error('STEP9_FORWARD_OBSERVATION_ARRAY_REQUIRED');
  const seen = new Set();
  for (const row of observations) {
    verifyPatternForwardShadowObservation(row);
    if (row.dossier_fingerprint !== dossier.dossier_fingerprint) throw new Error('STEP9_FORWARD_OBSERVATION_DOSSIER_MISMATCH');
    const key = keyOf(row);
    if (seen.has(key)) throw new Error('STEP9_DUPLICATE_FORWARD_MATCH_MARKET_SELECTION');
    seen.add(key);
  }
  const n = observations.length;
  const champion = championMetrics(observations);
  const shadow = metrics(observations);
  const enoughN = n >= FORWARD_MIN_SETTLED_N;
  const clvComplete = observations.every(row => Number.isFinite(row.verified_market_clv));
  const halves = enoughN ? chronologicalHalves(observations).map((rows, i) => halfSummary(rows, i === 0 ? 'EARLY' : 'LATE')) : [];
  const halfNonDegradation = enoughN && halves.length === 2 && halves.every(row => row.brier_non_degraded && row.log_loss_non_degraded);
  const gates = {
    minimum_new_forward_n: enoughN,
    brier_better_overall: enoughN && shadow.brier < champion.brier,
    log_loss_better_overall: enoughN && shadow.logLoss < champion.logLoss,
    ece_non_degradation: enoughN && shadow.ece <= champion.ece + FORWARD_MAX_ECE_DEGRADATION,
    verified_market_clv_complete: enoughN && clvComplete,
    verified_market_clv_positive: enoughN && clvComplete && shadow.clv > 0,
    chronological_half_non_degradation: halfNonDegradation
  };
  const eligible = Object.values(gates).every(Boolean);
  const payload = {
    evaluation_version: PATTERN_SHADOW_FORWARD_APPROVAL_VERSION,
    state: !enoughN
      ? 'FORWARD_MONITORING_ACCUMULATING_ZERO_WEIGHT'
      : eligible
        ? 'ELIGIBLE_FOR_EXPLICIT_CONTROLLED_CANARY_APPROVAL_ZERO_WEIGHT'
        : 'FORWARD_MONITORING_DEGRADED_RETAIN_SHADOW_ZERO_WEIGHT',
    evaluated_at: evaluatedAt,
    dossier_fingerprint: dossier.dossier_fingerprint,
    forward_settled_n: n,
    minimum_forward_settled_n: FORWARD_MIN_SETTLED_N,
    champion,
    shadow,
    chronological_halves: halves,
    gates,
    additional_alpha_spent: false,
    governance: {
      decision_weight: 0,
      explicit_human_approval_required: true,
      automatic_approval: false,
      automatic_promotion: false,
      production_mutation_allowed: false,
      champion_remains_authoritative: true,
      capital_effect: 'NONE',
      real_money: 'NO'
    }
  };
  return deepFreeze({ ...payload, forward_evaluation_fingerprint: sha256(payload) });
}

export function verifyPatternForwardMonitoringEvaluation(evaluation) {
  if (!evaluation || evaluation.evaluation_version !== PATTERN_SHADOW_FORWARD_APPROVAL_VERSION) throw new Error('STEP9_FORWARD_EVALUATION_VERSION_INVALID');
  const { forward_evaluation_fingerprint, ...payload } = evaluation;
  if (!forward_evaluation_fingerprint || sha256(payload) !== forward_evaluation_fingerprint) throw new Error('STEP9_FORWARD_EVALUATION_FINGERPRINT_INVALID');
  if (evaluation.additional_alpha_spent !== false || evaluation.governance?.decision_weight !== 0 || evaluation.governance?.automatic_promotion !== false) {
    throw new Error('STEP9_FORWARD_EVALUATION_GOVERNANCE_INVALID');
  }
  return true;
}

export function recordPatternPromotionApproval({ dossier, forwardEvaluation, decision, approver, rationale, decidedAt }) {
  verifyPatternPromotionDossier(dossier);
  verifyPatternForwardMonitoringEvaluation(forwardEvaluation);
  if (forwardEvaluation.dossier_fingerprint !== dossier.dossier_fingerprint) throw new Error('STEP9_APPROVAL_DOSSIER_EVALUATION_MISMATCH');
  if (!['APPROVE_CONTROLLED_CANARY', 'REJECT_OR_CONTINUE_SHADOW'].includes(decision)) throw new Error('STEP9_APPROVAL_DECISION_INVALID');
  if (!approver || !String(approver).trim()) throw new Error('STEP9_APPROVER_REQUIRED');
  if (!rationale || !String(rationale).trim()) throw new Error('STEP9_APPROVAL_RATIONALE_REQUIRED');
  const decidedMs = parseTimestamp('STEP9_APPROVAL_DECIDED_AT', decidedAt);
  if (decidedMs <= parseTimestamp('STEP9_FORWARD_EVALUATED_AT', forwardEvaluation.evaluated_at)) throw new Error('STEP9_APPROVAL_MUST_FOLLOW_FORWARD_EVALUATION');
  if (decision === 'APPROVE_CONTROLLED_CANARY' && forwardEvaluation.state !== 'ELIGIBLE_FOR_EXPLICIT_CONTROLLED_CANARY_APPROVAL_ZERO_WEIGHT') {
    throw new Error('STEP9_CONTROLLED_CANARY_APPROVAL_WITHOUT_FORWARD_ELIGIBILITY_FORBIDDEN');
  }
  const approved = decision === 'APPROVE_CONTROLLED_CANARY';
  const payload = {
    approval_version: PATTERN_SHADOW_FORWARD_APPROVAL_VERSION,
    state: approved ? 'CONTROLLED_CANARY_APPROVED_NOT_ACTIVATED_ZERO_WEIGHT' : 'PROMOTION_REJECTED_OR_CONTINUE_SHADOW_ZERO_WEIGHT',
    decision,
    approver: String(approver).trim(),
    rationale: String(rationale).trim(),
    decided_at: decidedAt,
    dossier_fingerprint: dossier.dossier_fingerprint,
    forward_evaluation_fingerprint: forwardEvaluation.forward_evaluation_fingerprint,
    rollback_policy_for_next_stage: dossier.rollback_policy_for_next_stage,
    authorization: {
      controlled_canary_may_be_implemented_next_stage: approved,
      production_activation_performed_here: false,
      decision_weight_change_authorized_here: false,
      capital_use_authorized: false
    },
    governance: {
      decision_weight: 0,
      automatic_approval: false,
      automatic_promotion: false,
      automatic_retuning: false,
      production_mutation_allowed: false,
      champion_remains_authoritative: true,
      p002_changed: false,
      gate1_to_gate6_ownership_changed: false,
      capital_effect: 'NONE',
      real_money: 'NO'
    },
    next_stage: approved ? 'STEP_10_CONTROLLED_PATTERN_CANARY_ACTIVATION_AND_ROLLBACK_ENFORCEMENT' : 'CONTINUE_SHADOW_MONITORING_OR_REJECT_PATTERN'
  };
  return deepFreeze({ ...payload, approval_fingerprint: sha256(payload) });
}

export function verifyPatternPromotionApproval(approval) {
  if (!approval || approval.approval_version !== PATTERN_SHADOW_FORWARD_APPROVAL_VERSION) throw new Error('STEP9_APPROVAL_VERSION_INVALID');
  const { approval_fingerprint, ...payload } = approval;
  if (!approval_fingerprint || sha256(payload) !== approval_fingerprint) throw new Error('STEP9_APPROVAL_FINGERPRINT_INVALID');
  if (approval.governance?.decision_weight !== 0 || approval.governance?.production_mutation_allowed !== false || approval.authorization?.production_activation_performed_here !== false) {
    throw new Error('STEP9_APPROVAL_PRODUCTION_INFLUENCE_FORBIDDEN');
  }
  return true;
}
