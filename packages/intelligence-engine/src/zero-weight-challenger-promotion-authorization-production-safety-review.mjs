import { createHash } from 'node:crypto';
import {
  PATTERN_CANARY_GRADUATION_GOVERNANCE_VERSION,
  verifyPatternCanaryGraduationDossier,
  verifyPatternCanaryGraduationDecision
} from './pattern-canary-graduation-retirement-governance.mjs';

export const ZERO_WEIGHT_CHALLENGER_PROMOTION_SAFETY_VERSION = 'ZERO_WEIGHT_CHALLENGER_PROMOTION_AUTHORIZATION_PRODUCTION_SAFETY_REVIEW_V0_1';

export const REQUIRED_PRODUCTION_SAFETY_CONTROLS = Object.freeze([
  'HOLDOUT_FIREWALL_INTACT',
  'GRADUATION_EVIDENCE_EXCLUDED_FROM_TRAINING_RETUNING_AND_INDEPENDENT_PROMOTION_PROOF',
  'CANDIDATE_AND_GRADUATION_LINEAGE_REPRODUCIBLE',
  'CALIBRATION_LINEAGE_VERIFIED',
  'ROLLBACK_AND_CHAMPION_FALLBACK_VERIFIED',
  'OBSERVABILITY_ALERTING_AND_KILL_SIGNAL_PATH_READY',
  'DEPLOYMENT_CHANGE_REVERSIBLE',
  'SECURITY_IDENTITY_ACCESS_AND_DATA_GOVERNANCE_CLEAR',
  'CAPACITY_BACKPRESSURE_AND_FAILURE_ISOLATION_READY',
  'REGRESSION_AND_SYSTEM_ASSURANCE_GREEN',
  'GATE6_CAPITAL_LOCK_CONFIRMED',
  'PRODUCTION_WEIGHT_AND_CHAMPION_UNCHANGED'
]);

const AUTHORIZATION_DECISIONS = new Set([
  'APPROVE_FOR_CONTROLLED_PRODUCTION_ACTIVATION_NOT_ACTIVATED',
  'HOLD_ZERO_WEIGHT_CHALLENGER',
  'REJECT_ZERO_WEIGHT_CHALLENGER'
]);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
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

function sorted(values) {
  return [...values].sort();
}

function fingerprintPayload(row, field, error) {
  const { [field]: fingerprint, ...payload } = row ?? {};
  if (!fingerprint || sha256(payload) !== fingerprint) throw new Error(error);
  return true;
}

function sameStringSet(a, b) {
  return stableStringify(sorted(a ?? [])) === stableStringify(sorted(b ?? []));
}

function verifyExactGraduatedCandidate({ graduationDossier, graduationDecision }) {
  verifyPatternCanaryGraduationDossier(graduationDossier);
  verifyPatternCanaryGraduationDecision(graduationDecision);

  if (graduationDecision.decision_version !== PATTERN_CANARY_GRADUATION_GOVERNANCE_VERSION) {
    throw new Error('STEP14_STEP13_DECISION_VERSION_INVALID');
  }
  if (graduationDecision.decision !== 'GRADUATE_TO_ZERO_WEIGHT_CHALLENGER_CANDIDATE' ||
      graduationDecision.state !== 'PATTERN_GRADUATED_ZERO_WEIGHT_CHALLENGER_CANDIDATE_NOT_PRODUCTION_ACTIVATED') {
    throw new Error('STEP14_EXACT_STEP13_GRADUATION_DECISION_REQUIRED');
  }
  if (graduationDecision.next_stage !== 'STEP_14_ZERO_WEIGHT_CHALLENGER_PROMOTION_AUTHORIZATION_AND_PRODUCTION_SAFETY_REVIEW') {
    throw new Error('STEP14_STEP13_NEXT_STAGE_LINEAGE_INVALID');
  }
  if (graduationDecision.graduation_dossier_fingerprint !== graduationDossier.graduation_dossier_fingerprint) {
    throw new Error('STEP14_GRADUATION_DOSSIER_DECISION_MISMATCH');
  }
  const candidate = graduationDecision.candidate;
  if (!candidate || candidate.state !== 'ZERO_WEIGHT_CHALLENGER_CANDIDATE_NOT_PRODUCTION_ACTIVATED') {
    throw new Error('STEP14_ZERO_WEIGHT_CHALLENGER_CANDIDATE_REQUIRED');
  }
  if (candidate.source_graduation_dossier_fingerprint !== graduationDossier.graduation_dossier_fingerprint) {
    throw new Error('STEP14_CANDIDATE_DOSSIER_LINEAGE_MISMATCH');
  }
  if (candidate.decision_weight !== 0 || candidate.production_activation_authorized !== false ||
      candidate.champion_replacement_authorized !== false || candidate.capital_use_authorized !== false) {
    throw new Error('STEP14_CANDIDATE_ZERO_WEIGHT_BOUNDARY_INVALID');
  }
  if (!sameStringSet(candidate.approved_pattern_ids, graduationDossier.approved_pattern_ids)) {
    throw new Error('STEP14_APPROVED_PATTERN_LINEAGE_MISMATCH');
  }
  if (candidate.source_shadow_plan_fingerprint !== graduationDossier.source_shadow_plan_fingerprint) {
    throw new Error('STEP14_SHADOW_PLAN_LINEAGE_MISMATCH');
  }
  if (stableStringify(candidate.calibration) !== stableStringify(graduationDossier.calibration)) {
    throw new Error('STEP14_CALIBRATION_LINEAGE_MISMATCH');
  }
  return true;
}

