import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  PATTERN_PROMOTION_SHADOW_VERSION,
  evaluatePatternShadow,
  settlePatternShadowPrediction
} from '../src/pattern-promotion-shadow-integration.mjs';
import {
  PATTERN_SHADOW_FORWARD_APPROVAL_VERSION,
  FORWARD_MIN_SETTLED_N,
  freezePatternPromotionDossier,
  verifyPatternPromotionDossier,
  registerPatternForwardShadowObservation,
  evaluatePatternForwardMonitoring,
  verifyPatternForwardMonitoringEvaluation,
  recordPatternPromotionApproval,
  verifyPatternPromotionApproval
} from '../src/pattern-shadow-forward-monitoring-promotion-approval.mjs';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(stableStringify(value)).digest('hex'); }
function loss(p, y) {
  const eps = 1e-15;
  return {
    brier: (p - y) ** 2,
    log_loss: -(y * Math.log(Math.max(eps, p)) + (1 - y) * Math.log(Math.max(eps, 1 - p)))
  };
}

function step8Settlement(i, { baseline = 0.55, shadow = 0.65, outcome = i % 10 < 7 ? 1 : 0, clv = 0.01 } = {}) {
  const payload = {
    settlement_version: PATTERN_PROMOTION_SHADOW_VERSION,
    match_id: `STEP8-${i}`,
    market_key: 'BINARY_TEST',
    selection: 'YES',
    outcome,
    settled_at: '2026-10-01T14:00:00Z',
    source_shadow_prediction_fingerprint: `STEP8-PRED-${i}`,
    baseline_probability: baseline,
    shadow_probability: shadow,
    baseline_loss: loss(baseline, outcome),
    shadow_loss: loss(shadow, outcome),
    verified_market_clv: clv,
    governance: { shadow_only: true, decision_weight: 0, settlement_rewrites_prediction: false }
  };
  return { ...payload, settlement_fingerprint: sha256(payload) };
}

function eligibleStep8() {
  const settlements = Array.from({ length: 100 }, (_, i) => step8Settlement(i));
  const evaluation = evaluatePatternShadow({ settlements, evaluatedAt: '2026-10-02T00:00:00Z' });
  assert.equal(evaluation.state, 'ELIGIBLE_FOR_MANUAL_GOVERNANCE_REVIEW_ZERO_WEIGHT');
  return { settlements, evaluation };
}

function dossier() {
  const { settlements, evaluation } = eligibleStep8();
  const d = freezePatternPromotionDossier({
    step8Evaluation: evaluation,
    step8Settlements: settlements,
    frozenAt: '2026-11-01T00:00:00Z'
  });
  return { d, settlements, evaluation };
}

function shadowPrediction(i, { baseline = 0.55, shadow = 0.65, generatedAt = '2026-11-02T10:00:00Z' } = {}) {
  const payload = {
    shadow_version: PATTERN_PROMOTION_SHADOW_VERSION,
    match_id: `FWD-${i}`,
    market_key: 'BINARY_TEST',
    selection: 'YES',
    kickoff_at: '2026-11-02T12:00:00Z',
    generated_at: generatedAt,
    baseline: { model_version: 'CHAMPION-V1', probability: baseline, generated_at: generatedAt },
    shadow: { probability: shadow, raw_logit_shift: 0.2, capped_logit_shift: 0.2, probability_delta: shadow - baseline, activations: [] },
    source_shadow_plan_fingerprint: 'STEP8-SHADOW-PLAN-FROZEN',
    governance: { shadow_only: true, decision_weight: 0, baseline_mutated: false, production_decision_affected: false, market_data_used_as_prediction_input: false }
  };
  return { ...payload, shadow_prediction_fingerprint: sha256(payload) };
}

function forwardObservation(d, i, { help = true } = {}) {
  const outcome = help ? (i % 10 < 7 ? 1 : 0) : (i % 10 < 5 ? 1 : 0);
  const baseline = help ? 0.55 : 0.70;
  const shadow = help ? 0.65 : 0.85;
  const prediction = shadowPrediction(i, { baseline, shadow });
  const settlement = settlePatternShadowPrediction({
    shadowPrediction: prediction,
    outcome,
    settledAt: '2026-11-02T14:00:00Z',
    verifiedMarketClv: help ? 0.01 : -0.01
  });
  return registerPatternForwardShadowObservation({
    dossier: d,
    shadowPrediction: prediction,
    settlement,
    registeredAt: '2026-11-02T14:01:00Z'
  });
}

function forwardRows(d, n, options = {}) {
  return Array.from({ length: n }, (_, i) => forwardObservation(d, i, options));
}

