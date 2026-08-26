import { createHash } from 'node:crypto';
import {
  verifyControlledPatternCanaryAuthorization,
  verifyControlledPatternCanaryHealth,
  verifyControlledPatternCanaryDecision,
  verifyControlledPatternCanarySettlement,
  evaluateControlledPatternCanaryHealth,
  recordControlledPatternCanaryRollback
} from './controlled-pattern-canary-activation-rollback.mjs';

export const PATTERN_CANARY_EXPANSION_GOVERNANCE_VERSION = 'PATTERN_CANARY_EXPANSION_REJECTION_GOVERNANCE_V0_1';
export const EXPANSION_CONFIRMATION_MIN_NEW_SETTLED_N = 30;
export const EXPANSION_MIN_TOTAL_SETTLED_N = 60;
export const EXPANSION_NEXT_STAGE_MAX_ROUTING_FRACTION = 0.10;
export const EXPANSION_MAX_ABS_PROBABILITY_SHIFT = 0.02;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(stableStringify(value)).digest('hex'); }
function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const v of Object.values(value)) deepFreeze(v); return value; }
function parseTimestamp(name, value) { const ms = Date.parse(value); if (!value || Number.isNaN(ms)) throw new Error(`${name}_INVALID_TIMESTAMP`); return ms; }
function keyOf(row) { return `${row.match_id}|${row.market_key}|${row.selection}`; }
function sorted(values) { return [...values].sort(); }
function fingerprintPayload(row, field, error) { const { [field]: fp, ...payload } = row ?? {}; if (!fp || sha256(payload) !== fp) throw new Error(error); return true; }

function verifyExactSettlementCohort({ authorization, healthEvaluation, settlements, prefix }) {
  verifyControlledPatternCanaryAuthorization(authorization);
  verifyControlledPatternCanaryHealth(healthEvaluation);
  if (healthEvaluation.canary_authorization_fingerprint !== authorization.canary_authorization_fingerprint) throw new Error(`${prefix}_HEALTH_AUTHORIZATION_MISMATCH`);
  if (!Array.isArray(settlements) || settlements.length !== healthEvaluation.routed_settled_n) throw new Error(`${prefix}_EXACT_SETTLEMENT_COHORT_REQUIRED`);
  const seen = new Set();
  for (const s of settlements) {
    verifyControlledPatternCanarySettlement(s);
    if (s.source_canary_authorization_fingerprint !== authorization.canary_authorization_fingerprint) throw new Error(`${prefix}_SETTLEMENT_AUTHORIZATION_MISMATCH`);
    if (seen.has(keyOf(s))) throw new Error(`${prefix}_DUPLICATE_SETTLEMENT_KEY`);
    seen.add(keyOf(s));
  }
  const rerun = evaluateControlledPatternCanaryHealth({ authorization, settlements, evaluatedAt: healthEvaluation.evaluated_at, integritySignals: healthEvaluation.integrity_signals ?? [] });
  if (rerun.canary_health_fingerprint !== healthEvaluation.canary_health_fingerprint) throw new Error(`${prefix}_HEALTH_SETTLEMENT_COHORT_MISMATCH`);
  return true;
}

