import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ZERO_WEIGHT_CHALLENGER_PROMOTION_SAFETY_VERSION,
  REQUIRED_PRODUCTION_SAFETY_CONTROLS
} from '../src/zero-weight-challenger-promotion-authorization-production-safety-review.mjs';
import {
  CONTROLLED_PRODUCTION_ACTIVATION_VERSION,
  MAX_INITIAL_PRODUCTION_DECISION_WEIGHT,
  MAX_ABSOLUTE_PROBABILITY_SHIFT,
  CONTROLLED_PRODUCTION_HEALTH_MIN_SETTLED_N,
  activateControlledProductionChallenger,
  verifyControlledProductionActivation,
  applyControlledProductionChallenger,
  verifyControlledProductionDecision,
  settleControlledProductionDecision,
  verifyControlledProductionSettlement,
  evaluateControlledProductionHealth,
  verifyControlledProductionHealth,
  recordControlledProductionEmergencyRollback,
  verifyControlledProductionEmergencyRollback
} from '../src/controlled-production-activation-emergency-rollback.mjs';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(stableStringify(value)).digest('hex'); }
function withFingerprint(payload, field) { return Object.freeze({ ...payload, [field]: sha256(payload) }); }

function makeSafetyReview() {
  const controls = Object.fromEntries(REQUIRED_PRODUCTION_SAFETY_CONTROLS.map(control => [control, true]));
  const refs = Object.fromEntries(REQUIRED_PRODUCTION_SAFETY_CONTROLS.map(control => [control, `synthetic:${control}`]));
  const payload = {
    review_version: ZERO_WEIGHT_CHALLENGER_PROMOTION_SAFETY_VERSION,
    state: 'ZERO_WEIGHT_CHALLENGER_PRODUCTION_SAFETY_REVIEW_PASS_NOT_ACTIVATED',
    reviewed_at: '2026-02-27T00:00:00Z',
    reviewer: 'step14-reviewer',
    rationale: 'synthetic Step14 passing review',
    source_graduation_dossier_fingerprint: 'graduation-dossier-fixture',
    source_graduation_decision_fingerprint: 'graduation-decision-fixture',
    source_step12_activation_fingerprint: 'step12-activation-fixture',
    source_step12_health_fingerprint: 'step12-health-fixture',
    candidate: {
      state: 'ZERO_WEIGHT_CHALLENGER_CANDIDATE_NOT_PRODUCTION_ACTIVATED',
      decision_weight: 0,
      approved_pattern_ids: ['P002'],
      source_shadow_plan_fingerprint: 'shadow-plan-fixture',
      calibration: { version: 'cal-v1', provenance: 'synthetic-test-only' },
      production_activation_authorized: false,
      champion_replacement_authorized: false,
      capital_use_authorized: false
    },
    safety_controls: controls,
    safety_evidence_references: refs,
    failed_controls: [],
    gates: {
      all_required_safety_controls_pass: true,
      holdout_firewall_intact: true,
      graduation_evidence_not_reused: true,
      lineage_reproducible: true,
      calibration_lineage_verified: true,
      rollback_path_verified: true,
      observability_ready: true,
      deployment_reversible: true,
      security_and_data_governance_clear: true,
      capacity_and_failure_isolation_ready: true,
      regression_and_system_assurance_green: true,
      gate6_capital_lock_confirmed: true,
      production_weight_and_champion_unchanged: true
    },
    eligible_for_manual_authorization: true,
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
  return withFingerprint(payload, 'production_safety_review_fingerprint');
}

function makeAuthorization(review, overrides = {}) {
  const payload = {
    authorization_version: ZERO_WEIGHT_CHALLENGER_PROMOTION_SAFETY_VERSION,
    state: 'ZERO_WEIGHT_CHALLENGER_APPROVED_FOR_CONTROLLED_PRODUCTION_ACTIVATION_NOT_ACTIVATED',
    decision: 'APPROVE_FOR_CONTROLLED_PRODUCTION_ACTIVATION_NOT_ACTIVATED',
    approver: 'step14-governor',
    rationale: 'synthetic Step14 approval',
    decided_at: '2026-02-28T00:00:00Z',
    source_production_safety_review_fingerprint: review.production_safety_review_fingerprint,
    source_graduation_dossier_fingerprint: review.source_graduation_dossier_fingerprint,
    source_graduation_decision_fingerprint: review.source_graduation_decision_fingerprint,
    candidate: {
      decision_weight: 0,
      approved_pattern_ids: review.candidate.approved_pattern_ids,
      source_shadow_plan_fingerprint: review.candidate.source_shadow_plan_fingerprint,
      calibration: review.candidate.calibration,
      production_activation_performed_here: false,
      nonzero_production_weight_authorized_here: false,
      champion_replacement_authorized_here: false,
      capital_use_authorized_here: false,
      archived: false
    },
    enforcement: {
      production_decision_weight_after_step14: 0,
      champion_unchanged: true,
      production_mutation_performed: false,
      routing_or_probability_influence_changed_here: false,
      new_safety_review_required_before_future_approval: false,
      same_step13_graduation_decision_may_be_reauthorized_after_rejection: null
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
    next_stage: 'STEP_15_CONTROLLED_PRODUCTION_ACTIVATION_AND_EMERGENCY_ROLLBACK',
    ...overrides
  };
  return withFingerprint(payload, 'promotion_authorization_fingerprint');
}

function makeActivation(weight = 0.05) {
  const safetyReview = makeSafetyReview();
  const promotionAuthorization = makeAuthorization(safetyReview);
  const activation = activateControlledProductionChallenger({
    safetyReview,
    promotionAuthorization,
    decisionWeight: weight,
    activatedBy: 'step15-operator',
    activatedAt: '2026-03-01T00:00:00Z',
    deploymentReference: 'synthetic-deployment:step15',
    killSwitchReference: 'synthetic-kill-switch:step15'
  });
  return { safetyReview, promotionAuthorization, activation };
}

function makeDecision(activation, i = 0, challengerProbability = 0.8, rollbackRecord = null) {
  return applyControlledProductionChallenger({
    activation,
    matchId: `M${String(i).padStart(3, '0')}`,
    marketKey: 'TOTALS_U35',
    selection: 'UNDER',
    championProbability: 0.5,
    challengerProbability,
    generatedAt: '2026-03-01T01:00:00Z',
    eventStartAt: '2026-03-01T02:00:00Z',
    rollbackRecord
  });
}

function makeSettlements(activation, n, challengerProbability = 0.8, outcome = 1) {
  return Array.from({ length: n }, (_, i) => settleControlledProductionDecision({
    decision: makeDecision(activation, i, challengerProbability),
    outcome,
    settledAt: '2026-03-01T04:00:00Z'
  }));
}

test('Step 15 activation consumes exact Step 14 approval and opens only bounded production prediction influence', () => {
  const { activation } = makeActivation();
  assert.equal(verifyControlledProductionActivation(activation), true);
  assert.equal(activation.activation_version, CONTROLLED_PRODUCTION_ACTIVATION_VERSION);
  assert.equal(activation.state, 'CONTROLLED_PRODUCTION_ACTIVATION_ACTIVE_CAPITAL_LOCKED');
  assert.equal(activation.production.decision_weight, MAX_INITIAL_PRODUCTION_DECISION_WEIGHT);
  assert.equal(activation.production.maximum_absolute_probability_shift, MAX_ABSOLUTE_PROBABILITY_SHIFT);
  assert.equal(activation.production.champion_replacement_authorized, false);
  assert.equal(activation.production.capital_execution_allowed, false);
  assert.equal(activation.emergency_rollback.kill_switch_armed, true);
  assert.equal(activation.governance.real_money, 'NO');
});

test('Step 15 rejects a valid Step 14 HOLD authorization because exact approval is required', () => {
  const review = makeSafetyReview();
  const hold = makeAuthorization(review, {
    state: 'ZERO_WEIGHT_CHALLENGER_HELD_ZERO_WEIGHT_NEW_SAFETY_REVIEW_REQUIRED',
    decision: 'HOLD_ZERO_WEIGHT_CHALLENGER',
    next_stage: 'REPEAT_STEP14_WITH_NEW_SAFETY_REVIEW_BEFORE_FUTURE_APPROVAL',
    enforcement: {
      production_decision_weight_after_step14: 0,
      champion_unchanged: true,
      production_mutation_performed: false,
      routing_or_probability_influence_changed_here: false,
      new_safety_review_required_before_future_approval: true,
      same_step13_graduation_decision_may_be_reauthorized_after_rejection: null
    }
  });
  assert.throws(() => activateControlledProductionChallenger({
    safetyReview: review,
    promotionAuthorization: hold,
    decisionWeight: 0.01,
    activatedBy: 'x', activatedAt: '2026-03-01T00:00:00Z',
    deploymentReference: 'd', killSwitchReference: 'k'
  }), /STEP15_EXACT_STEP14_APPROVAL_REQUIRED/);
});

test('Step 15 refuses initial production decision weight above five percent', () => {
  const review = makeSafetyReview();
  const authorization = makeAuthorization(review);
  assert.throws(() => activateControlledProductionChallenger({
    safetyReview: review,
    promotionAuthorization: authorization,
    decisionWeight: 0.050001,
    activatedBy: 'x', activatedAt: '2026-03-01T00:00:00Z', deploymentReference: 'd', killSwitchReference: 'k'
  }), /STEP15_INITIAL_PRODUCTION_DECISION_WEIGHT_OUT_OF_RANGE/);
});

test('Step 15 weighted production mutation is capped at two percentage points and keeps capital locked', () => {
  const { activation } = makeActivation();
  const decision = applyControlledProductionChallenger({
    activation,
    matchId: 'CAP', marketKey: 'TOTALS_U35', selection: 'UNDER',
    championProbability: 0.1, challengerProbability: 1,
    generatedAt: '2026-03-01T01:00:00Z', eventStartAt: '2026-03-01T02:00:00Z'
  });
  assert.equal(verifyControlledProductionDecision(decision), true);
  assert.equal(decision.applied_probability_shift, 0.02);
  assert.ok(Math.abs(decision.production_probability - 0.12) < 1e-12);
  assert.equal(decision.capital_execution_allowed, false);
  assert.equal(decision.real_money, 'NO');
});

test('Step 15 forbids retroactive and post-event-start production mutation', () => {
  const { activation } = makeActivation();
  assert.throws(() => applyControlledProductionChallenger({
    activation, matchId: 'OLD', marketKey: 'TOTALS_U35', selection: 'UNDER',
    championProbability: 0.5, challengerProbability: 0.6,
    generatedAt: '2026-02-28T23:00:00Z', eventStartAt: '2026-03-01T02:00:00Z'
  }), /STEP15_RETROACTIVE_PRODUCTION_DECISION_FORBIDDEN/);
  assert.throws(() => applyControlledProductionChallenger({
    activation, matchId: 'LATE', marketKey: 'TOTALS_U35', selection: 'UNDER',
    championProbability: 0.5, challengerProbability: 0.6,
    generatedAt: '2026-03-01T02:00:00Z', eventStartAt: '2026-03-01T02:00:00Z'
  }), /STEP15_POST_EVENT_START_PRODUCTION_MUTATION_FORBIDDEN/);
});

test('Step 15 emergency rollback forces exact champion-only output', () => {
  const { activation } = makeActivation();
  const rollback = recordControlledProductionEmergencyRollback({
    activation,
    reason: 'MANUAL_KILL_SWITCH',
    actor: 'operator', rationale: 'synthetic emergency rollback',
    rolledBackAt: '2026-03-01T00:30:00Z'
  });
  assert.equal(verifyControlledProductionEmergencyRollback(rollback), true);
  const decision = makeDecision(activation, 1, 0.9, rollback);
  assert.equal(decision.state, 'CONTROLLED_PRODUCTION_ROLLED_BACK_CHAMPION_ONLY');
  assert.equal(decision.decision_weight, 0);
  assert.equal(decision.applied_probability_shift, 0);
  assert.equal(decision.production_probability, decision.champion_probability);
});

test('Step 15 settlement is strictly post-event-start', () => {
  const { activation } = makeActivation();
  const decision = makeDecision(activation);
  assert.throws(() => settleControlledProductionDecision({
    decision, outcome: 1, settledAt: '2026-03-01T02:00:00Z'
  }), /STEP15_SETTLEMENT_MUST_FOLLOW_EVENT_START/);
  const settled = settleControlledProductionDecision({ decision, outcome: 1, settledAt: '2026-03-01T03:00:00Z' });
  assert.equal(verifyControlledProductionSettlement(settled), true);
});

test('Step 15 health remains accumulating before prospective minimum N30', () => {
  const { activation } = makeActivation();
  const health = evaluateControlledProductionHealth({
    activation,
    settlements: makeSettlements(activation, CONTROLLED_PRODUCTION_HEALTH_MIN_SETTLED_N - 1),
    evaluatedAt: '2026-03-02T00:00:00Z'
  });
  assert.equal(verifyControlledProductionHealth(health), true);
  assert.equal(health.state, 'CONTROLLED_PRODUCTION_HEALTH_ACCUMULATING_CAPITAL_LOCKED');
  assert.equal(health.gates.minimum_settled_n_passed, false);
  assert.equal(health.rollback_required, false);
});

test('Step 15 healthy N30 prospective evidence may continue bounded but cannot auto-ramp or unlock capital', () => {
  const { activation } = makeActivation();
  const health = evaluateControlledProductionHealth({
    activation,
    settlements: makeSettlements(activation, 30, 0.8, 1),
    evaluatedAt: '2026-03-02T00:00:00Z'
  });
  assert.equal(verifyControlledProductionHealth(health), true);
  assert.equal(health.state, 'CONTROLLED_PRODUCTION_HEALTHY_CONTINUE_BOUNDED_CAPITAL_LOCKED');
  assert.equal(health.gates.minimum_settled_n_passed, true);
  assert.equal(health.gates.brier_non_degradation_passed, true);
  assert.equal(health.gates.log_loss_non_degradation_passed, true);
  assert.equal(health.gates.ece_degradation_cap_passed, true);
  assert.equal(health.governance.automatic_weight_increase, false);
  assert.equal(health.governance.capital_execution_allowed, false);
  assert.equal(health.next_stage, 'STEP_16_CONTROLLED_PRODUCTION_EVIDENCE_REVIEW_AND_WEIGHT_GOVERNANCE');
});

test('Step 15 performance degradation at N30 requires rollback to champion', () => {
  const { activation } = makeActivation();
  const health = evaluateControlledProductionHealth({
    activation,
    settlements: makeSettlements(activation, 30, 0.2, 1),
    evaluatedAt: '2026-03-02T00:00:00Z'
  });
  assert.equal(health.state, 'CONTROLLED_PRODUCTION_ROLLBACK_TO_CHAMPION_REQUIRED');
  assert.equal(health.rollback_required, true);
  assert.equal(health.gates.brier_non_degradation_passed, false);
  const rollback = recordControlledProductionEmergencyRollback({
    activation,
    reason: 'PERFORMANCE_DEGRADATION_AFTER_MINIMUM_N',
    actor: 'health-controller', rationale: 'synthetic degraded prospective cohort',
    rolledBackAt: '2026-03-02T00:01:00Z', healthEvaluation: health
  });
  assert.equal(verifyControlledProductionEmergencyRollback(rollback), true);
  assert.equal(rollback.enforcement.production_decision_weight, 0);
});

test('Step 15 immediate integrity signal requires rollback without waiting for N30', () => {
  const { activation } = makeActivation();
  const health = evaluateControlledProductionHealth({
    activation,
    settlements: makeSettlements(activation, 3),
    evaluatedAt: '2026-03-02T00:00:00Z',
    integritySignals: ['GATE6_CAPITAL_LOCK_VIOLATION']
  });
  assert.equal(health.state, 'CONTROLLED_PRODUCTION_ROLLBACK_TO_CHAMPION_REQUIRED');
  assert.equal(health.gates.minimum_settled_n_passed, false);
  assert.equal(health.rollback_required, true);
});

test('Step 15 activation, decision, health and rollback fingerprints fail closed on tampering', () => {
  const { activation } = makeActivation();
  assert.throws(() => verifyControlledProductionActivation({ ...activation, state: 'TAMPERED' }), /STEP15_ACTIVATION_FINGERPRINT_INVALID/);
  const decision = makeDecision(activation);
  assert.throws(() => verifyControlledProductionDecision({ ...decision, production_probability: 0.99 }), /STEP15_DECISION_FINGERPRINT_INVALID/);
  const health = evaluateControlledProductionHealth({ activation, settlements: [], evaluatedAt: '2026-03-02T00:00:00Z' });
  assert.throws(() => verifyControlledProductionHealth({ ...health, settled_n: 999 }), /STEP15_HEALTH_FINGERPRINT_INVALID/);
  const rollback = recordControlledProductionEmergencyRollback({ activation, reason: 'MANUAL_KILL_SWITCH', actor: 'x', rationale: 'x', rolledBackAt: '2026-03-01T00:30:00Z' });
  assert.throws(() => verifyControlledProductionEmergencyRollback({ ...rollback, reason: 'TAMPERED' }), /STEP15_ROLLBACK_FINGERPRINT_INVALID/);
});
