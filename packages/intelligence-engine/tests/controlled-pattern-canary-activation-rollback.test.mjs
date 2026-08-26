import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PATTERN_PROMOTION_SHADOW_VERSION } from '../src/pattern-promotion-shadow-integration.mjs';
import { PATTERN_SHADOW_FORWARD_APPROVAL_VERSION } from '../src/pattern-shadow-forward-monitoring-promotion-approval.mjs';
import {
  CONTROLLED_PATTERN_CANARY_VERSION,
  CANARY_MAX_ROUTING_FRACTION,
  CANARY_MAX_ABS_PROBABILITY_SHIFT,
  CANARY_HEALTH_MIN_SETTLED_N,
  createControlledPatternCanaryAuthorization,
  routeControlledPatternCanary,
  settleControlledPatternCanaryDecision,
  evaluateControlledPatternCanaryHealth,
  recordControlledPatternCanaryRollback,
  verifyControlledPatternCanaryAuthorization,
  verifyControlledPatternCanaryHealth,
  verifyPatternCanaryRollbackRecord
} from '../src/controlled-pattern-canary-activation-rollback.mjs';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(stableStringify(value)).digest('hex'); }
function withFingerprint(payload, field) { return { ...payload, [field]: sha256(payload) }; }

function shadowPlan() {
  const payload = {
    plan_version: PATTERN_PROMOTION_SHADOW_VERSION,
    state: 'SHADOW_PLAN_READY_ZERO_WEIGHT',
    created_at: '2026-09-20T00:00:00Z',
    source_step7_fingerprint: 'STEP7-SYNTHETIC',
    validated_pattern_ids: ['PATTERN-A'],
    validated_pattern_result_fingerprints: ['PATTERN-A-RESULT'],
    calibration: {
      version: 'PATTERN-CAL-SYNTHETIC', provenance: 'SYNTHETIC_TEST_ONLY', verified: true, independent: true,
      sample_n: 60, trained_through: '2026-09-15T00:00:00Z', uses_bookmaker_odds: false,
      pattern_coefficients: { 'PATTERN-A': { logit_beta: 0.25 } },
      max_abs_logit_shift: 0.35, max_abs_probability_shift: 0.10
    },
    blockers: [],
    integration: {
      mode: 'SHADOW_ONLY', champion_path_authoritative: true,
      champion_challenger_owner: 'packages/intelligence-engine/src/champion-challenger.mjs',
      governed_learning_owner: 'packages/intelligence-engine/src/governed-learning-loop.mjs',
      calibrated_team_intelligence_owner_unchanged: true,
      baseline_prediction_mutation_allowed: false, shadow_prediction_may_reach_decision_path: false
    },
    governance: { decision_weight: 0, automatic_promotion: false, automatic_retuning: false, production_mutation_allowed: false, p002_changed: false, gate1_to_gate6_ownership_changed: false, capital_effect: 'NONE', real_money: 'NO' }
  };
  return withFingerprint(payload, 'shadow_plan_fingerprint');
}

function shadowPrediction(plan, id, { baseline = 0.55, shadow = 0.65, generatedAt = '2026-10-01T10:00:00Z', kickoffAt = '2026-10-01T12:00:00Z' } = {}) {
  const payload = {
    shadow_version: PATTERN_PROMOTION_SHADOW_VERSION,
    match_id: `MATCH-${id}`, market_key: 'BINARY_TEST', selection: 'YES', kickoff_at: kickoffAt, generated_at: generatedAt,
    baseline: { model_version: 'CHAMPION-V1', probability: baseline, generated_at: generatedAt },
    shadow: { probability: shadow, raw_logit_shift: 0.25, capped_logit_shift: 0.25, probability_delta: shadow - baseline, activations: [{ pattern_id: 'PATTERN-A', logit_beta: 0.25, provenance: 'SYNTHETIC_PREMATCH', observed_at: generatedAt }] },
    source_shadow_plan_fingerprint: plan.shadow_plan_fingerprint,
    governance: { shadow_only: true, decision_weight: 0, baseline_mutated: false, production_decision_affected: false, market_data_used_as_prediction_input: false }
  };
  return withFingerprint(payload, 'shadow_prediction_fingerprint');
}