export function freezePatternCanaryExpansionCheckpoint({ authorization, healthEvaluation, settlements, frozenAt }) {
  verifyExactSettlementCohort({ authorization, healthEvaluation, settlements, prefix: 'STEP11_CHECKPOINT' });
  if (healthEvaluation.state !== 'CANARY_HEALTHY_CONTINUE_PAPER_ONLY' || healthEvaluation.rollback_required !== false || healthEvaluation.routed_settled_n < EXPANSION_CONFIRMATION_MIN_NEW_SETTLED_N) {
    throw new Error('STEP11_HEALTHY_STEP10_CHECKPOINT_REQUIRED');
  }
  if (!Object.values(healthEvaluation.gates ?? {}).every(Boolean)) throw new Error('STEP11_STEP10_HEALTH_GATES_REQUIRED');
  const frozenMs = parseTimestamp('STEP11_CHECKPOINT_FROZEN_AT', frozenAt);
  if (frozenMs <= parseTimestamp('STEP11_STEP10_HEALTH_EVALUATED_AT', healthEvaluation.evaluated_at)) throw new Error('STEP11_CHECKPOINT_FREEZE_MUST_FOLLOW_STEP10_HEALTH');
  const payload = {
    checkpoint_version: PATTERN_CANARY_EXPANSION_GOVERNANCE_VERSION,
    state: 'STEP10_HEALTHY_CANARY_CHECKPOINT_FROZEN',
    frozen_at: frozenAt,
    canary_authorization_fingerprint: authorization.canary_authorization_fingerprint,
    source_step10_health_fingerprint: healthEvaluation.canary_health_fingerprint,
    initial_routed_settled_n: settlements.length,
    source_settlement_fingerprints: sorted(settlements.map(s => s.canary_settlement_fingerprint)),
    excluded_initial_match_market_selection_keys: sorted(settlements.map(keyOf)),
    current_stage: {
      routing_fraction: authorization.routing.active_fraction,
      maximum_absolute_probability_shift: authorization.influence.maximum_absolute_probability_shift,
      channel: authorization.channel
    },
    confirmation_plan: {
      minimum_new_routed_settled_n: EXPANSION_CONFIRMATION_MIN_NEW_SETTLED_N,
      minimum_total_routed_settled_n: EXPANSION_MIN_TOTAL_SETTLED_N,
      new_decision_routed_after_checkpoint_freeze_required: true,
      initial_rows_may_be_reused: false,
      full_and_confirmation_cohort_non_degradation_required: true,
      additional_alpha_spent: false
    },
    governance: {
      expansion_activated_here: false,
      automatic_expansion: false,
      production_decision_weight: 0,
      capital_execution_allowed: false,
      gate6_capital_lock_preserved: true,
      p002_changed: false,
      gate1_to_gate6_ownership_changed: false,
      capital_effect: 'NONE',
      real_money: 'NO'
    }
  };
  return deepFreeze({ ...payload, expansion_checkpoint_fingerprint: sha256(payload) });
}

export function verifyPatternCanaryExpansionCheckpoint(checkpoint) {
  if (!checkpoint || checkpoint.checkpoint_version !== PATTERN_CANARY_EXPANSION_GOVERNANCE_VERSION) throw new Error('STEP11_CHECKPOINT_VERSION_INVALID');
  fingerprintPayload(checkpoint, 'expansion_checkpoint_fingerprint', 'STEP11_CHECKPOINT_FINGERPRINT_INVALID');
  if (checkpoint.state !== 'STEP10_HEALTHY_CANARY_CHECKPOINT_FROZEN') throw new Error('STEP11_CHECKPOINT_STATE_INVALID');
  if (checkpoint.governance?.production_decision_weight !== 0 || checkpoint.governance?.capital_execution_allowed !== false) throw new Error('STEP11_CHECKPOINT_GOVERNANCE_INVALID');
  return true;
}

