import { createHash } from 'node:crypto';
import {
  STAGED_CONTROLLED_PRODUCTION_WEIGHT_VERSION,
  STAGED_CONTROLLED_PRODUCTION_MAX_DECISION_WEIGHT,
  STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT,
  STAGED_CONTROLLED_PRODUCTION_HEALTH_MIN_SETTLED_N,
  verifyStagedControlledProductionWeightActivation,
  verifyStagedControlledProductionWeightSettlement,
  evaluateStagedControlledProductionWeightHealth,
  verifyStagedControlledProductionWeightHealth,
  recordStagedControlledProductionWeightRollback,
  verifyStagedControlledProductionWeightRollback
} from './staged-controlled-production-weight-activation-monitoring.mjs';

export const STAGED_CONTROLLED_PRODUCTION_WEIGHT_EVIDENCE_GOVERNANCE_VERSION = 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_EVIDENCE_REVIEW_GOVERNANCE_V0_1';
export const STAGED_WEIGHT_EVIDENCE_MIN_SETTLED_N = STAGED_CONTROLLED_PRODUCTION_HEALTH_MIN_SETTLED_N;
export const STAGED_WEIGHT_MAX_DECISION_WEIGHT = STAGED_CONTROLLED_PRODUCTION_MAX_DECISION_WEIGHT;
export const STAGED_WEIGHT_MAX_MULTIPLIER_PER_GOVERNED_STAGE = 2;

export const STAGED_WEIGHT_GOVERNANCE_DECISIONS = Object.freeze([
  'AUTHORIZE_NEXT_STAGED_WEIGHT_STAGE_NOT_APPLIED',
  'HOLD_CURRENT_STAGED_WEIGHT',
  'RETIRE_AND_ROLLBACK_TO_CHAMPION'
]);

const DECISION_SET = new Set(STAGED_WEIGHT_GOVERNANCE_DECISIONS);

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

function fingerprintPayload(row, field, error) {
  const { [field]: fingerprint, ...payload } = row ?? {};
  if (!fingerprint || sha256(payload) !== fingerprint) throw new Error(error);
  return true;
}

function exactArrayEqual(a, b) {
  return stableStringify(a ?? []) === stableStringify(b ?? []);
}

function exactStringSetEqual(a, b) {
  return stableStringify([...(a ?? [])].sort()) === stableStringify([...(b ?? [])].sort());
}

function settlementKey(row) {
  return `${row.match_id}|${row.market_key}|${row.selection}`;
}

function normalizedNextWeight(currentWeight) {
  return Number(Math.min(currentWeight * STAGED_WEIGHT_MAX_MULTIPLIER_PER_GOVERNED_STAGE, STAGED_WEIGHT_MAX_DECISION_WEIGHT).toFixed(12));
}

function validateManifestSettlementCohort({ activation, settlements, frozenAt }) {
  verifyStagedControlledProductionWeightActivation(activation);
  if (!Array.isArray(settlements)) throw new Error('STEP18_SETTLEMENT_ARRAY_REQUIRED');
  if (settlements.length < STAGED_WEIGHT_EVIDENCE_MIN_SETTLED_N) throw new Error('STEP18_MINIMUM_SETTLED_N_NOT_MET');
  const frozenMs = parseTimestamp('STEP18_MANIFEST_FROZEN_AT', frozenAt);
  const fingerprints = [];
  const keys = [];
  const seenFingerprints = new Set();
  const seenKeys = new Set();
  for (const settlement of settlements) {
    verifyStagedControlledProductionWeightSettlement(settlement);
    if (settlement.source_staged_activation_fingerprint !== activation.staged_controlled_production_weight_activation_fingerprint) {
      throw new Error('STEP18_SETTLEMENT_ACTIVATION_MISMATCH');
    }
    const fingerprint = settlement.staged_controlled_production_weight_settlement_fingerprint;
    const key = settlementKey(settlement);
    if (seenFingerprints.has(fingerprint)) throw new Error('STEP18_DUPLICATE_SETTLEMENT_FINGERPRINT');
    if (seenKeys.has(key)) throw new Error('STEP18_DUPLICATE_MATCH_MARKET_SELECTION');
    if (parseTimestamp('STEP18_SETTLED_AT', settlement.settled_at) >= frozenMs) {
      throw new Error('STEP18_MANIFEST_MUST_FOLLOW_ALL_INCLUDED_SETTLEMENTS');
    }
    seenFingerprints.add(fingerprint);
    seenKeys.add(key);
    fingerprints.push(fingerprint);
    keys.push(key);
  }
  return { fingerprints, keys };
}