function normalizeSafetyControls(controls, evidenceReferences) {
  if (!controls || typeof controls !== 'object' || Array.isArray(controls)) {
    throw new Error('STEP14_SAFETY_CONTROLS_OBJECT_REQUIRED');
  }
  if (!evidenceReferences || typeof evidenceReferences !== 'object' || Array.isArray(evidenceReferences)) {
    throw new Error('STEP14_SAFETY_EVIDENCE_REFERENCES_OBJECT_REQUIRED');
  }

  const normalizedControls = {};
  const normalizedEvidence = {};
  for (const control of REQUIRED_PRODUCTION_SAFETY_CONTROLS) {
    if (typeof controls[control] !== 'boolean') throw new Error(`STEP14_SAFETY_CONTROL_BOOLEAN_REQUIRED:${control}`);
    const ref = evidenceReferences[control];
    if (!ref || !String(ref).trim()) throw new Error(`STEP14_SAFETY_EVIDENCE_REFERENCE_REQUIRED:${control}`);
    normalizedControls[control] = controls[control];
    normalizedEvidence[control] = String(ref).trim();
  }

  const allowed = new Set(REQUIRED_PRODUCTION_SAFETY_CONTROLS);
  for (const key of Object.keys(controls)) if (!allowed.has(key)) throw new Error(`STEP14_UNKNOWN_SAFETY_CONTROL:${key}`);
  for (const key of Object.keys(evidenceReferences)) if (!allowed.has(key)) throw new Error(`STEP14_UNKNOWN_SAFETY_EVIDENCE_REFERENCE:${key}`);

  return { normalizedControls, normalizedEvidence };
}