test('Step 9 freezes an exact eligible Step 8 cohort and remains zero weight', () => {
  const { d } = dossier();
  assert.equal(PATTERN_SHADOW_FORWARD_APPROVAL_VERSION, 'PATTERN_SHADOW_FORWARD_MONITORING_PROMOTION_APPROVAL_V0_1');
  assert.equal(d.state, 'PROMOTION_DOSSIER_FROZEN_FORWARD_MONITORING_ONLY');
  assert.equal(d.source_step8_settled_n, 100);
  assert.equal(d.source_step8_settlement_fingerprints.length, 100);
  assert.equal(d.governance.decision_weight, 0);
  assert.equal(d.governance.champion_remains_authoritative, true);
  assert.equal(verifyPatternPromotionDossier(d), true);
});

test('non-eligible Step 8 result cannot create a promotion dossier', () => {
  const settlements = Array.from({ length: 100 }, (_, i) => step8Settlement(i, { baseline: 0.75, shadow: 0.85, outcome: i % 10 < 5 ? 1 : 0, clv: -0.01 }));
  const evaluation = evaluatePatternShadow({ settlements, evaluatedAt: '2026-10-02T00:00:00Z' });
  assert.equal(evaluation.state, 'RETAIN_CHAMPION_SHADOW_NOT_PROVEN');
  assert.throws(() => freezePatternPromotionDossier({ step8Evaluation: evaluation, step8Settlements: settlements, frozenAt: '2026-11-01T00:00:00Z' }), /STEP9_STEP8_MANUAL_REVIEW_ELIGIBILITY_REQUIRED/);
});

test('Step 8 evidence reuse is forbidden in Step 9 forward cohort', () => {
  const { d } = dossier();
  const prediction = shadowPrediction(999);
  const reused = step8Settlement(0);
  const rewritten = { ...reused, source_shadow_prediction_fingerprint: prediction.shadow_prediction_fingerprint };
  const { settlement_fingerprint: _old, ...payload } = rewritten;
  const settlement = { ...payload, settlement_fingerprint: sha256(payload) };
  assert.throws(() => registerPatternForwardShadowObservation({ dossier: d, shadowPrediction: { ...prediction, match_id: 'STEP8-0' }, settlement, registeredAt: '2026-11-02T14:01:00Z' }), /STEP9_SHADOW_PREDICTION_FINGERPRINT_INVALID|STEP9_STEP8_EVIDENCE_REUSE_FORBIDDEN|STEP9_MATCH_MARKET_SELECTION_LINEAGE_MISMATCH/);
});

test('forward shadow prediction must be generated after dossier freeze and before kickoff', () => {
  const { d } = dossier();
  const before = shadowPrediction(1, { generatedAt: '2026-10-31T23:59:00Z' });
  const settlementBefore = settlePatternShadowPrediction({ shadowPrediction: before, outcome: 1, settledAt: '2026-11-02T14:00:00Z', verifiedMarketClv: 0.01 });
  assert.throws(() => registerPatternForwardShadowObservation({ dossier: d, shadowPrediction: before, settlement: settlementBefore, registeredAt: '2026-11-02T14:01:00Z' }), /STEP9_FORWARD_PREDICTION_MUST_FOLLOW_DOSSIER_FREEZE/);
  const afterKickoff = shadowPrediction(2, { generatedAt: '2026-11-02T12:00:00Z' });
  const settlementAfter = settlePatternShadowPrediction({ shadowPrediction: afterKickoff, outcome: 1, settledAt: '2026-11-02T14:00:00Z', verifiedMarketClv: 0.01 });
  assert.throws(() => registerPatternForwardShadowObservation({ dossier: d, shadowPrediction: afterKickoff, settlement: settlementAfter, registeredAt: '2026-11-02T14:01:00Z' }), /STEP9_POST_KICKOFF_SHADOW_PREDICTION_FORBIDDEN/);
});

test('N=29 remains forward monitoring only with no approval eligibility', () => {
  const { d } = dossier();
  const e = evaluatePatternForwardMonitoring({ dossier: d, observations: forwardRows(d, 29), evaluatedAt: '2026-11-03T00:00:00Z' });
  assert.equal(FORWARD_MIN_SETTLED_N, 30);
  assert.equal(e.state, 'FORWARD_MONITORING_ACCUMULATING_ZERO_WEIGHT');
  assert.equal(e.gates.minimum_new_forward_n, false);
  assert.equal(e.governance.decision_weight, 0);
});

