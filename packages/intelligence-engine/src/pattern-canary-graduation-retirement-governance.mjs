import { createHash } from 'node:crypto';
import { verifyControlledPatternCanaryAuthorization } from './controlled-pattern-canary-activation-rollback.mjs';
import { verifyPatternCanaryExpansionDecision } from './pattern-canary-expansion-rejection-governance.mjs';
import {
  verifyStagedPatternCanaryExpansionActivation,
  verifyStagedPatternCanaryHealth,
  verifyStagedPatternCanarySettlement,
  evaluateStagedPatternCanaryHealth,
  recordStagedPatternCanaryRollback
} from './staged-pattern-canary-expansion-activation-monitoring.mjs';

export const PATTERN_CANARY_GRADUATION_GOVERNANCE_VERSION = 'PATTERN_CANARY_GRADUATION_RETIREMENT_GOVERNANCE_V0_1';
export const GRADUATION_MIN_FULL_STAGE_SETTLED_N = 30;
export const GRADUATION_MIN_EXPANSION_BAND_SETTLED_N = 30;

const DECISIONS = new Set([
  'GRADUATE_TO_ZERO_WEIGHT_CHALLENGER_CANDIDATE',
  'HOLD_STAGED_CANARY',
  'RETIRE_PATTERN_CANARY'
]);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(stableStringify(value)).digest('hex'); }
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const v of Object.values(value)) deepFreeze(v);
  return value;
}
function parseTimestamp(name, value) {
  const ms = Date.parse(value);
  if (!value || Number.isNaN(ms)) throw new Error(`${name}_INVALID_TIMESTAMP`);
  return ms;
}
function sorted(values) { return [...values].sort(); }
function keyOf(row) { return `${row.match_id}|${row.market_key}|${row.selection}`; }
function fingerprintPayload(row, field, error) {
  const { [field]: fp, ...payload } = row ?? {};
  if (!fp || sha256(payload) !== fp) throw new Error(error);
  return true;
}

function verifyExactGraduationLineage({ step10Authorization, step11Decision, step12Activation, step12Health }) {
  verifyControlledPatternCanaryAuthorization(step10Authorization);
  verifyPatternCanaryExpansionDecision(step11Decision);
  verifyStagedPatternCanaryExpansionActivation(step12Activation);
  verifyStagedPatternCanaryHealth(step12Health);

  if (step11Decision.state !== 'NEXT_CANARY_STAGE_APPROVED_NOT_ACTIVATED' || step11Decision.decision !== 'APPROVE_NEXT_CANARY_STAGE') {
    throw new Error('STEP13_APPROVED_STEP11_EXPANSION_DECISION_REQUIRED');
  }
  if (step11Decision.canary_authorization_fingerprint !== step10Authorization.canary_authorization_fingerprint) {
    throw new Error('STEP13_STEP11_STEP10_AUTHORIZATION_MISMATCH');
  }
  if (step12Activation.source_step10_canary_authorization_fingerprint !== step10Authorization.canary_authorization_fingerprint) {
    throw new Error('STEP13_STEP12_STEP10_AUTHORIZATION_MISMATCH');
  }
  if (step12Activation.source_step11_expansion_decision_fingerprint !== step11Decision.expansion_decision_fingerprint) {
    throw new Error('STEP13_STEP12_STEP11_DECISION_MISMATCH');
  }
  if (step12Health.staged_activation_fingerprint !== step12Activation.staged_activation_fingerprint) {
    throw new Error('STEP13_STEP12_HEALTH_ACTIVATION_MISMATCH');
  }
  if (step12Activation.source_shadow_plan_fingerprint !== step10Authorization.source_shadow_plan_fingerprint) {
    throw new Error('STEP13_SHADOW_PLAN_LINEAGE_DRIFT');
  }
  if (step12Activation.calibration_version !== (step10Authorization.calibration_version ?? null) ||
      step12Activation.calibration_provenance !== (step10Authorization.calibration_provenance ?? null)) {
    throw new Error('STEP13_CALIBRATION_LINEAGE_DRIFT');
  }
  if (step12Activation.routing.seed !== step10Authorization.routing.seed ||
      step12Activation.routing.method !== step10Authorization.routing.method) {
    throw new Error('STEP13_ROUTING_LINEAGE_DRIFT');
  }
  return true;
}