export function createZeroWeightChallengerProductionSafetyReview({
  graduationDossier,
  graduationDecision,
  controls,
  evidenceReferences,
  reviewer,
  reviewedAt,
  rationale
}) {
  verifyExactGraduatedCandidate({ graduationDossier, graduationDecision });
  if (!reviewer || !String(reviewer).trim()) throw new Error('STEP14_REVIEWER_REQUIRED');
  if (!rationale || !String(rationale).trim()) throw new Error('STEP14_REVIEW_RATIONALE_REQUIRED');
  const reviewedMs = parseTimestamp('STEP14_REVIEWED_AT', reviewedAt);
  if (reviewedMs <= parseTimestamp('STEP14_STEP13_DECIDED_AT', graduationDecision.decided_at)) {
    throw new Error('STEP14_REVIEW_MUST_FOLLOW_STEP13_GRADUATION_DECISION');
  }

  const { normalizedControls, normalizedEvidence } = normalizeSafetyControls(controls, evidenceReferences);
  const failedControls = REQUIRED_PRODUCTION_SAFETY_CONTROLS.filter(control => normalizedControls[control] !== true);
  const eligibleForManualAuthorization = failedControls.length === 0;

  const payload = {
    review_version: ZERO_WEIGHT_CHALLENGER_PROMOTION_SAFETY_VERSION,
    state: eligibleForManualAuthorization
      ? 'ZERO_WEIGHT_CHALLENGER_PRODUCTION_SAFETY_REVIEW_PASS_NOT_ACTIVATED'
      : 'ZERO_WEIGHT_CHALLENGER_PRODUCTION_SAFETY_REVIEW_HOLD_OR_REJECT_REQUIRED',
    reviewed_at: reviewedAt,
    reviewer: String(reviewer).trim(),
    rationale: String(rationale).trim(),
    source_graduation_dossier_fingerprint: graduationDossier.graduation_dossier_fingerprint,
    source_graduation_decision_fingerprint: graduationDecision.graduation_decision_fingerprint,
    source_step12_activation_fingerprint: graduationDossier.source_step12_activation_fingerprint,
    source_step12_health_fingerprint: graduationDossier.source_step12_health_fingerprint,
    candidate: {
      state: graduationDecision.candidate.state,
      decision_weight: 0,
      approved_pattern_ids: sorted(graduationDecision.candidate.approved_pattern_ids ?? []),
      source_shadow_plan_fingerprint: graduationDecision.candidate.source_shadow_plan_fingerprint,
      calibration: graduationDecision.candidate.calibration,
      production_activation_authorized: false,
      champion_replacement_authorized: false,
      capital_use_authorized: false
    },
    safety_controls: normalizedControls,
    safety_evidence_references: normalizedEvidence,
    failed_controls: failedControls,
    gates: {
      all_required_safety_controls_pass: eligibleForManualAuthorization,
      holdout_firewall_intact: normalizedControls.HOLDOUT_FIREWALL_INTACT,
      graduation_evidence_not_reused: normalizedControls.GRADUATION_EVIDENCE_EXCLUDED_FROM_TRAINING_RETUNING_AND_INDEPENDENT_PROMOTION_PROOF,
      lineage_reproducible: normalizedControls.CANDIDATE_AND_GRADUATION_LINEAGE_REPRODUCIBLE,
      calibration_lineage_verified: normalizedControls.CALIBRATION_LINEAGE_VERIFIED,
      rollback_path_verified: normalizedControls.ROLLBACK_AND_CHAMPION_FALLBACK_VERIFIED,
      observability_ready: normalizedControls.OBSERVABILITY_ALERTING_AND_KILL_SIGNAL_PATH_READY,
      deployment_reversible: normalizedControls.DEPLOYMENT_CHANGE_REVERSIBLE,
      security_and_data_governance_clear: normalizedControls.SECURITY_IDENTITY_ACCESS_AND_DATA_GOVERNANCE_CLEAR,
      capacity_and_failure_isolation_ready: normalizedControls.CAPACITY_BACKPRESSURE_AND_FAILURE_ISOLATION_READY,
      regression_and_system_assurance_green: normalizedControls.REGRESSION_AND_SYSTEM_ASSURANCE_GREEN,
      gate6_capital_lock_confirmed: normalizedControls.GATE6_CAPITAL_LOCK_CONFIRMED,
      production_weight_and_champion_unchanged: normalizedControls.PRODUCTION_WEIGHT_AND_CHAMPION_UNCHANGED
    },
    eligible_for_manual_authorization: eligibleForManualAuthorization,
    evaluation_firewall: {
      graduation_evidence_reuse_for_training: false,
      graduation_evidence_reuse_for_retuning: false,
      graduation_evidence_counts_as_new_independent_activation_proof: false,
      new_prospective_evidence_required_for_nonzero_activation: true,
      additional_alpha_spent: false
    },
    governance: {
      immutable_review: true,
      candidate_change_requires_new_review: true,
      automatic_approval: false,
      automatic_activation: false,
      production_decision_weight: 0,
      production_mutation_allowed: false,
      champion_replacement_authorized: false,
      capital_execution_allowed: false,
      gate6_capital_lock_preserved: true,
      p002_changed: false,
      gate1_to_gate6_ownership_changed: false,
      capital_effect: 'NONE',
      real_money: 'NO'
    }
  };
  return deepFreeze({ ...payload, production_safety_review_fingerprint: sha256(payload) });
}

export function verifyZeroWeightChallengerProductionSafetyReview(review) {
  if (!review || review.review_version !== ZERO_WEIGHT_CHALLENGER_PROMOTION_SAFETY_VERSION) {
    throw new Error('STEP14_SAFETY_REVIEW_VERSION_INVALID');
  }
  fingerprintPayload(review, 'production_safety_review_fingerprint', 'STEP14_SAFETY_REVIEW_FINGERPRINT_INVALID');
  if (![
    'ZERO_WEIGHT_CHALLENGER_PRODUCTION_SAFETY_REVIEW_PASS_NOT_ACTIVATED',
    'ZERO_WEIGHT_CHALLENGER_PRODUCTION_SAFETY_REVIEW_HOLD_OR_REJECT_REQUIRED'
  ].includes(review.state)) throw new Error('STEP14_SAFETY_REVIEW_STATE_INVALID');
  if (review.candidate?.decision_weight !== 0 || review.candidate?.production_activation_authorized !== false ||
      review.candidate?.champion_replacement_authorized !== false || review.candidate?.capital_use_authorized !== false) {
    throw new Error('STEP14_SAFETY_REVIEW_CANDIDATE_BOUNDARY_INVALID');
  }
  if (review.governance?.production_decision_weight !== 0 || review.governance?.production_mutation_allowed !== false ||
      review.governance?.champion_replacement_authorized !== false || review.governance?.capital_execution_allowed !== false ||
      review.governance?.real_money !== 'NO') throw new Error('STEP14_SAFETY_REVIEW_GOVERNANCE_INVALID');
  const failed = REQUIRED_PRODUCTION_SAFETY_CONTROLS.filter(control => review.safety_controls?.[control] !== true);
  if (stableStringify(failed) !== stableStringify(review.failed_controls ?? [])) throw new Error('STEP14_FAILED_CONTROL_SET_INVALID');
  if ((failed.length === 0) !== (review.eligible_for_manual_authorization === true)) throw new Error('STEP14_SAFETY_ELIGIBILITY_INVALID');
  for (const control of REQUIRED_PRODUCTION_SAFETY_CONTROLS) {
    if (!review.safety_evidence_references?.[control]) throw new Error(`STEP14_SAFETY_REVIEW_EVIDENCE_REFERENCE_MISSING:${control}`);
  }
  return true;
}