export function evaluatePatternCanaryExpansionEvidence({
  checkpoint, authorization, checkpointSettlements, confirmationDecisions, confirmationSettlements, evaluatedAt, integritySignals = []
}) {
  verifyPatternCanaryExpansionCheckpoint(checkpoint);
  verifyControlledPatternCanaryAuthorization(authorization);
  if (checkpoint.canary_authorization_fingerprint !== authorization.canary_authorization_fingerprint) throw new Error('STEP11_CHECKPOINT_AUTHORIZATION_MISMATCH');
  if (!Array.isArray(checkpointSettlements) || !Array.isArray(confirmationDecisions) || !Array.isArray(confirmationSettlements) || !Array.isArray(integritySignals)) throw new Error('STEP11_EXPANSION_EVIDENCE_ARRAYS_REQUIRED');
  if (checkpointSettlements.length !== checkpoint.initial_routed_settled_n) throw new Error('STEP11_CHECKPOINT_SETTLEMENT_COUNT_MISMATCH');
  if (stableStringify(sorted(checkpointSettlements.map(s => s.canary_settlement_fingerprint))) !== stableStringify(checkpoint.source_settlement_fingerprints)) throw new Error('STEP11_CHECKPOINT_SETTLEMENT_FINGERPRINT_SET_MISMATCH');
  for (const s of checkpointSettlements) {
    verifyControlledPatternCanarySettlement(s);
    if (s.source_canary_authorization_fingerprint !== authorization.canary_authorization_fingerprint) throw new Error('STEP11_CHECKPOINT_SETTLEMENT_AUTHORIZATION_MISMATCH');
  }
  if (confirmationDecisions.length !== confirmationSettlements.length) throw new Error('STEP11_CONFIRMATION_DECISION_SETTLEMENT_COUNT_MISMATCH');
  const frozenMs = parseTimestamp('STEP11_CHECKPOINT_FROZEN_AT', checkpoint.frozen_at);
  const excluded = new Set(checkpoint.excluded_initial_match_market_selection_keys);
  const seen = new Set(excluded);
  const decisions = new Map();
  for (const d of confirmationDecisions) {
    verifyControlledPatternCanaryDecision(d);
    if (d.state !== 'CANARY_APPLIED_PAPER_ONLY' || d.canary?.applied !== true) throw new Error('STEP11_ONLY_ROUTED_CANARY_DECISIONS_COUNT');
    if (d.source_canary_authorization_fingerprint !== authorization.canary_authorization_fingerprint) throw new Error('STEP11_CONFIRMATION_DECISION_AUTHORIZATION_MISMATCH');
    if (parseTimestamp('STEP11_CONFIRMATION_ROUTED_AT', d.routed_at) <= frozenMs) throw new Error('STEP11_CONFIRMATION_DECISION_MUST_FOLLOW_CHECKPOINT_FREEZE');
    if (decisions.has(d.canary_decision_fingerprint)) throw new Error('STEP11_DUPLICATE_CONFIRMATION_DECISION');
    decisions.set(d.canary_decision_fingerprint, d);
  }
  for (const s of confirmationSettlements) {
    verifyControlledPatternCanarySettlement(s);
    if (s.source_canary_authorization_fingerprint !== authorization.canary_authorization_fingerprint) throw new Error('STEP11_CONFIRMATION_SETTLEMENT_AUTHORIZATION_MISMATCH');
    const d = decisions.get(s.source_canary_decision_fingerprint);
    if (!d || keyOf(d) !== keyOf(s)) throw new Error('STEP11_CONFIRMATION_DECISION_SETTLEMENT_LINEAGE_MISMATCH');
    const key = keyOf(s);
    if (excluded.has(key)) throw new Error('STEP11_INITIAL_CANARY_EVIDENCE_REUSE_FORBIDDEN');
    if (seen.has(key)) throw new Error('STEP11_DUPLICATE_EXPANSION_MATCH_MARKET_SELECTION');
    seen.add(key);
  }
  const evaluatedMs = parseTimestamp('STEP11_EXPANSION_EVALUATED_AT', evaluatedAt);
  for (const s of confirmationSettlements) if (parseTimestamp('STEP11_CONFIRMATION_SETTLED_AT', s.settled_at) > evaluatedMs) throw new Error('STEP11_EVALUATION_CANNOT_PREDATE_CONFIRMATION_EVIDENCE');
  const allSettlements = [...checkpointSettlements, ...confirmationSettlements];
  const fullHealth = evaluateControlledPatternCanaryHealth({ authorization, settlements: allSettlements, evaluatedAt, integritySignals });
  const confirmationHealth = evaluateControlledPatternCanaryHealth({ authorization, settlements: confirmationSettlements, evaluatedAt, integritySignals });
  const enoughNew = confirmationSettlements.length >= EXPANSION_CONFIRMATION_MIN_NEW_SETTLED_N;
  const enoughTotal = allSettlements.length >= EXPANSION_MIN_TOTAL_SETTLED_N;
  const rollbackRequired = fullHealth.rollback_required || confirmationHealth.rollback_required;
  const eligible = enoughNew && enoughTotal && !rollbackRequired && fullHealth.state === 'CANARY_HEALTHY_CONTINUE_PAPER_ONLY' && confirmationHealth.state === 'CANARY_HEALTHY_CONTINUE_PAPER_ONLY';
  const payload = {
    evaluation_version: PATTERN_CANARY_EXPANSION_GOVERNANCE_VERSION,
    state: rollbackRequired ? 'CANARY_REJECTION_REQUIRED_ROLLBACK_TO_CHAMPION' : eligible ? 'ELIGIBLE_FOR_MANUAL_NEXT_CANARY_STAGE_DECISION' : 'EXPANSION_CONFIRMATION_ACCUMULATING_CURRENT_STAGE',
    evaluated_at: evaluatedAt,
    expansion_checkpoint_fingerprint: checkpoint.expansion_checkpoint_fingerprint,
    canary_authorization_fingerprint: authorization.canary_authorization_fingerprint,
    initial_routed_settled_n: checkpointSettlements.length,
    new_confirmation_routed_settled_n: confirmationSettlements.length,
    total_routed_settled_n: allSettlements.length,
    minimum_new_confirmation_n: EXPANSION_CONFIRMATION_MIN_NEW_SETTLED_N,
    minimum_total_n: EXPANSION_MIN_TOTAL_SETTLED_N,
    full_health: fullHealth,
    confirmation_health: confirmationHealth,
    gates: {
      minimum_new_confirmation_n: enoughNew,
      minimum_total_n: enoughTotal,
      no_rollback_signal: !rollbackRequired,
      full_cohort_healthy: fullHealth.state === 'CANARY_HEALTHY_CONTINUE_PAPER_ONLY',
      confirmation_cohort_healthy: confirmationHealth.state === 'CANARY_HEALTHY_CONTINUE_PAPER_ONLY'
    },
    additional_alpha_spent: false,
    governance: {
      manual_decision_required: true,
      automatic_expansion: false,
      automatic_full_promotion: false,
      production_decision_weight: 0,
      capital_execution_allowed: false,
      real_money: 'NO'
    }
  };
  return deepFreeze({ ...payload, expansion_evaluation_fingerprint: sha256(payload) });
}