export function freezePatternCanaryGraduationDossier({
  step10Authorization,
  step11Decision,
  step12Activation,
  step12Health,
  settlements,
  frozenAt
}) {
  verifyExactGraduationLineage({ step10Authorization, step11Decision, step12Activation, step12Health });
  if (!Array.isArray(settlements)) throw new Error('STEP13_SETTLEMENT_ARRAY_REQUIRED');
  if (step12Health.state !== 'STAGED_CANARY_HEALTHY_CONTINUE_PAPER_ONLY' || step12Health.rollback_required !== false) {
    throw new Error('STEP13_HEALTHY_STEP12_REQUIRED');
  }
  if (!Object.values(step12Health.gates ?? {}).every(Boolean)) throw new Error('STEP13_ALL_STEP12_HEALTH_GATES_REQUIRED');
  if (step12Health.new_stage_routed_settled_n < GRADUATION_MIN_FULL_STAGE_SETTLED_N ||
      step12Health.expansion_band_routed_settled_n < GRADUATION_MIN_EXPANSION_BAND_SETTLED_N) {
    throw new Error('STEP13_MINIMUM_STEP12_EVIDENCE_REQUIRED');
  }
  if (settlements.length !== step12Health.new_stage_routed_settled_n) throw new Error('STEP13_EXACT_STEP12_SETTLEMENT_COHORT_REQUIRED');

  const seen = new Set();
  let expansionBandN = 0;
  for (const settlement of settlements) {
    verifyStagedPatternCanarySettlement(settlement);
    if (settlement.source_staged_activation_fingerprint !== step12Activation.staged_activation_fingerprint) {
      throw new Error('STEP13_SETTLEMENT_ACTIVATION_MISMATCH');
    }
    const key = keyOf(settlement);
    if (seen.has(key)) throw new Error('STEP13_DUPLICATE_MATCH_MARKET_SELECTION');
    seen.add(key);
    if (settlement.routing_band === 'EXPANSION_BAND') expansionBandN += 1;
  }
  if (expansionBandN !== step12Health.expansion_band_routed_settled_n) throw new Error('STEP13_EXPANSION_BAND_COHORT_MISMATCH');

  const reproducedHealth = evaluateStagedPatternCanaryHealth({
    activation: step12Activation,
    settlements,
    evaluatedAt: step12Health.evaluated_at,
    integritySignals: step12Health.integrity_signals ?? []
  });
  if (reproducedHealth.staged_health_fingerprint !== step12Health.staged_health_fingerprint) {
    throw new Error('STEP13_STEP12_HEALTH_REPRODUCTION_FAILED');
  }

  const frozenMs = parseTimestamp('STEP13_FROZEN_AT', frozenAt);
  if (frozenMs <= parseTimestamp('STEP13_STEP12_HEALTH_EVALUATED_AT', step12Health.evaluated_at)) {
    throw new Error('STEP13_DOSSIER_FREEZE_MUST_FOLLOW_STEP12_HEALTH');
  }

  const payload = {
    dossier_version: PATTERN_CANARY_GRADUATION_GOVERNANCE_VERSION,
    state: 'ELIGIBLE_FOR_MANUAL_GRADUATION_HOLD_OR_RETIREMENT_ZERO_WEIGHT',
    frozen_at: frozenAt,
    source_step10_canary_authorization_fingerprint: step10Authorization.canary_authorization_fingerprint,
    source_step11_expansion_decision_fingerprint: step11Decision.expansion_decision_fingerprint,
    source_step12_activation_fingerprint: step12Activation.staged_activation_fingerprint,
    source_step12_health_fingerprint: step12Health.staged_health_fingerprint,
    source_shadow_plan_fingerprint: step12Activation.source_shadow_plan_fingerprint,
    approved_pattern_ids: sorted(step10Authorization.approved_pattern_ids ?? []),
    calibration: {
      version: step12Activation.calibration_version ?? null,
      provenance: step12Activation.calibration_provenance ?? null
    },
    routing_lineage: {
      method: step12Activation.routing.method,
      seed: step12Activation.routing.seed,
      previous_fraction: step12Activation.routing.previous_fraction,
      staged_fraction: step12Activation.routing.active_fraction
    },
    influence: {
      maximum_absolute_probability_shift: step12Activation.influence.maximum_absolute_probability_shift
    },
    evidence: {
      full_stage_routed_settled_n: settlements.length,
      expansion_band_routed_settled_n: expansionBandN,
      settlement_fingerprints: sorted(settlements.map(s => s.staged_settlement_fingerprint)),
      full_stage: step12Health.full_stage,
      expansion_band: step12Health.expansion_band,
      all_step12_health_gates_passed: true,
      step12_health_reproduced_exactly: true,
      additional_alpha_spent: false
    },
    governance: {
      manual_decision_required: true,
      production_decision_weight: 0,
      production_mutation_allowed: false,
      champion_replacement_authorized: false,
      capital_execution_allowed: false,
      automatic_full_promotion: false,
      automatic_retuning: false,
      post_freeze_evidence_rewrites_dossier: false,
      gate6_capital_lock_preserved: true,
      p002_changed: false,
      gate1_to_gate6_ownership_changed: false,
      capital_effect: 'NONE',
      real_money: 'NO'
    }
  };
  return deepFreeze({ ...payload, graduation_dossier_fingerprint: sha256(payload) });
}

