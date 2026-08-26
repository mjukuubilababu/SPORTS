import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  CONTROLLED_PRODUCTION_ACTIVATION_VERSION,
  MAX_INITIAL_PRODUCTION_DECISION_WEIGHT,
  MAX_ABSOLUTE_PROBABILITY_SHIFT,
  applyControlledProductionChallenger,
  settleControlledProductionDecision,
  evaluateControlledProductionHealth
} from '../src/controlled-production-activation-emergency-rollback.mjs';
import {
  freezeStep15ProductionEvidenceCohortManifest,
  freezeControlledProductionEvidenceReview,
  recordControlledProductionWeightGovernanceDecision
} from '../src/controlled-production-evidence-review-weight-governance.mjs';
import {
  STAGED_CONTROLLED_PRODUCTION_WEIGHT_VERSION,
  STAGED_CONTROLLED_PRODUCTION_MAX_DECISION_WEIGHT,
  STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT,
  STAGED_CONTROLLED_PRODUCTION_HEALTH_MIN_SETTLED_N,
  activateStagedControlledProductionWeight,
  verifyStagedControlledProductionWeightActivation,
  applyStagedControlledProductionWeight,
  verifyStagedControlledProductionWeightDecision,
  settleStagedControlledProductionWeightDecision,
  verifyStagedControlledProductionWeightSettlement,
  evaluateStagedControlledProductionWeightHealth,
  verifyStagedControlledProductionWeightHealth,
  recordStagedControlledProductionWeightRollback,
  verifyStagedControlledProductionWeightRollback
} from '../src/staged-controlled-production-weight-activation-monitoring.mjs';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(stableStringify(value)).digest('hex'); }
function withFingerprint(payload, field) { return Object.freeze({ ...payload, [field]: sha256(payload) }); }