export function recordZeroWeightChallengerPromotionAuthorization({
  safetyReview,
  decision,
  approver,
  rationale,
  decidedAt
}) {
  verifyZeroWeightChallengerProductionSafetyReview(safetyReview);
  if (!AUTHORIZATION_DECISIONS.has(decision)) throw new Error('STEP14_AUTHORIZATION_DECISION_INVALID');
  if (!approver || !String(approver).trim()) throw new Error('STEP14_APPROVER_REQUIRED');
  if (!rationale || !String(rationale).trim()) throw new Error('STEP14_AUTHORIZATION_RATIONALE_REQUIRED');
  const decidedMs = parseTimestamp('STEP14_AUTHORIZATION_DECIDED_AT', decidedAt);
  if (decidedMs <= parseTimestamp('STEP14_SAFETY_REVIEWED_AT', safetyReview.reviewed_at)) {
    throw new Error('STEP14_AUTHORIZATION_MUST_FOLLOW_SAFETY_REVIEW');
  }

  if (decision === 'APPROVE_FOR_CONTROLLED_PRODUCTION_ACTIVATION_NOT_ACTIVATED' &&
      safetyReview.eligible_for_manual_authorization !== true) {
    throw new Error('STEP14_APPROVAL_REQUIRES_ALL_SAFETY_CONTROLS_PASS');
  }

  let state;
  let nextStage;
  let candidateArchived = false;
  let newSafetyReviewRequired = false;

  if (decision === 'APPROVE_FOR_CONTROLLED_PRODUCTION_ACTIVATION_NOT_ACTIVATED') {
    state = 'ZERO_WEIGHT_CHALLENGER_APPROVED_FOR_CONTROLLED_PRODUCTION_ACTIVATION_NOT_ACTIVATED';
    nextStage = 'STEP_15_CONTROLLED_PRODUCTION_ACTIVATION_AND_EMERGENCY_ROLLBACK';
  } else if (decision === 'HOLD_ZERO_WEIGHT_CHALLENGER') {
    state = 'ZERO_WEIGHT_CHALLENGER_HELD_ZERO_WEIGHT_NEW_SAFETY_REVIEW_REQUIRED';
    nextStage = 'REPEAT_STEP14_WITH_NEW_SAFETY_REVIEW_BEFORE_FUTURE_APPROVAL';
    newSafetyReviewRequired = true;
  } else {
    state = 'ZERO_WEIGHT_CHALLENGER_REJECTED_ARCHIVED_CHAMPION_UNCHANGED';
    nextStage = 'CHALLENGER_REJECTED_REQUIRES_NEW_GOVERNED_LINEAGE_FOR_FUTURE_ATTEMPT';
    candidateArchived = true;
  }

  const payload = {
    authorization_version: ZERO_WEIGHT_CHALLENGER_PROMOTION_SAFETY_VERSION,
    state,
    decision,
    approver: String(approver).trim(),
    rationale: String(rationale).trim(),
    decided_at: decidedAt,
    source_production_safety_review_fingerprint: safetyReview.production_safety_review_fingerprint,
    source_graduation_dossier_fingerprint: safetyReview.source_graduation_dossier_fingerprint,
    source_graduation_decision_fingerprint: safetyReview.source_graduation_decision_fingerprint,
    candidate: {
      decision_weight: 0,
      approved_pattern_ids: safetyReview.candidate.approved_pattern_ids,
      source_shadow_plan_fingerprint: safetyReview.candidate.source_shadow_plan_fingerprint,
      calibration: safetyReview.candidate.calibration,
      production_activation_performed_here: false,
      nonzero_production_weight_authorized_here: false,
      champion_replacement_authorized_here: false,
      capital_use_authorized_here: false,
      archived: candidateArchived
    },
    enforcement: {
      production_decision_weight_after_step14: 0,
      champion_unchanged: true,
      production_mutation_performed: false,
      routing_or_probability_influence_changed_here: false,
      new_safety_review_required_before_future_approval: newSafetyReviewRequired,
      same_step13_graduation_decision_may_be_reauthorized_after_rejection: decision === 'REJECT_ZERO_WEIGHT_CHALLENGER' ? false : null
    },
    evaluation_firewall: {
      graduation_evidence_reuse_for_training: false,
      graduation_evidence_reuse_for_retuning: false,
      graduation_evidence_counts_as_new_independent_activation_proof: false,
      new_prospective_evidence_required_for_nonzero_activation: true
    },
    governance: {
      approval_is_production_activation: false,
      automatic_activation: false,
      automatic_retuning: false,
      production_decision_weight: 0,
      production_mutation_allowed: false,
      champion_replacement_authorized: false,
      capital_execution_allowed: false,
      gate6_capital_lock_preserved: true,
      p002_changed: false,
      gate1_to_gate6_ownership_changed: false,
      capital_effect: 'NONE',
      real_money: 'NO'
    },
    next_stage: nextStage
  };
  return deepFreeze({ ...payload, promotion_authorization_fingerprint: sha256(payload) });
}