export function verifyPatternCanaryExpansionEvaluation(evaluation) {
  if (!evaluation || evaluation.evaluation_version !== PATTERN_CANARY_EXPANSION_GOVERNANCE_VERSION) throw new Error('STEP11_EXPANSION_EVALUATION_VERSION_INVALID');
  fingerprintPayload(evaluation, 'expansion_evaluation_fingerprint', 'STEP11_EXPANSION_EVALUATION_FINGERPRINT_INVALID');
  if (evaluation.additional_alpha_spent !== false || evaluation.governance?.production_decision_weight !== 0 || evaluation.governance?.automatic_expansion !== false) throw new Error('STEP11_EXPANSION_EVALUATION_GOVERNANCE_INVALID');
  return true;
}

export function recordPatternCanaryExpansionDecision({ checkpoint, authorization, evaluation, decision, approver, rationale, decidedAt }) {
  verifyPatternCanaryExpansionCheckpoint(checkpoint);
  verifyControlledPatternCanaryAuthorization(authorization);
  verifyPatternCanaryExpansionEvaluation(evaluation);
  if (checkpoint.canary_authorization_fingerprint !== authorization.canary_authorization_fingerprint || evaluation.canary_authorization_fingerprint !== authorization.canary_authorization_fingerprint) throw new Error('STEP11_DECISION_AUTHORIZATION_MISMATCH');
  if (evaluation.expansion_checkpoint_fingerprint !== checkpoint.expansion_checkpoint_fingerprint) throw new Error('STEP11_DECISION_CHECKPOINT_MISMATCH');
  if (!['APPROVE_NEXT_CANARY_STAGE', 'HOLD_CURRENT_CANARY', 'REJECT_AND_RETIRE_PATTERN_CANARY'].includes(decision)) throw new Error('STEP11_GOVERNANCE_DECISION_INVALID');
  if (!approver || !String(approver).trim()) throw new Error('STEP11_APPROVER_REQUIRED');
  if (!rationale || !String(rationale).trim()) throw new Error('STEP11_DECISION_RATIONALE_REQUIRED');
  const decidedMs = parseTimestamp('STEP11_DECIDED_AT', decidedAt);
  if (decidedMs <= parseTimestamp('STEP11_EXPANSION_EVALUATED_AT', evaluation.evaluated_at)) throw new Error('STEP11_DECISION_MUST_FOLLOW_EVALUATION');
  if (decision === 'APPROVE_NEXT_CANARY_STAGE' && evaluation.state !== 'ELIGIBLE_FOR_MANUAL_NEXT_CANARY_STAGE_DECISION') throw new Error('STEP11_EXPANSION_APPROVAL_WITHOUT_ELIGIBILITY_FORBIDDEN');
  if (decision === 'HOLD_CURRENT_CANARY' && evaluation.state === 'CANARY_REJECTION_REQUIRED_ROLLBACK_TO_CHAMPION') throw new Error('STEP11_HOLD_WHILE_ROLLBACK_REQUIRED_FORBIDDEN');
  let rollback = null;
  let state;
  let nextRouting = authorization.routing.active_fraction;
  if (decision === 'REJECT_AND_RETIRE_PATTERN_CANARY') {
    rollback = recordControlledPatternCanaryRollback({ authorization, reason: 'MANUAL_KILL_SWITCH', actor: String(approver).trim(), rationale: String(rationale).trim(), rolledBackAt: decidedAt });
    state = 'CANARY_REJECTED_RETIRED_CHAMPION_ONLY';
    nextRouting = 0;
  } else if (decision === 'APPROVE_NEXT_CANARY_STAGE') {
    state = 'NEXT_CANARY_STAGE_APPROVED_NOT_ACTIVATED';
    nextRouting = Math.min(EXPANSION_NEXT_STAGE_MAX_ROUTING_FRACTION, authorization.routing.active_fraction * 2);
  } else {
    state = 'CANARY_HELD_AT_CURRENT_STAGE';
  }
  const payload = {
    decision_version: PATTERN_CANARY_EXPANSION_GOVERNANCE_VERSION,
    state, decision, approver: String(approver).trim(), rationale: String(rationale).trim(), decided_at: decidedAt,
    expansion_checkpoint_fingerprint: checkpoint.expansion_checkpoint_fingerprint,
    expansion_evaluation_fingerprint: evaluation.expansion_evaluation_fingerprint,
    canary_authorization_fingerprint: authorization.canary_authorization_fingerprint,
    current_stage: { routing_fraction: authorization.routing.active_fraction, maximum_absolute_probability_shift: authorization.influence.maximum_absolute_probability_shift },
    next_stage: {
      approved_not_activated: decision === 'APPROVE_NEXT_CANARY_STAGE',
      maximum_routing_fraction: decision === 'APPROVE_NEXT_CANARY_STAGE' ? nextRouting : decision === 'HOLD_CURRENT_CANARY' ? authorization.routing.active_fraction : 0,
      maximum_absolute_probability_shift: decision === 'REJECT_AND_RETIRE_PATTERN_CANARY' ? 0 : Math.min(authorization.influence.maximum_absolute_probability_shift, EXPANSION_MAX_ABS_PROBABILITY_SHIFT),
      activation_performed_here: false,
      full_production_promotion_authorized: false
    },
    rollback_fingerprint: rollback?.rollback_fingerprint ?? null,
    governance: {
      automatic_expansion: false,
      automatic_full_promotion: false,
      production_decision_weight: 0,
      capital_execution_allowed: false,
      same_authorization_reactivation_allowed: decision === 'REJECT_AND_RETIRE_PATTERN_CANARY' ? false : true,
      gate6_capital_lock_preserved: true,
      capital_effect: 'NONE',
      real_money: 'NO'
    },
    next_stage_name: decision === 'APPROVE_NEXT_CANARY_STAGE' ? 'STEP_12_STAGED_CANARY_EXPANSION_ACTIVATION_AND_MONITORING' : decision === 'HOLD_CURRENT_CANARY' ? 'CONTINUE_STEP10_CANARY_AND_COLLECT_MORE_EVIDENCE' : 'PATTERN_CANARY_RETIRED_REQUIRES_NEW_GOVERNED_LINEAGE_FOR_FUTURE_ATTEMPT'
  };
  return deepFreeze({ ...payload, expansion_decision_fingerprint: sha256(payload) });
}

export function verifyPatternCanaryExpansionDecision(decision) {
  if (!decision || decision.decision_version !== PATTERN_CANARY_EXPANSION_GOVERNANCE_VERSION) throw new Error('STEP11_DECISION_VERSION_INVALID');
  fingerprintPayload(decision, 'expansion_decision_fingerprint', 'STEP11_DECISION_FINGERPRINT_INVALID');
  if (decision.governance?.production_decision_weight !== 0 || decision.governance?.capital_execution_allowed !== false || decision.governance?.real_money !== 'NO') throw new Error('STEP11_DECISION_GOVERNANCE_INVALID');
  if (decision.state === 'NEXT_CANARY_STAGE_APPROVED_NOT_ACTIVATED' && decision.next_stage?.activation_performed_here !== false) throw new Error('STEP11_APPROVAL_IS_NOT_ACTIVATION');
  if (decision.state === 'CANARY_REJECTED_RETIRED_CHAMPION_ONLY' && (!decision.rollback_fingerprint || decision.next_stage?.maximum_routing_fraction !== 0)) throw new Error('STEP11_REJECTION_ROLLBACK_REQUIRED');
  return true;
}