function makeBaseActivation(weight = 0.05) {
  const payload = {
    activation_version: CONTROLLED_PRODUCTION_ACTIVATION_VERSION,
    state: 'CONTROLLED_PRODUCTION_ACTIVATION_ACTIVE_CAPITAL_LOCKED',
    activated_at: '2026-03-01T00:00:00Z',
    activated_by: 'step17-fixture',
    source_step14_safety_review_fingerprint: 'step14-safety-fixture',
    source_step14_promotion_authorization_fingerprint: 'step14-authorization-fixture',
    source_graduation_dossier_fingerprint: 'graduation-dossier-fixture',
    source_graduation_decision_fingerprint: 'graduation-decision-fixture',
    candidate: {
      approved_pattern_ids: ['P002'],
      source_shadow_plan_fingerprint: 'shadow-plan-fixture',
      calibration: { version: 'cal-v1', provenance: 'synthetic-test-only' }
    },
    production: {
      decision_weight: weight,
      maximum_initial_decision_weight: MAX_INITIAL_PRODUCTION_DECISION_WEIGHT,
      maximum_absolute_probability_shift: MAX_ABSOLUTE_PROBABILITY_SHIFT,
      mutation_method: 'WEIGHTED_CHALLENGER_DELTA_WITH_ABSOLUTE_CAP',
      champion_remains_primary_fallback: true,
      champion_replacement_authorized: false,
      capital_execution_allowed: false
    },
    deployment: { deployment_reference: 'synthetic-deployment:step17-base', reversible: true },
    emergency_rollback: {
      kill_switch_armed: true,
      kill_switch_reference: 'synthetic-kill-switch:step17-base',
      rollback_target: 'CHAMPION_ONLY',
      same_activation_reactivation_allowed_after_rollback: false
    },
    evaluation_firewall: {
      graduation_evidence_reuse_for_training: false,
      graduation_evidence_reuse_for_retuning: false,
      graduation_evidence_counts_as_new_step15_prospective_evidence: false,
      new_prospective_evidence_required: true,
      automatic_weight_increase_from_health: false
    },
    governance: {
      production_prediction_mutation_allowed: true,
      automatic_weight_ramp: false,
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
  return withFingerprint(payload, 'controlled_production_activation_fingerprint');
}

function makeStep15Settlement(activation, i, outcome = 1) {
  const decision = applyControlledProductionChallenger({
    activation,
    matchId: `S16-${String(i).padStart(3, '0')}`,
    marketKey: 'TOTALS_U35', selection: 'UNDER',
    championProbability: 0.5, challengerProbability: 0.8,
    generatedAt: '2026-03-01T01:00:00Z', eventStartAt: '2026-03-01T02:00:00Z'
  });
  return settleControlledProductionDecision({ decision, outcome, settledAt: '2026-03-01T04:00:00Z' });
}

function makeStep16Authorization(weight = 0.05, decisionName = 'AUTHORIZE_NEXT_CONTROLLED_WEIGHT_STAGE_NOT_APPLIED') {
  const baseActivation = makeBaseActivation(weight);
  const settlements = Array.from({ length: 30 }, (_, i) => makeStep15Settlement(baseActivation, i));
  const evidenceManifest = freezeStep15ProductionEvidenceCohortManifest({
    activation: baseActivation, settlements, frozenAt: '2026-03-02T00:00:00Z'
  });
  const health = evaluateControlledProductionHealth({
    activation: baseActivation, settlements, evaluatedAt: '2026-03-02T01:00:00Z'
  });
  const evidenceReview = freezeControlledProductionEvidenceReview({
    activation: baseActivation,
    healthEvaluation: health,
    evidenceManifest,
    settlements,
    reviewedAt: '2026-03-02T02:00:00Z',
    reviewedBy: 'step16-reviewer',
    rationale: 'synthetic manifest-bound healthy evidence'
  });
  const weightGovernanceDecision = recordControlledProductionWeightGovernanceDecision({
    activation: baseActivation,
    evidenceReview,
    decision: decisionName,
    governor: 'step16-governor',
    rationale: 'synthetic Step16 governance decision',
    decidedAt: '2026-03-02T03:00:00Z'
  });
  return { baseActivation, settlements, evidenceManifest, health, evidenceReview, weightGovernanceDecision };
}

function makeStagedActivation(targetWeight = 0.10, currentWeight = 0.05) {
  const bundle = makeStep16Authorization(currentWeight);
  const activation = activateStagedControlledProductionWeight({
    baseActivation: bundle.baseActivation,
    evidenceManifest: bundle.evidenceManifest,
    evidenceReview: bundle.evidenceReview,
    weightGovernanceDecision: bundle.weightGovernanceDecision,
    targetDecisionWeight: targetWeight,
    activatedAt: '2026-03-03T00:00:00Z',
    activatedBy: 'step17-operator',
    deploymentReference: 'synthetic-deployment:step17',
    killSwitchReference: 'synthetic-kill-switch:step17'
  });
  return { ...bundle, activation };
}

function makeStagedDecision(activation, i = 0, challengerProbability = 0.7, rollbackRecord = null) {
  return applyStagedControlledProductionWeight({
    activation,
    matchId: `S17-${String(i).padStart(3, '0')}`,
    marketKey: 'TOTALS_U35', selection: 'UNDER',
    championProbability: 0.5, challengerProbability,
    generatedAt: '2026-03-03T01:00:00Z', eventStartAt: '2026-03-03T02:00:00Z', rollbackRecord
  });
}

function makeStagedSettlements(activation, n = 30, outcome = 1, challengerProbability = 0.7) {
  return Array.from({ length: n }, (_, i) => settleStagedControlledProductionWeightDecision({
    decision: makeStagedDecision(activation, i, challengerProbability),
    outcome,
    settledAt: '2026-03-03T04:00:00Z'
  }));
}

test('Step 17 consumes exact Step 16 authorization and activates only within the authorized ceiling', () => {
  const { activation } = makeStagedActivation();
  assert.equal(verifyStagedControlledProductionWeightActivation(activation), true);
  assert.equal(activation.activation_version, STAGED_CONTROLLED_PRODUCTION_WEIGHT_VERSION);
  assert.equal(activation.state, 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_ACTIVE_CAPITAL_LOCKED');
  assert.equal(activation.production.previous_stage_decision_weight, 0.05);
  assert.equal(activation.production.staged_decision_weight, 0.10);
  assert.equal(activation.production.authorized_maximum_staged_decision_weight, 0.10);
  assert.equal(activation.production.maximum_absolute_probability_shift, 0.02);
  assert.equal(activation.production.capital_execution_allowed, false);
  assert.equal(activation.governance.real_money, 'NO');
});

test('Step 17 rejects a Step 16 HOLD because exact staged-weight authorization is required', () => {
  const bundle = makeStep16Authorization(0.05, 'HOLD_CURRENT_CONTROLLED_WEIGHT');
  assert.throws(() => activateStagedControlledProductionWeight({
    baseActivation: bundle.baseActivation,
    evidenceManifest: bundle.evidenceManifest,
    evidenceReview: bundle.evidenceReview,
    weightGovernanceDecision: bundle.weightGovernanceDecision,
    targetDecisionWeight: 0.10,
    activatedAt: '2026-03-03T00:00:00Z', activatedBy: 'operator', deploymentReference: 'd', killSwitchReference: 'k'
  }), /STEP17_EXACT_STEP16_AUTHORIZATION_REQUIRED/);
});

test('Step 17 rejects any target above the Step 16 authorized ceiling or not above current weight', () => {
  const bundle = makeStep16Authorization(0.02);
  assert.throws(() => activateStagedControlledProductionWeight({
    baseActivation: bundle.baseActivation,
    evidenceManifest: bundle.evidenceManifest,
    evidenceReview: bundle.evidenceReview,
    weightGovernanceDecision: bundle.weightGovernanceDecision,
    targetDecisionWeight: 0.05,
    activatedAt: '2026-03-03T00:00:00Z', activatedBy: 'operator', deploymentReference: 'd', killSwitchReference: 'k'
  }), /STEP17_TARGET_WEIGHT_OUT_OF_AUTHORIZED_RANGE/);
  assert.throws(() => activateStagedControlledProductionWeight({
    baseActivation: bundle.baseActivation,
    evidenceManifest: bundle.evidenceManifest,
    evidenceReview: bundle.evidenceReview,
    weightGovernanceDecision: bundle.weightGovernanceDecision,
    targetDecisionWeight: 0.02,
    activatedAt: '2026-03-03T00:00:00Z', activatedBy: 'operator', deploymentReference: 'd', killSwitchReference: 'k'
  }), /STEP17_TARGET_WEIGHT_OUT_OF_AUTHORIZED_RANGE/);
});

test('Step 17 explicitly forbids reusing a Step 16 reviewed match-market-selection identity', () => {
  const { activation } = makeStagedActivation();
  assert.throws(() => applyStagedControlledProductionWeight({
    activation,
    matchId: 'S16-000', marketKey: 'TOTALS_U35', selection: 'UNDER',
    championProbability: 0.5, challengerProbability: 0.7,
    generatedAt: '2026-03-03T01:00:00Z', eventStartAt: '2026-03-03T02:00:00Z'
  }), /STEP17_STEP16_REVIEWED_EVIDENCE_REUSE_FORBIDDEN/);
});

test('Step 17 preserves previous-weight counterfactual and keeps staged probability shift capped at two points', () => {
  const { activation } = makeStagedActivation();
  const decision = makeStagedDecision(activation, 0, 0.7);
  assert.equal(verifyStagedControlledProductionWeightDecision(decision), true);
  assert.ok(Math.abs(decision.previous_stage_applied_probability_shift - 0.01) < 1e-12);
  assert.ok(Math.abs(decision.applied_probability_shift - 0.02) < 1e-12);
  assert.ok(Math.abs(decision.previous_stage_probability - 0.51) < 1e-12);
  assert.ok(Math.abs(decision.staged_production_probability - 0.52) < 1e-12);
  assert.equal(decision.maximum_absolute_probability_shift, STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT);
  assert.equal(decision.capital_execution_allowed, false);
});

test('Step 17 forbids retroactive and post-event-start staged production mutation', () => {
  const { activation } = makeStagedActivation();
  assert.throws(() => applyStagedControlledProductionWeight({
    activation, matchId: 'OLD', marketKey: 'TOTALS_U35', selection: 'UNDER',
    championProbability: 0.5, challengerProbability: 0.7,
    generatedAt: '2026-03-02T23:00:00Z', eventStartAt: '2026-03-03T02:00:00Z'
  }), /STEP17_RETROACTIVE_STAGED_DECISION_FORBIDDEN/);
  assert.throws(() => applyStagedControlledProductionWeight({
    activation, matchId: 'LATE', marketKey: 'TOTALS_U35', selection: 'UNDER',
    championProbability: 0.5, challengerProbability: 0.7,
    generatedAt: '2026-03-03T02:00:00Z', eventStartAt: '2026-03-03T02:00:00Z'
  }), /STEP17_POST_EVENT_START_MUTATION_FORBIDDEN/);
});

test('Step 17 settlement must be post-event-start and remains capital locked', () => {
  const { activation } = makeStagedActivation();
  const decision = makeStagedDecision(activation);
  assert.throws(() => settleStagedControlledProductionWeightDecision({ decision, outcome: 1, settledAt: '2026-03-03T02:00:00Z' }), /STEP17_SETTLEMENT_MUST_FOLLOW_EVENT_START/);
  const settlement = settleStagedControlledProductionWeightDecision({ decision, outcome: 1, settledAt: '2026-03-03T03:00:00Z' });
  assert.equal(verifyStagedControlledProductionWeightSettlement(settlement), true);
  assert.equal(settlement.capital_execution_allowed, false);
});

test('Step 17 health accumulates before new prospective N30 and cannot auto-ramp', () => {
  const { activation } = makeStagedActivation();
  const health = evaluateStagedControlledProductionWeightHealth({
    activation, settlements: makeStagedSettlements(activation, STAGED_CONTROLLED_PRODUCTION_HEALTH_MIN_SETTLED_N - 1), evaluatedAt: '2026-03-04T00:00:00Z'
  });
  assert.equal(verifyStagedControlledProductionWeightHealth(health), true);
  assert.equal(health.state, 'STAGED_CONTROLLED_WEIGHT_HEALTH_ACCUMULATING_CAPITAL_LOCKED');
  assert.equal(health.rollback_required, false);
  assert.equal(health.governance.automatic_next_weight_increase, false);
});

test('Step 17 healthy N30 must be non-degraded versus both champion and previous-weight counterfactual', () => {
  const { activation } = makeStagedActivation();
  const health = evaluateStagedControlledProductionWeightHealth({
    activation, settlements: makeStagedSettlements(activation, 30, 1, 0.7), evaluatedAt: '2026-03-04T00:00:00Z'
  });
  assert.equal(verifyStagedControlledProductionWeightHealth(health), true);
  assert.equal(health.state, 'STAGED_CONTROLLED_WEIGHT_HEALTHY_CONTINUE_CAPITAL_LOCKED');
  assert.equal(health.gates.minimum_new_staged_settled_n_passed, true);
  assert.equal(health.gates.staged_brier_non_degradation_vs_champion_passed, true);
  assert.equal(health.gates.staged_brier_non_degradation_vs_previous_weight_passed, true);
  assert.equal(health.gates.staged_log_loss_non_degradation_vs_previous_weight_passed, true);
  assert.equal(health.governance.capital_execution_allowed, false);
  assert.equal(health.next_stage, 'STEP_18_STAGED_CONTROLLED_PRODUCTION_WEIGHT_EVIDENCE_REVIEW_AND_GOVERNANCE');
});

test('Step 17 performance degradation at N30 requires rollback rather than automatic weight reduction', () => {
  const { activation } = makeStagedActivation();
  const health = evaluateStagedControlledProductionWeightHealth({
    activation, settlements: makeStagedSettlements(activation, 30, 0, 0.7), evaluatedAt: '2026-03-04T00:00:00Z'
  });
  assert.equal(health.state, 'STAGED_CONTROLLED_WEIGHT_ROLLBACK_TO_CHAMPION_REQUIRED');
  assert.equal(health.rollback_required, true);
  const rollback = recordStagedControlledProductionWeightRollback({
    activation,
    reason: 'PERFORMANCE_DEGRADATION_AFTER_MINIMUM_N',
    actor: 'step17-operator', rationale: 'synthetic staged degradation',
    rolledBackAt: '2026-03-04T01:00:00Z', healthEvaluation: health
  });
  assert.equal(verifyStagedControlledProductionWeightRollback(rollback), true);
  assert.equal(rollback.enforcement.production_decision_weight, 0);
  assert.equal(rollback.enforcement.probability_influence, 0);
});

test('Step 17 integrity signal causes immediate rollback requirement even before N30', () => {
  const { activation } = makeStagedActivation();
  const health = evaluateStagedControlledProductionWeightHealth({
    activation,
    settlements: makeStagedSettlements(activation, 5),
    evaluatedAt: '2026-03-04T00:00:00Z',
    integritySignals: ['STEP16_AUTHORIZATION_OR_REVIEW_DRIFT']
  });
  assert.equal(health.state, 'STAGED_CONTROLLED_WEIGHT_ROLLBACK_TO_CHAMPION_REQUIRED');
  assert.equal(health.rollback_required, true);
});

test('Step 17 rollback forces exact champion-only output with zero weight and zero influence', () => {
  const { activation } = makeStagedActivation();
  const rollback = recordStagedControlledProductionWeightRollback({
    activation,
    reason: 'MANUAL_KILL_SWITCH',
    actor: 'operator', rationale: 'synthetic kill switch',
    rolledBackAt: '2026-03-03T00:30:00Z'
  });
  const decision = makeStagedDecision(activation, 999, 0.9, rollback);
  assert.equal(decision.state, 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_ROLLED_BACK_CHAMPION_ONLY');
  assert.equal(decision.previous_stage_decision_weight, 0);
  assert.equal(decision.staged_decision_weight, 0);
  assert.equal(decision.applied_probability_shift, 0);
  assert.equal(decision.staged_production_probability, decision.champion_probability);
  assert.equal(decision.real_money, 'NO');
});

test('Step 17 constants preserve 10 percent absolute staged ceiling and unchanged 2pp probability cap', () => {
  assert.equal(STAGED_CONTROLLED_PRODUCTION_MAX_DECISION_WEIGHT, 0.10);
  assert.equal(STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT, 0.02);
  assert.equal(STAGED_CONTROLLED_PRODUCTION_HEALTH_MIN_SETTLED_N, 30);
});