export function freezeStep17StagedWeightEvidenceCohortManifest({ activation, settlements, frozenAt }) {
  const { fingerprints, keys } = validateManifestSettlementCohort({ activation, settlements, frozenAt });
  const payload = {
    manifest_version: STAGED_CONTROLLED_PRODUCTION_WEIGHT_EVIDENCE_GOVERNANCE_VERSION,
    state: 'STEP17_STAGED_WEIGHT_EVIDENCE_COHORT_MANIFEST_FROZEN_PRE_HEALTH',
    frozen_at: frozenAt,
    source_staged_activation_fingerprint: activation.staged_controlled_production_weight_activation_fingerprint,
    previous_stage_decision_weight: activation.production.previous_stage_decision_weight,
    staged_decision_weight: activation.production.staged_decision_weight,
    maximum_absolute_probability_shift: activation.production.maximum_absolute_probability_shift,
    settled_n: settlements.length,
    settlement_fingerprints_in_evaluation_order: fingerprints,
    settlement_fingerprint_set: [...fingerprints].sort(),
    match_market_selection_keys_in_evaluation_order: keys,
    match_market_selection_key_set: [...keys].sort(),
    governance: {
      manifest_precedes_health_evaluation_required: true,
      post_manifest_cohort_rewrite_allowed: false,
      historical_unbound_health_eligible: false,
      champion_replacement_authorized: false,
      capital_execution_allowed: false,
      gate6_capital_lock_preserved: true,
      real_money: 'NO'
    }
  };
  return deepFreeze({ ...payload, step17_staged_weight_evidence_cohort_manifest_fingerprint: sha256(payload) });
}

export function verifyStep17StagedWeightEvidenceCohortManifest(manifest) {
  if (!manifest || manifest.manifest_version !== STAGED_CONTROLLED_PRODUCTION_WEIGHT_EVIDENCE_GOVERNANCE_VERSION) {
    throw new Error('STEP18_MANIFEST_VERSION_INVALID');
  }
  fingerprintPayload(manifest, 'step17_staged_weight_evidence_cohort_manifest_fingerprint', 'STEP18_MANIFEST_FINGERPRINT_INVALID');
  if (manifest.state !== 'STEP17_STAGED_WEIGHT_EVIDENCE_COHORT_MANIFEST_FROZEN_PRE_HEALTH') throw new Error('STEP18_MANIFEST_STATE_INVALID');
  if (manifest.settled_n < STAGED_WEIGHT_EVIDENCE_MIN_SETTLED_N) throw new Error('STEP18_MANIFEST_MINIMUM_SETTLED_N_INVALID');
  const fps = manifest.settlement_fingerprints_in_evaluation_order ?? [];
  const keys = manifest.match_market_selection_keys_in_evaluation_order ?? [];
  if (fps.length !== manifest.settled_n || keys.length !== manifest.settled_n ||
      new Set(fps).size !== fps.length || new Set(keys).size !== keys.length) {
    throw new Error('STEP18_MANIFEST_COHORT_CARDINALITY_INVALID');
  }
  if (!exactArrayEqual([...fps].sort(), manifest.settlement_fingerprint_set) ||
      !exactArrayEqual([...keys].sort(), manifest.match_market_selection_key_set)) {
    throw new Error('STEP18_MANIFEST_ORDER_SET_BINDING_INVALID');
  }
  if (!(manifest.previous_stage_decision_weight > 0) || !(manifest.staged_decision_weight > manifest.previous_stage_decision_weight) ||
      manifest.staged_decision_weight > STAGED_WEIGHT_MAX_DECISION_WEIGHT ||
      manifest.maximum_absolute_probability_shift !== STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT) {
    throw new Error('STEP18_MANIFEST_WEIGHT_BOUNDARY_INVALID');
  }
  if (manifest.governance?.manifest_precedes_health_evaluation_required !== true ||
      manifest.governance?.post_manifest_cohort_rewrite_allowed !== false ||
      manifest.governance?.historical_unbound_health_eligible !== false ||
      manifest.governance?.champion_replacement_authorized !== false ||
      manifest.governance?.capital_execution_allowed !== false ||
      manifest.governance?.gate6_capital_lock_preserved !== true ||
      manifest.governance?.real_money !== 'NO') {
    throw new Error('STEP18_MANIFEST_GOVERNANCE_INVALID');
  }
  return true;
}