export function verifyZeroWeightChallengerPromotionAuthorization(authorization) {
  if (!authorization || authorization.authorization_version !== ZERO_WEIGHT_CHALLENGER_PROMOTION_SAFETY_VERSION) {
    throw new Error('STEP14_AUTHORIZATION_VERSION_INVALID');
  }
  fingerprintPayload(authorization, 'promotion_authorization_fingerprint', 'STEP14_AUTHORIZATION_FINGERPRINT_INVALID');
  if (!AUTHORIZATION_DECISIONS.has(authorization.decision)) throw new Error('STEP14_AUTHORIZATION_DECISION_VALUE_INVALID');
  if (authorization.candidate?.decision_weight !== 0 || authorization.candidate?.production_activation_performed_here !== false ||
      authorization.candidate?.nonzero_production_weight_authorized_here !== false ||
      authorization.candidate?.champion_replacement_authorized_here !== false ||
      authorization.candidate?.capital_use_authorized_here !== false) throw new Error('STEP14_AUTHORIZATION_CANDIDATE_BOUNDARY_INVALID');
  if (authorization.enforcement?.production_decision_weight_after_step14 !== 0 ||
      authorization.enforcement?.champion_unchanged !== true ||
      authorization.enforcement?.production_mutation_performed !== false ||
      authorization.enforcement?.routing_or_probability_influence_changed_here !== false) {
    throw new Error('STEP14_AUTHORIZATION_ENFORCEMENT_INVALID');
  }
  if (authorization.governance?.approval_is_production_activation !== false ||
      authorization.governance?.production_decision_weight !== 0 ||
      authorization.governance?.production_mutation_allowed !== false ||
      authorization.governance?.champion_replacement_authorized !== false ||
      authorization.governance?.capital_execution_allowed !== false ||
      authorization.governance?.real_money !== 'NO') throw new Error('STEP14_AUTHORIZATION_GOVERNANCE_INVALID');
  if (authorization.decision === 'APPROVE_FOR_CONTROLLED_PRODUCTION_ACTIVATION_NOT_ACTIVATED' &&
      (authorization.state !== 'ZERO_WEIGHT_CHALLENGER_APPROVED_FOR_CONTROLLED_PRODUCTION_ACTIVATION_NOT_ACTIVATED' ||
       authorization.next_stage !== 'STEP_15_CONTROLLED_PRODUCTION_ACTIVATION_AND_EMERGENCY_ROLLBACK')) {
    throw new Error('STEP14_APPROVAL_STATE_INVALID');
  }
  if (authorization.decision === 'HOLD_ZERO_WEIGHT_CHALLENGER' &&
      authorization.enforcement?.new_safety_review_required_before_future_approval !== true) {
    throw new Error('STEP14_HOLD_BOUNDARY_INVALID');
  }
  if (authorization.decision === 'REJECT_ZERO_WEIGHT_CHALLENGER' &&
      (authorization.candidate?.archived !== true || authorization.enforcement?.same_step13_graduation_decision_may_be_reauthorized_after_rejection !== false)) {
    throw new Error('STEP14_REJECTION_BOUNDARY_INVALID');
  }
  return true;
}