export function verifyPatternCanaryGraduationDossier(dossier) {
  if (!dossier || dossier.dossier_version !== PATTERN_CANARY_GRADUATION_GOVERNANCE_VERSION) throw new Error('STEP13_DOSSIER_VERSION_INVALID');
  fingerprintPayload(dossier, 'graduation_dossier_fingerprint', 'STEP13_DOSSIER_FINGERPRINT_INVALID');
  if (dossier.state !== 'ELIGIBLE_FOR_MANUAL_GRADUATION_HOLD_OR_RETIREMENT_ZERO_WEIGHT') throw new Error('STEP13_DOSSIER_STATE_INVALID');
  if (dossier.evidence?.full_stage_routed_settled_n < GRADUATION_MIN_FULL_STAGE_SETTLED_N ||
      dossier.evidence?.expansion_band_routed_settled_n < GRADUATION_MIN_EXPANSION_BAND_SETTLED_N ||
      dossier.evidence?.step12_health_reproduced_exactly !== true) throw new Error('STEP13_DOSSIER_EVIDENCE_INVALID');
  if (dossier.governance?.production_decision_weight !== 0 ||
      dossier.governance?.champion_replacement_authorized !== false ||
      dossier.governance?.capital_execution_allowed !== false ||
      dossier.governance?.real_money !== 'NO') throw new Error('STEP13_DOSSIER_GOVERNANCE_INVALID');
  return true;
}