export function freezeStagedControlledProductionWeightEvidenceReview({
  activation,
  healthEvaluation,
  evidenceManifest,
  settlements,
  reviewedAt,
  reviewedBy,
  rationale
}) {
  verifyStagedControlledProductionWeightActivation(activation);
  verifyStagedControlledProductionWeightHealth(healthEvaluation);
  verifyStep17StagedWeightEvidenceCohortManifest(evidenceManifest);
  if (!reviewedBy || !String(reviewedBy).trim()) throw new Error('STEP18_REVIEWED_BY_REQUIRED');
  if (!rationale || !String(rationale).trim()) throw new Error('STEP18_REVIEW_RATIONALE_REQUIRED');
  const manifestMs = parseTimestamp('STEP18_MANIFEST_FROZEN_AT', evidenceManifest.frozen_at);
  const healthMs = parseTimestamp('STEP18_HEALTH_EVALUATED_AT', healthEvaluation.evaluated_at);
  const reviewedMs = parseTimestamp('STEP18_REVIEWED_AT', reviewedAt);
  if (manifestMs >= healthMs) throw new Error('STEP18_PRE_HEALTH_MANIFEST_REQUIRED');
  if (reviewedMs <= healthMs) throw new Error('STEP18_REVIEW_MUST_FOLLOW_HEALTH_EVALUATION');
  if (healthEvaluation.source_staged_activation_fingerprint !== activation.staged_controlled_production_weight_activation_fingerprint ||
      evidenceManifest.source_staged_activation_fingerprint !== activation.staged_controlled_production_weight_activation_fingerprint) {
    throw new Error('STEP18_ACTIVATION_LINEAGE_MISMATCH');
  }
  if (healthEvaluation.state !== 'STAGED_CONTROLLED_WEIGHT_HEALTHY_CONTINUE_CAPITAL_LOCKED' ||
      healthEvaluation.rollback_required !== false ||
      healthEvaluation.next_stage !== 'STEP_18_STAGED_CONTROLLED_PRODUCTION_WEIGHT_EVIDENCE_REVIEW_AND_GOVERNANCE' ||
      Object.values(healthEvaluation.gates ?? {}).some(value => value !== true)) {
    throw new Error('STEP18_EXACT_HEALTHY_STEP17_EVIDENCE_REQUIRED');
  }
  if (healthEvaluation.settled_n !== evidenceManifest.settled_n ||
      evidenceManifest.previous_stage_decision_weight !== activation.production.previous_stage_decision_weight ||
      evidenceManifest.staged_decision_weight !== activation.production.staged_decision_weight) {
    throw new Error('STEP18_MANIFEST_HEALTH_CARDINALITY_OR_WEIGHT_MISMATCH');
  }
  if (!Array.isArray(settlements) || settlements.length !== evidenceManifest.settled_n) {
    throw new Error('STEP18_EXACT_MANIFEST_BOUND_SETTLEMENT_ARRAY_REQUIRED');
  }
  const fingerprints = [];
  const keys = [];
  for (const settlement of settlements) {
    verifyStagedControlledProductionWeightSettlement(settlement);
    if (settlement.source_staged_activation_fingerprint !== activation.staged_controlled_production_weight_activation_fingerprint) {
      throw new Error('STEP18_REVIEW_SETTLEMENT_ACTIVATION_MISMATCH');
    }
    if (parseTimestamp('STEP18_REVIEW_SETTLED_AT', settlement.settled_at) >= manifestMs) {
      throw new Error('STEP18_POST_MANIFEST_SETTLEMENT_FORBIDDEN');
    }
    fingerprints.push(settlement.staged_controlled_production_weight_settlement_fingerprint);
    keys.push(settlementKey(settlement));
  }
  if (!exactArrayEqual(fingerprints, evidenceManifest.settlement_fingerprints_in_evaluation_order) ||
      !exactStringSetEqual(fingerprints, evidenceManifest.settlement_fingerprint_set) ||
      !exactArrayEqual(keys, evidenceManifest.match_market_selection_keys_in_evaluation_order) ||
      !exactStringSetEqual(keys, evidenceManifest.match_market_selection_key_set)) {
    throw new Error('STEP18_MANIFEST_BOUND_COHORT_REPRODUCTION_FAILED');
  }
  const reproducedHealth = evaluateStagedControlledProductionWeightHealth({
    activation,
    settlements,
    evaluatedAt: healthEvaluation.evaluated_at,
    integritySignals: healthEvaluation.integrity_signals
  });
  verifyStagedControlledProductionWeightHealth(reproducedHealth);
  if (reproducedHealth.staged_controlled_production_weight_health_fingerprint !== healthEvaluation.staged_controlled_production_weight_health_fingerprint) {
    throw new Error('STEP18_EXACT_STEP17_HEALTH_REPRODUCTION_FAILED');
  }

  const nextWeightCeiling = normalizedNextWeight(activation.production.staged_decision_weight);
  const furtherIncreaseEligible = nextWeightCeiling > activation.production.staged_decision_weight + 1e-12;
  const payload = {
    review_version: STAGED_CONTROLLED_PRODUCTION_WEIGHT_EVIDENCE_GOVERNANCE_VERSION,
    state: 'STAGED_CONTROLLED_WEIGHT_EVIDENCE_REVIEW_PASS_MANUAL_GOVERNANCE_ELIGIBLE',
    reviewed_at: reviewedAt,
    reviewed_by: String(reviewedBy).trim(),
    rationale: String(rationale).trim(),
    source_staged_activation_fingerprint: activation.staged_controlled_production_weight_activation_fingerprint,
    source_health_fingerprint: healthEvaluation.staged_controlled_production_weight_health_fingerprint,
    source_evidence_manifest_fingerprint: evidenceManifest.step17_staged_weight_evidence_cohort_manifest_fingerprint,
    evidence: {
      settled_n: healthEvaluation.settled_n,
      manifest_bound: true,
      exact_health_reproduced: true,
      champion_metrics: healthEvaluation.champion,
      previous_stage_metrics: healthEvaluation.previous_stage,
      staged_metrics: healthEvaluation.staged,
      health_gates: healthEvaluation.gates,
      integrity_signals: healthEvaluation.integrity_signals
    },
    current_stage: {
      previous_stage_decision_weight: activation.production.previous_stage_decision_weight,
      staged_decision_weight: activation.production.staged_decision_weight,
      maximum_absolute_probability_shift: activation.production.maximum_absolute_probability_shift,
      champion_remains_primary_fallback: true,
      capital_execution_allowed: false
    },
    proposed_boundary: {
      maximum_next_decision_weight: nextWeightCeiling,
      absolute_maximum_staged_decision_weight: STAGED_WEIGHT_MAX_DECISION_WEIGHT,
      maximum_weight_multiplier_per_governed_stage: STAGED_WEIGHT_MAX_MULTIPLIER_PER_GOVERNED_STAGE,
      maximum_absolute_probability_shift: STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT,
      further_weight_increase_eligible: furtherIncreaseEligible,
      authorization_above_absolute_maximum_allowed: false,
      probability_shift_cap_increased: false,
      weight_change_applied_here: false
    },
    eligible_for_manual_governance: true,
    evaluation_firewall: {
      historical_unbound_step17_health_eligible: false,
      evidence_reuse_for_training: false,
      evidence_reuse_for_retuning: false,
      automatic_weight_increase_from_metrics: false,
      additional_alpha_spent: false
    },
    governance: {
      automatic_weight_increase: false,
      automatic_retuning: false,
      champion_replacement_authorized: false,
      capital_execution_allowed: false,
      gate6_capital_lock_preserved: true,
      p002_changed: false,
      gate1_to_gate6_ownership_changed: false,
      capital_effect: 'NONE',
      real_money: 'NO'
    }
  };
  return deepFreeze({ ...payload, staged_controlled_weight_evidence_review_fingerprint: sha256(payload) });
}