function step8Settlement(prediction, outcome = 1) {
  const eps = 1e-15;
  const loss = p => ({ brier: (p - outcome) ** 2, log_loss: -(outcome * Math.log(Math.max(eps, p)) + (1 - outcome) * Math.log(Math.max(eps, 1 - p))) });
  const payload = {
    settlement_version: PATTERN_PROMOTION_SHADOW_VERSION,
    match_id: prediction.match_id, market_key: prediction.market_key, selection: prediction.selection,
    outcome, settled_at: '2026-10-01T14:00:00Z', source_shadow_prediction_fingerprint: prediction.shadow_prediction_fingerprint,
    baseline_probability: prediction.baseline.probability, shadow_probability: prediction.shadow.probability,
    baseline_loss: loss(prediction.baseline.probability), shadow_loss: loss(prediction.shadow.probability), verified_market_clv: 0.01,
    governance: { shadow_only: true, decision_weight: 0, settlement_rewrites_prediction: false }
  };
  return withFingerprint(payload, 'settlement_fingerprint');
}

function approvedLineage() {
  const plan = shadowPlan();
  const predictions = Array.from({ length: 100 }, (_, i) => shadowPrediction(plan, `S8-${i}`));
  const settlements = predictions.map(p => step8Settlement(p, 1));
  const dossierPayload = {
    dossier_version: PATTERN_SHADOW_FORWARD_APPROVAL_VERSION,
    state: 'PROMOTION_DOSSIER_FROZEN_FORWARD_MONITORING_ONLY', frozen_at: '2026-10-03T00:00:00Z',
    source_step8_evaluation_fingerprint: 'STEP8-EVAL-SYNTHETIC', source_step8_settled_n: 100,
    source_step8_settlement_fingerprints: settlements.map(s => s.settlement_fingerprint).sort(),
    excluded_step8_match_market_selection_keys: settlements.map(s => `${s.match_id}|${s.market_key}|${s.selection}`).sort(),
    source_step8_metrics: { champion: { n: 100 }, shadow_challenger: { n: 100 } },
    forward_plan: { minimum_new_settled_n: 30 }, rollback_policy_for_next_stage: { provenance_or_fingerprint_failure: 'ROLLBACK_TO_CHAMPION' },
    governance: { decision_weight: 0, automatic_approval: false, automatic_promotion: false, automatic_retuning: false, production_mutation_allowed: false, champion_remains_authoritative: true, p002_changed: false, gate1_to_gate6_ownership_changed: false, capital_effect: 'NONE', real_money: 'NO' }
  };
  const dossier = withFingerprint(dossierPayload, 'dossier_fingerprint');
  const forwardPayload = {
    evaluation_version: PATTERN_SHADOW_FORWARD_APPROVAL_VERSION,
    state: 'ELIGIBLE_FOR_EXPLICIT_CONTROLLED_CANARY_APPROVAL_ZERO_WEIGHT', evaluated_at: '2026-11-01T00:00:00Z',
    dossier_fingerprint: dossier.dossier_fingerprint, forward_settled_n: 30, minimum_forward_settled_n: 30,
    champion: { n: 30, brier: 0.25, logLoss: 0.69, ece: 0.05, clv: 0 }, shadow: { n: 30, brier: 0.22, logLoss: 0.64, ece: 0.04, clv: 0.01 },
    chronological_halves: [],
    gates: { minimum_new_forward_n: true, brier_better_overall: true, log_loss_better_overall: true, ece_non_degradation: true, verified_market_clv_complete: true, verified_market_clv_positive: true, chronological_half_non_degradation: true },
    additional_alpha_spent: false,
    governance: { decision_weight: 0, explicit_human_approval_required: true, automatic_approval: false, automatic_promotion: false, production_mutation_allowed: false, champion_remains_authoritative: true, capital_effect: 'NONE', real_money: 'NO' }
  };
  const forwardEvaluation = withFingerprint(forwardPayload, 'forward_evaluation_fingerprint');
  const approvalPayload = {
    approval_version: PATTERN_SHADOW_FORWARD_APPROVAL_VERSION,
    state: 'CONTROLLED_CANARY_APPROVED_NOT_ACTIVATED_ZERO_WEIGHT', decision: 'APPROVE_CONTROLLED_CANARY', approver: 'SYNTHETIC-APPROVER', rationale: 'Synthetic test only', decided_at: '2026-11-02T00:00:00Z',
    dossier_fingerprint: dossier.dossier_fingerprint, forward_evaluation_fingerprint: forwardEvaluation.forward_evaluation_fingerprint,
    rollback_policy_for_next_stage: dossier.rollback_policy_for_next_stage,
    authorization: { controlled_canary_may_be_implemented_next_stage: true, production_activation_performed_here: false, decision_weight_change_authorized_here: false, capital_use_authorized: false },
    governance: { decision_weight: 0, automatic_approval: false, automatic_promotion: false, automatic_retuning: false, production_mutation_allowed: false, champion_remains_authoritative: true, p002_changed: false, gate1_to_gate6_ownership_changed: false, capital_effect: 'NONE', real_money: 'NO' },
    next_stage: 'STEP_10_CONTROLLED_PATTERN_CANARY_ACTIVATION_AND_ROLLBACK_ENFORCEMENT'
  };
  const approval = withFingerprint(approvalPayload, 'approval_fingerprint');
  return { plan, predictions, settlements, dossier, forwardEvaluation, approval };
}