export function recordPatternCanaryGraduationDecision({
  dossier,
  step12Activation,
  step12Health,
  decision,
  approver,
  rationale,
  decidedAt
}) {
  verifyPatternCanaryGraduationDossier(dossier);
  verifyStagedPatternCanaryExpansionActivation(step12Activation);
  verifyStagedPatternCanaryHealth(step12Health);
  if (!DECISIONS.has(decision)) throw new Error('STEP13_GOVERNANCE_DECISION_INVALID');
  if (dossier.source_step12_activation_fingerprint !== step12Activation.staged_activation_fingerprint) throw new Error('STEP13_DECISION_ACTIVATION_MISMATCH');
  if (dossier.source_step12_health_fingerprint !== step12Health.staged_health_fingerprint) throw new Error('STEP13_DECISION_HEALTH_MISMATCH');
  if (step12Health.state !== 'STAGED_CANARY_HEALTHY_CONTINUE_PAPER_ONLY' || step12Health.rollback_required !== false) throw new Error('STEP13_DECISION_REQUIRES_HEALTHY_STEP12');
  if (!approver || !String(approver).trim()) throw new Error('STEP13_APPROVER_REQUIRED');
  if (!rationale || !String(rationale).trim()) throw new Error('STEP13_DECISION_RATIONALE_REQUIRED');
  const decidedMs = parseTimestamp('STEP13_DECIDED_AT', decidedAt);
  if (decidedMs <= parseTimestamp('STEP13_DOSSIER_FROZEN_AT', dossier.frozen_at)) throw new Error('STEP13_DECISION_MUST_FOLLOW_DOSSIER_FREEZE');

  let state;
  let rollback = null;
  let candidate = null;
  let nextStage;
  let step12MayContinue = false;

  if (decision === 'GRADUATE_TO_ZERO_WEIGHT_CHALLENGER_CANDIDATE') {
    state = 'PATTERN_GRADUATED_ZERO_WEIGHT_CHALLENGER_CANDIDATE_NOT_PRODUCTION_ACTIVATED';
    candidate = {
      state: 'ZERO_WEIGHT_CHALLENGER_CANDIDATE_NOT_PRODUCTION_ACTIVATED',
      decision_weight: 0,
      approved_pattern_ids: dossier.approved_pattern_ids,
      source_shadow_plan_fingerprint: dossier.source_shadow_plan_fingerprint,
      source_graduation_dossier_fingerprint: dossier.graduation_dossier_fingerprint,
      calibration: dossier.calibration,
      champion_replacement_authorized: false,
      production_activation_authorized: false,
      capital_use_authorized: false
    };
    nextStage = 'STEP_14_ZERO_WEIGHT_CHALLENGER_PROMOTION_AUTHORIZATION_AND_PRODUCTION_SAFETY_REVIEW';
  } else if (decision === 'HOLD_STAGED_CANARY') {
    state = 'STAGED_CANARY_HELD_AT_STEP12_AWAITING_NEW_EVIDENCE';
    step12MayContinue = true;
    nextStage = 'CONTINUE_STEP12_STAGED_CANARY_MONITORING_AND_REQUIRE_NEW_DOSSIER_FOR_LATER_DECISION';
  } else {
    rollback = recordStagedPatternCanaryRollback({
      activation: step12Activation,
      healthEvaluation: step12Health,
      reason: 'MANUAL_KILL_SWITCH',
      actor: String(approver).trim(),
      rationale: String(rationale).trim(),
      rolledBackAt: decidedAt
    });
    state = 'PATTERN_CANARY_RETIRED_CHAMPION_ONLY';
    nextStage = 'PATTERN_RETIRED_REQUIRES_NEW_GOVERNED_LINEAGE_FOR_FUTURE_ATTEMPT';
  }

  const payload = {
    decision_version: PATTERN_CANARY_GRADUATION_GOVERNANCE_VERSION,
    state,
    decision,
    approver: String(approver).trim(),
    rationale: String(rationale).trim(),
    decided_at: decidedAt,
    graduation_dossier_fingerprint: dossier.graduation_dossier_fingerprint,
    source_step12_activation_fingerprint: step12Activation.staged_activation_fingerprint,
    source_step12_health_fingerprint: step12Health.staged_health_fingerprint,
    candidate,
    rollback_fingerprint: rollback?.staged_rollback_fingerprint ?? null,
    enforcement: {
      step12_staged_canary_may_continue: step12MayContinue,
      routing_fraction_may_increase_here: false,
      probability_influence_may_increase_here: false,
      retirement_routing_fraction: decision === 'RETIRE_PATTERN_CANARY' ? 0 : null,
      retirement_probability_influence: decision === 'RETIRE_PATTERN_CANARY' ? 0 : null
    },
    governance: {
      graduation_is_production_activation: false,
      production_decision_weight: 0,
      production_mutation_allowed: false,
      champion_replacement_authorized: false,
      capital_execution_allowed: false,
      automatic_promotion: false,
      automatic_retuning: false,
      gate6_capital_lock_preserved: true,
      capital_effect: 'NONE',
      real_money: 'NO'
    },
    next_stage: nextStage
  };
  return deepFreeze({ ...payload, graduation_decision_fingerprint: sha256(payload) });
}

export function verifyPatternCanaryGraduationDecision(decision) {
  if (!decision || decision.decision_version !== PATTERN_CANARY_GRADUATION_GOVERNANCE_VERSION) throw new Error('STEP13_DECISION_VERSION_INVALID');
  fingerprintPayload(decision, 'graduation_decision_fingerprint', 'STEP13_DECISION_FINGERPRINT_INVALID');
  if (!DECISIONS.has(decision.decision)) throw new Error('STEP13_DECISION_VALUE_INVALID');
  if (decision.governance?.graduation_is_production_activation !== false ||
      decision.governance?.production_decision_weight !== 0 ||
      decision.governance?.champion_replacement_authorized !== false ||
      decision.governance?.capital_execution_allowed !== false ||
      decision.governance?.real_money !== 'NO') throw new Error('STEP13_DECISION_GOVERNANCE_INVALID');
  if (decision.decision === 'GRADUATE_TO_ZERO_WEIGHT_CHALLENGER_CANDIDATE') {
    if (decision.candidate?.decision_weight !== 0 ||
        decision.candidate?.production_activation_authorized !== false ||
        decision.candidate?.champion_replacement_authorized !== false ||
        decision.rollback_fingerprint !== null) throw new Error('STEP13_GRADUATION_BOUNDARY_INVALID');
  }
  if (decision.decision === 'HOLD_STAGED_CANARY' && decision.enforcement?.step12_staged_canary_may_continue !== true) {
    throw new Error('STEP13_HOLD_BOUNDARY_INVALID');
  }
  if (decision.decision === 'RETIRE_PATTERN_CANARY') {
    if (!decision.rollback_fingerprint || decision.enforcement?.retirement_routing_fraction !== 0 || decision.enforcement?.retirement_probability_influence !== 0) {
      throw new Error('STEP13_RETIREMENT_ROLLBACK_REQUIRED');
    }
  }
  return true;
}