export function verifyStagedControlledProductionWeightEvidenceReview(review) {
  if (!review || review.review_version !== STAGED_CONTROLLED_PRODUCTION_WEIGHT_EVIDENCE_GOVERNANCE_VERSION) {
    throw new Error('STEP18_REVIEW_VERSION_INVALID');
  }
  fingerprintPayload(review, 'staged_controlled_weight_evidence_review_fingerprint', 'STEP18_REVIEW_FINGERPRINT_INVALID');
  if (review.state !== 'STAGED_CONTROLLED_WEIGHT_EVIDENCE_REVIEW_PASS_MANUAL_GOVERNANCE_ELIGIBLE' ||
      review.eligible_for_manual_governance !== true || review.evidence?.manifest_bound !== true ||
      review.evidence?.exact_health_reproduced !== true || review.evidence?.settled_n < STAGED_WEIGHT_EVIDENCE_MIN_SETTLED_N) {
    throw new Error('STEP18_REVIEW_ELIGIBILITY_INVALID');
  }
  const current = review.current_stage?.staged_decision_weight;
  if (!(review.current_stage?.previous_stage_decision_weight > 0) || !(current > review.current_stage.previous_stage_decision_weight) ||
      current > STAGED_WEIGHT_MAX_DECISION_WEIGHT ||
      review.current_stage?.maximum_absolute_probability_shift !== STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT ||
      review.current_stage?.capital_execution_allowed !== false) {
    throw new Error('STEP18_REVIEW_CURRENT_STAGE_BOUNDARY_INVALID');
  }
  const expectedCeiling = normalizedNextWeight(current);
  const expectedEligibility = expectedCeiling > current + 1e-12;
  if (review.proposed_boundary?.maximum_next_decision_weight !== expectedCeiling ||
      review.proposed_boundary?.absolute_maximum_staged_decision_weight !== STAGED_WEIGHT_MAX_DECISION_WEIGHT ||
      review.proposed_boundary?.maximum_weight_multiplier_per_governed_stage !== STAGED_WEIGHT_MAX_MULTIPLIER_PER_GOVERNED_STAGE ||
      review.proposed_boundary?.maximum_absolute_probability_shift !== STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT ||
      review.proposed_boundary?.further_weight_increase_eligible !== expectedEligibility ||
      review.proposed_boundary?.authorization_above_absolute_maximum_allowed !== false ||
      review.proposed_boundary?.probability_shift_cap_increased !== false ||
      review.proposed_boundary?.weight_change_applied_here !== false) {
    throw new Error('STEP18_REVIEW_NEXT_WEIGHT_BOUNDARY_INVALID');
  }
  if (review.evaluation_firewall?.historical_unbound_step17_health_eligible !== false ||
      review.evaluation_firewall?.evidence_reuse_for_training !== false || review.evaluation_firewall?.evidence_reuse_for_retuning !== false ||
      review.evaluation_firewall?.automatic_weight_increase_from_metrics !== false || review.evaluation_firewall?.additional_alpha_spent !== false ||
      review.governance?.automatic_weight_increase !== false || review.governance?.automatic_retuning !== false ||
      review.governance?.champion_replacement_authorized !== false || review.governance?.capital_execution_allowed !== false ||
      review.governance?.gate6_capital_lock_preserved !== true || review.governance?.real_money !== 'NO') {
    throw new Error('STEP18_REVIEW_GOVERNANCE_INVALID');
  }
  return true;
}