function authorization(overrides = {}) {
  const x = approvedLineage();
  return {
    lineage: x,
    authorization: createControlledPatternCanaryAuthorization({
      approval: x.approval, dossier: x.dossier, forwardEvaluation: x.forwardEvaluation, shadowPlan: x.plan,
      step8ShadowPredictions: x.predictions, step8Settlements: x.settlements,
      activatedAt: '2026-11-03T00:00:00Z', activator: 'SYNTHETIC-ACTIVATOR', rationale: 'Synthetic controlled canary test',
      ...overrides
    })
  };
}

function futurePrediction(plan, id, options = {}) {
  return shadowPrediction(plan, `CANARY-${id}`, { generatedAt: '2026-11-04T10:00:00Z', kickoffAt: '2026-11-04T12:00:00Z', ...options });
}

function routedDecisions(auth, plan, n) {
  const out = [];
  for (let i = 0; i < 10000 && out.length < n; i += 1) {
    const d = routeControlledPatternCanary({ authorization: auth, shadowPrediction: futurePrediction(plan, i), routedAt: '2026-11-04T10:01:00Z' });
    if (d.canary.applied) out.push(d);
  }
  assert.equal(out.length, n);
  return out;
}

test('Step 10 authorization binds exact Step8/Step9 lineage and conservative caps', () => {
  const { authorization: a } = authorization();
  assert.equal(CONTROLLED_PATTERN_CANARY_VERSION, 'CONTROLLED_PATTERN_CANARY_ACTIVATION_ROLLBACK_V0_1');
  assert.equal(CANARY_MAX_ROUTING_FRACTION, 0.05);
  assert.equal(CANARY_MAX_ABS_PROBABILITY_SHIFT, 0.02);
  assert.equal(a.routing.active_fraction, 0.05);
  assert.equal(a.influence.maximum_absolute_probability_shift, 0.02);
  assert.equal(a.governance.production_decision_weight, 0);
  assert.equal(a.governance.capital_execution_allowed, false);
  assert.equal(a.governance.real_money, 'NO');
  assert.equal(verifyControlledPatternCanaryAuthorization(a), true);
});