test('N=30 healthy new forward cohort becomes explicit canary-approval eligible only', () => {
  const { d } = dossier();
  const e = evaluatePatternForwardMonitoring({ dossier: d, observations: forwardRows(d, 30), evaluatedAt: '2026-11-03T00:00:00Z' });
  assert.equal(e.state, 'ELIGIBLE_FOR_EXPLICIT_CONTROLLED_CANARY_APPROVAL_ZERO_WEIGHT');
  assert.equal(e.gates.minimum_new_forward_n, true);
  assert.equal(e.gates.brier_better_overall, true);
  assert.equal(e.gates.log_loss_better_overall, true);
  assert.equal(e.gates.ece_non_degradation, true);
  assert.equal(e.gates.verified_market_clv_positive, true);
  assert.equal(e.gates.chronological_half_non_degradation, true);
  assert.equal(e.additional_alpha_spent, false);
  assert.equal(verifyPatternForwardMonitoringEvaluation(e), true);
});

test('degraded forward cohort retains shadow and champion authority', () => {
  const { d } = dossier();
  const e = evaluatePatternForwardMonitoring({ dossier: d, observations: forwardRows(d, 30, { help: false }), evaluatedAt: '2026-11-03T00:00:00Z' });
  assert.equal(e.state, 'FORWARD_MONITORING_DEGRADED_RETAIN_SHADOW_ZERO_WEIGHT');
  assert.equal(e.governance.champion_remains_authoritative, true);
  assert.equal(e.governance.decision_weight, 0);
});

test('controlled canary approval requires eligible forward evidence, named approver and rationale', () => {
  const { d } = dossier();
  const eligible = evaluatePatternForwardMonitoring({ dossier: d, observations: forwardRows(d, 30), evaluatedAt: '2026-11-03T00:00:00Z' });
  assert.throws(() => recordPatternPromotionApproval({ dossier: d, forwardEvaluation: eligible, decision: 'APPROVE_CONTROLLED_CANARY', approver: '', rationale: 'x', decidedAt: '2026-11-03T01:00:00Z' }), /STEP9_APPROVER_REQUIRED/);
  const approval = recordPatternPromotionApproval({ dossier: d, forwardEvaluation: eligible, decision: 'APPROVE_CONTROLLED_CANARY', approver: 'GOVERNANCE_REVIEWER', rationale: 'Forward cohort passed all frozen gates.', decidedAt: '2026-11-03T01:00:00Z' });
  assert.equal(approval.state, 'CONTROLLED_CANARY_APPROVED_NOT_ACTIVATED_ZERO_WEIGHT');
  assert.equal(approval.authorization.controlled_canary_may_be_implemented_next_stage, true);
  assert.equal(approval.authorization.production_activation_performed_here, false);
  assert.equal(approval.authorization.decision_weight_change_authorized_here, false);
  assert.equal(approval.governance.decision_weight, 0);
  assert.equal(verifyPatternPromotionApproval(approval), true);
});

test('degraded evidence cannot be approved but can be explicitly rejected/continued in shadow', () => {
  const { d } = dossier();
  const degraded = evaluatePatternForwardMonitoring({ dossier: d, observations: forwardRows(d, 30, { help: false }), evaluatedAt: '2026-11-03T00:00:00Z' });
  assert.throws(() => recordPatternPromotionApproval({ dossier: d, forwardEvaluation: degraded, decision: 'APPROVE_CONTROLLED_CANARY', approver: 'GOV', rationale: 'No', decidedAt: '2026-11-03T01:00:00Z' }), /STEP9_CONTROLLED_CANARY_APPROVAL_WITHOUT_FORWARD_ELIGIBILITY_FORBIDDEN/);
  const rejected = recordPatternPromotionApproval({ dossier: d, forwardEvaluation: degraded, decision: 'REJECT_OR_CONTINUE_SHADOW', approver: 'GOV', rationale: 'Forward degradation retained.', decidedAt: '2026-11-03T01:00:00Z' });
  assert.equal(rejected.state, 'PROMOTION_REJECTED_OR_CONTINUE_SHADOW_ZERO_WEIGHT');
  assert.equal(rejected.authorization.controlled_canary_may_be_implemented_next_stage, false);
});

test('tampered approval fails closed and rollback policy remains pre-registered', () => {
  const { d } = dossier();
  const e = evaluatePatternForwardMonitoring({ dossier: d, observations: forwardRows(d, 30), evaluatedAt: '2026-11-03T00:00:00Z' });
  const approval = recordPatternPromotionApproval({ dossier: d, forwardEvaluation: e, decision: 'APPROVE_CONTROLLED_CANARY', approver: 'GOV', rationale: 'All gates passed.', decidedAt: '2026-11-03T01:00:00Z' });
  assert.equal(approval.rollback_policy_for_next_stage.brier_degradation, 'ROLLBACK_TO_CHAMPION');
  const broken = structuredClone(approval);
  broken.governance.decision_weight = 1;
  assert.throws(() => verifyPatternPromotionApproval(broken), /STEP9_APPROVAL_FINGERPRINT_INVALID|STEP9_APPROVAL_PRODUCTION_INFLUENCE_FORBIDDEN/);
});