export function recordStagedControlledProductionWeightGovernanceDecision({
  activation,
  evidenceReview,
  decision,
  governor,
  rationale,
  decidedAt
}) {
  verifyStagedControlledProductionWeightActivation(activation);
  verifyStagedControlledProductionWeightEvidenceReview(evidenceReview);
  if (!DECISION_SET.has(decision)) throw new Error('STEP18_WEIGHT_GOVERNANCE_DECISION_INVALID');
  if (!governor || !String(governor).trim()) throw new Error('STEP18_GOVERNOR_REQUIRED');
  if (!rationale || !String(rationale).trim()) throw new Error('STEP18_DECISION_RATIONALE_REQUIRED');
  const decidedMs = parseTimestamp('STEP18_DECIDED_AT', decidedAt);
  if (decidedMs <= parseTimestamp('STEP18_REVIEWED_AT', evidenceReview.reviewed_at)) throw new Error('STEP18_DECISION_MUST_FOLLOW_REVIEW');
  if (evidenceReview.source_staged_activation_fingerprint !== activation.staged_controlled_production_weight_activation_fingerprint ||
      evidenceReview.current_stage.staged_decision_weight !== activation.production.staged_decision_weight) {
    throw new Error('STEP18_DECISION_ACTIVATION_REVIEW_MISMATCH');
  }

  let state;
  let enforcement;
  let rollback = null;
  let nextStage = null;
  if (decision === 'AUTHORIZE_NEXT_STAGED_WEIGHT_STAGE_NOT_APPLIED') {
    if (evidenceReview.proposed_boundary.further_weight_increase_eligible !== true ||
        evidenceReview.proposed_boundary.maximum_next_decision_weight <= activation.production.staged_decision_weight) {
      throw new Error('STEP18_MAX_STAGED_WEIGHT_BOUNDARY_REACHED');
    }
    state = 'NEXT_STAGED_CONTROLLED_PRODUCTION_WEIGHT_STAGE_AUTHORIZED_NOT_APPLIED';
    enforcement = {
      current_staged_decision_weight: activation.production.staged_decision_weight,
      production_decision_weight_after_step18: activation.production.staged_decision_weight,
      authorized_maximum_next_stage_decision_weight: evidenceReview.proposed_boundary.maximum_next_decision_weight,
      absolute_maximum_staged_decision_weight: STAGED_WEIGHT_MAX_DECISION_WEIGHT,
      weight_change_applied_here: false,
      maximum_absolute_probability_shift: STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT,
      probability_shift_cap_increased: false,
      champion_unchanged: true,
      capital_execution_allowed: false
    };
    nextStage = 'STEP_19_NEXT_STAGED_CONTROLLED_PRODUCTION_WEIGHT_ACTIVATION_AND_MONITORING';
  } else if (decision === 'HOLD_CURRENT_STAGED_WEIGHT') {
    state = 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_HELD_CURRENT_STAGE';
    enforcement = {
      current_staged_decision_weight: activation.production.staged_decision_weight,
      production_decision_weight_after_step18: activation.production.staged_decision_weight,
      authorized_maximum_next_stage_decision_weight: activation.production.staged_decision_weight,
      absolute_maximum_staged_decision_weight: STAGED_WEIGHT_MAX_DECISION_WEIGHT,
      weight_change_applied_here: false,
      maximum_absolute_probability_shift: STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT,
      probability_shift_cap_increased: false,
      champion_unchanged: true,
      capital_execution_allowed: false,
      new_pre_health_manifest_and_health_review_required_before_future_increase: true
    };
    nextStage = 'REPEAT_STEP18_WITH_NEW_PRE_HEALTH_MANIFEST_AND_HEALTH_EVIDENCE';
  } else {
    state = 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_RETIRED_CHAMPION_ONLY';
    rollback = recordStagedControlledProductionWeightRollback({
      activation,
      reason: 'MANUAL_KILL_SWITCH',
      actor: String(governor).trim(),
      rationale: String(rationale).trim(),
      rolledBackAt: decidedAt
    });
    verifyStagedControlledProductionWeightRollback(rollback);
    enforcement = {
      current_staged_decision_weight: activation.production.staged_decision_weight,
      production_decision_weight_after_step18: 0,
      authorized_maximum_next_stage_decision_weight: 0,
      absolute_maximum_staged_decision_weight: STAGED_WEIGHT_MAX_DECISION_WEIGHT,
      weight_change_applied_here: false,
      maximum_absolute_probability_shift: 0,
      probability_influence_after_retirement: 0,
      champion_unchanged: true,
      rollback_target: 'CHAMPION_ONLY',
      same_step17_activation_reactivation_allowed: false,
      capital_execution_allowed: false
    };
  }

  const payload = {
    decision_version: STAGED_CONTROLLED_PRODUCTION_WEIGHT_EVIDENCE_GOVERNANCE_VERSION,
    state,
    decision,
    decided_at: decidedAt,
    governor: String(governor).trim(),
    rationale: String(rationale).trim(),
    source_staged_activation_fingerprint: activation.staged_controlled_production_weight_activation_fingerprint,
    source_evidence_review_fingerprint: evidenceReview.staged_controlled_weight_evidence_review_fingerprint,
    source_health_fingerprint: evidenceReview.source_health_fingerprint,
    source_evidence_manifest_fingerprint: evidenceReview.source_evidence_manifest_fingerprint,
    enforcement,
    rollback,
    governance: {
      automatic_weight_increase: false,
      weight_activation_performed_here: false,
      automatic_retuning: false,
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
  return deepFreeze({ ...payload, staged_controlled_weight_governance_decision_fingerprint: sha256(payload) });
}

export function verifyStagedControlledProductionWeightGovernanceDecision(row) {
  if (!row || row.decision_version !== STAGED_CONTROLLED_PRODUCTION_WEIGHT_EVIDENCE_GOVERNANCE_VERSION) {
    throw new Error('STEP18_DECISION_VERSION_INVALID');
  }
  fingerprintPayload(row, 'staged_controlled_weight_governance_decision_fingerprint', 'STEP18_DECISION_FINGERPRINT_INVALID');
  if (!DECISION_SET.has(row.decision)) throw new Error('STEP18_DECISION_VALUE_INVALID');
  if (row.governance?.automatic_weight_increase !== false || row.governance?.weight_activation_performed_here !== false ||
      row.governance?.automatic_retuning !== false || row.governance?.champion_replacement_authorized !== false ||
      row.governance?.capital_execution_allowed !== false || row.governance?.gate6_capital_lock_preserved !== true ||
      row.governance?.real_money !== 'NO') {
    throw new Error('STEP18_DECISION_GOVERNANCE_INVALID');
  }
  if (row.decision === 'AUTHORIZE_NEXT_STAGED_WEIGHT_STAGE_NOT_APPLIED') {
    if (row.state !== 'NEXT_STAGED_CONTROLLED_PRODUCTION_WEIGHT_STAGE_AUTHORIZED_NOT_APPLIED' ||
        row.enforcement?.production_decision_weight_after_step18 !== row.enforcement?.current_staged_decision_weight ||
        row.enforcement?.authorized_maximum_next_stage_decision_weight <= row.enforcement?.current_staged_decision_weight ||
        row.enforcement?.authorized_maximum_next_stage_decision_weight > STAGED_WEIGHT_MAX_DECISION_WEIGHT ||
        row.enforcement?.weight_change_applied_here !== false ||
        row.enforcement?.maximum_absolute_probability_shift !== STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT ||
        row.enforcement?.probability_shift_cap_increased !== false || row.enforcement?.capital_execution_allowed !== false ||
        row.next_stage !== 'STEP_19_NEXT_STAGED_CONTROLLED_PRODUCTION_WEIGHT_ACTIVATION_AND_MONITORING' || row.rollback !== null) {
      throw new Error('STEP18_AUTHORIZATION_BOUNDARY_INVALID');
    }
  } else if (row.decision === 'HOLD_CURRENT_STAGED_WEIGHT') {
    if (row.state !== 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_HELD_CURRENT_STAGE' ||
        row.enforcement?.production_decision_weight_after_step18 !== row.enforcement?.current_staged_decision_weight ||
        row.enforcement?.authorized_maximum_next_stage_decision_weight !== row.enforcement?.current_staged_decision_weight ||
        row.enforcement?.new_pre_health_manifest_and_health_review_required_before_future_increase !== true ||
        row.enforcement?.capital_execution_allowed !== false || row.rollback !== null) {
      throw new Error('STEP18_HOLD_BOUNDARY_INVALID');
    }
  } else {
    verifyStagedControlledProductionWeightRollback(row.rollback);
    if (row.state !== 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_RETIRED_CHAMPION_ONLY' ||
        row.rollback.source_staged_activation_fingerprint !== row.source_staged_activation_fingerprint ||
        row.enforcement?.production_decision_weight_after_step18 !== 0 ||
        row.enforcement?.authorized_maximum_next_stage_decision_weight !== 0 ||
        row.enforcement?.probability_influence_after_retirement !== 0 ||
        row.enforcement?.rollback_target !== 'CHAMPION_ONLY' ||
        row.enforcement?.same_step17_activation_reactivation_allowed !== false ||
        row.enforcement?.capital_execution_allowed !== false || row.next_stage !== null) {
      throw new Error('STEP18_RETIREMENT_BOUNDARY_INVALID');
    }
  }
  return true;
}