test('authorization rejects insufficient Step9 forward evidence and Step8 plan lineage drift', () => {
  const x = approvedLineage();
  const weak = structuredClone(x.forwardEvaluation);
  const { forward_evaluation_fingerprint: _, ...weakPayload0 } = weak;
  const weakPayload = { ...weakPayload0, forward_settled_n: 29 };
  const weakEval = withFingerprint(weakPayload, 'forward_evaluation_fingerprint');
  const approvalPayload = { ...x.approval, forward_evaluation_fingerprint: weakEval.forward_evaluation_fingerprint };
  delete approvalPayload.approval_fingerprint;
  const weakApproval = withFingerprint(approvalPayload, 'approval_fingerprint');
  assert.throws(() => createControlledPatternCanaryAuthorization({ approval: weakApproval, dossier: x.dossier, forwardEvaluation: weakEval, shadowPlan: x.plan, step8ShadowPredictions: x.predictions, step8Settlements: x.settlements, activatedAt: '2026-11-03T00:00:00Z', activator: 'A', rationale: 'R' }), /STEP10_STEP9_FORWARD_ELIGIBILITY_REQUIRED/);
  const driftPlan = structuredClone(x.plan); driftPlan.calibration.version = 'DRIFTED'; delete driftPlan.shadow_plan_fingerprint; const refingerprinted = withFingerprint(driftPlan, 'shadow_plan_fingerprint');
  assert.throws(() => createControlledPatternCanaryAuthorization({ approval: x.approval, dossier: x.dossier, forwardEvaluation: x.forwardEvaluation, shadowPlan: refingerprinted, step8ShadowPredictions: x.predictions, step8Settlements: x.settlements, activatedAt: '2026-11-03T00:00:00Z', activator: 'A', rationale: 'R' }), /STEP10_SHADOW_PLAN_LINEAGE_DRIFT/);
});

test('routing is deterministic, capped, and unrouted units remain champion', () => {
  const { authorization: a, lineage } = authorization();
  let routed = null; let fallback = null;
  for (let i = 0; i < 2000 && (!routed || !fallback); i += 1) {
    const p = futurePrediction(lineage.plan, i);
    const d1 = routeControlledPatternCanary({ authorization: a, shadowPrediction: p, routedAt: '2026-11-04T10:01:00Z' });
    const d2 = routeControlledPatternCanary({ authorization: a, shadowPrediction: p, routedAt: '2026-11-04T10:01:00Z' });
    assert.equal(d1.routing.selected, d2.routing.selected);
    assert.equal(d1.routing.value, d2.routing.value);
    if (d1.canary.applied) routed = d1; else fallback = d1;
  }
  assert.ok(routed); assert.ok(fallback);
  assert.ok(Math.abs(routed.canary.bounded_probability_delta) <= 0.02 + 1e-12);
  assert.equal(fallback.canary.probability, fallback.champion.probability);
  assert.equal(fallback.governance.capital_execution_allowed, false);
});

test('routing after kickoff is forbidden', () => {
  const { authorization: a, lineage } = authorization();
  assert.throws(() => routeControlledPatternCanary({ authorization: a, shadowPrediction: futurePrediction(lineage.plan, 1), routedAt: '2026-11-04T12:00:00Z' }), /STEP10_POST_KICKOFF_CANARY_ROUTING_FORBIDDEN/);
});

test('canary health accumulates below N30 and does not promote', () => {
  const { authorization: a, lineage } = authorization();
  const rows = routedDecisions(a, lineage.plan, 29).map(d => settleControlledPatternCanaryDecision({ decision: d, outcome: 1, settledAt: '2026-11-04T14:00:00Z' }));
  const h = evaluateControlledPatternCanaryHealth({ authorization: a, settlements: rows, evaluatedAt: '2026-11-05T00:00:00Z' });
  assert.equal(CANARY_HEALTH_MIN_SETTLED_N, 30);
  assert.equal(h.state, 'CANARY_HEALTH_ACCUMULATING_PAPER_ONLY');
  assert.equal(h.rollback_required, false);
  assert.equal(h.governance.automatic_full_promotion, false);
});

test('healthy N30 canary may continue paper-only but still has zero production weight', () => {
  const { authorization: a, lineage } = authorization();
  const rows = routedDecisions(a, lineage.plan, 30).map(d => settleControlledPatternCanaryDecision({ decision: d, outcome: 1, settledAt: '2026-11-04T14:00:00Z' }));
  const h = evaluateControlledPatternCanaryHealth({ authorization: a, settlements: rows, evaluatedAt: '2026-11-05T00:00:00Z' });
  assert.equal(h.state, 'CANARY_HEALTHY_CONTINUE_PAPER_ONLY');
  assert.equal(h.rollback_required, false);
  assert.equal(h.governance.production_decision_weight, 0);
  assert.equal(verifyControlledPatternCanaryHealth(h), true);
});

test('performance degradation at N30 requires rollback to champion', () => {
  const { authorization: a, lineage } = authorization();
  const rows = routedDecisions(a, lineage.plan, 30).map(d => settleControlledPatternCanaryDecision({ decision: d, outcome: 0, settledAt: '2026-11-04T14:00:00Z' }));
  const h = evaluateControlledPatternCanaryHealth({ authorization: a, settlements: rows, evaluatedAt: '2026-11-05T00:00:00Z' });
  assert.equal(h.state, 'ROLLBACK_TO_CHAMPION_REQUIRED');
  assert.equal(h.rollback_reason, 'CANARY_PERFORMANCE_DEGRADATION');
  const rb = recordControlledPatternCanaryRollback({ authorization: a, healthEvaluation: h, reason: 'CANARY_PERFORMANCE_DEGRADATION', actor: 'SYSTEM-GOVERNOR', rationale: 'Synthetic degradation test', rolledBackAt: '2026-11-05T00:01:00Z' });
  assert.equal(rb.enforcement.routing_fraction_after_rollback, 0);
  assert.equal(rb.enforcement.canary_probability_influence_after_rollback, 0);
  assert.equal(verifyPatternCanaryRollbackRecord(rb), true);
});

test('integrity signal triggers immediate rollback without waiting for N30', () => {
  const { authorization: a } = authorization();
  const h = evaluateControlledPatternCanaryHealth({ authorization: a, settlements: [], evaluatedAt: '2026-11-05T00:00:00Z', integritySignals: ['LINEAGE_OR_CALIBRATION_DRIFT'] });
  assert.equal(h.rollback_required, true);
  assert.equal(h.rollback_reason, 'IMMEDIATE_INTEGRITY_OR_KILL_SIGNAL');
  assert.equal(h.gates.minimum_n, false);
});

test('rollback record enforces champion-only routing and cannot reuse same authorization', () => {
  const { authorization: a, lineage } = authorization();
  const rb = recordControlledPatternCanaryRollback({ authorization: a, reason: 'MANUAL_KILL_SWITCH', actor: 'HUMAN-GOVERNOR', rationale: 'Manual emergency stop synthetic test', rolledBackAt: '2026-11-04T09:00:00Z' });
  const d = routeControlledPatternCanary({ authorization: a, shadowPrediction: futurePrediction(lineage.plan, 444), routedAt: '2026-11-04T10:01:00Z', rollbackRecord: rb });
  assert.equal(d.state, 'CHAMPION_FALLBACK_CANARY_ROLLED_BACK');
  assert.equal(d.canary.applied, false);
  assert.equal(d.canary.probability, d.champion.probability);
  assert.equal(d.governance.rollback_enforced, true);
  assert.equal(rb.governance.canary_reactivation_allowed, false);
});

test('tampered authorization fails closed', () => {
  const { authorization: a } = authorization();
  const broken = structuredClone(a); broken.routing.active_fraction = 0.50;
  assert.throws(() => verifyControlledPatternCanaryAuthorization(broken), /STEP10_CANARY_AUTHORIZATION_FINGERPRINT_INVALID|STEP10_CANARY_AUTHORIZATION_CAP_BREACH/);
});
