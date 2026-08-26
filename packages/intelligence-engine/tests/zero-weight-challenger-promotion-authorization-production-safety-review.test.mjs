import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PATTERN_CANARY_GRADUATION_GOVERNANCE_VERSION } from '../src/pattern-canary-graduation-retirement-governance.mjs';
import {
  ZERO_WEIGHT_CHALLENGER_PROMOTION_SAFETY_VERSION,
  REQUIRED_PRODUCTION_SAFETY_CONTROLS,
  createZeroWeightChallengerProductionSafetyReview,
  verifyZeroWeightChallengerProductionSafetyReview,
  recordZeroWeightChallengerPromotionAuthorization,
  verifyZeroWeightChallengerPromotionAuthorization
} from '../src/zero-weight-challenger-promotion-authorization-production-safety-review.mjs';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(stableStringify(value)).digest('hex'); }
function withFingerprint(payload, field) { return Object.freeze({ ...payload, [field]: sha256(payload) }); }

function makeGraduationDossier() {
  const payload = {
    dossier_version: PATTERN_CANARY_GRADUATION_GOVERNANCE_VERSION,
    state: 'ELIGIBLE_FOR_MANUAL_GRADUATION_HOLD_OR_RETIREMENT_ZERO_WEIGHT',
    frozen_at: '2026-02-01T00:00:00Z',
    source_step10_canary_authorization_fingerprint: 'step10-fixture',
    source_step11_expansion_decision_fingerprint: 'step11-fixture',
    source_step12_activation_fingerprint: 'step12-activation-fixture',
    source_step12_health_fingerprint: 'step12-health-fixture',
    source_step12_cohort_manifest_fingerprint: 'step12-manifest-fixture',
    source_shadow_plan_fingerprint: 'shadow-plan-fixture',
    approved_pattern_ids: ['P002'],
    calibration: { version: 'calibration-v1', provenance: 'synthetic-test-only' },
    routing_lineage: { method: 'DETERMINISTIC_SHA256_MATCH_MARKET_SELECTION', seed: 'seed-fixture', previous_fraction: 0.05, staged_fraction: 0.10 },
    influence: { maximum_absolute_probability_shift: 0.02 },
    evidence: {
      full_stage_routed_settled_n: 30,
      expansion_band_routed_settled_n: 30,
      settlement_fingerprints: Array.from({ length: 30 }, (_, i) => `settlement-${i}`),
      full_stage: { champion: { n: 30 }, canary: { n: 30 } },
      expansion_band: { champion: { n: 30 }, canary: { n: 30 } },
      pre_health_cohort_manifest_bound: true,
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
  return withFingerprint(payload, 'graduation_dossier_fingerprint');
}

function makeGraduationDecision(dossier, overrides = {}) {
  const candidate = {
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
  const payload = {
    decision_version: PATTERN_CANARY_GRADUATION_GOVERNANCE_VERSION,
    state: 'PATTERN_GRADUATED_ZERO_WEIGHT_CHALLENGER_CANDIDATE_NOT_PRODUCTION_ACTIVATED',
    decision: 'GRADUATE_TO_ZERO_WEIGHT_CHALLENGER_CANDIDATE',
    approver: 'step13-governor',
    rationale: 'synthetic graduated zero-weight candidate',
    decided_at: '2026-02-02T00:00:00Z',
    graduation_dossier_fingerprint: dossier.graduation_dossier_fingerprint,
    source_step12_activation_fingerprint: dossier.source_step12_activation_fingerprint,
    source_step12_health_fingerprint: dossier.source_step12_health_fingerprint,
    candidate,
    rollback_fingerprint: null,
    enforcement: {
      step12_staged_canary_may_continue: false,
      routing_fraction_may_increase_here: false,
      probability_influence_may_increase_here: false,
      retirement_routing_fraction: null,
      retirement_probability_influence: null
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
    next_stage: 'STEP_14_ZERO_WEIGHT_CHALLENGER_PROMOTION_AUTHORIZATION_AND_PRODUCTION_SAFETY_REVIEW',
    ...overrides
  };
  return withFingerprint(payload, 'graduation_decision_fingerprint');
}

function passingControls(overrides = {}) {
  return Object.fromEntries(REQUIRED_PRODUCTION_SAFETY_CONTROLS.map(control => [control, overrides[control] ?? true]));
}
function evidenceRefs(overrides = {}) {
  return Object.fromEntries(REQUIRED_PRODUCTION_SAFETY_CONTROLS.map(control => [control, overrides[control] ?? `synthetic-evidence:${control}`]));
}
function makePassingReview() {
  const dossier = makeGraduationDossier();
  const graduationDecision = makeGraduationDecision(dossier);
  const review = createZeroWeightChallengerProductionSafetyReview({
    graduationDossier: dossier,
    graduationDecision,
    controls: passingControls(),
    evidenceReferences: evidenceRefs(),
    reviewer: 'step14-reviewer',
    reviewedAt: '2026-02-03T00:00:00Z',
    rationale: 'synthetic production safety review only'
  });
  return { dossier, graduationDecision, review };
}

test('Step 14 binds exact Step 13 graduated candidate and passes only with every safety control evidenced', () => {
  const { review } = makePassingReview();
  assert.equal(verifyZeroWeightChallengerProductionSafetyReview(review), true);
  assert.equal(review.review_version, ZERO_WEIGHT_CHALLENGER_PROMOTION_SAFETY_VERSION);
  assert.equal(review.state, 'ZERO_WEIGHT_CHALLENGER_PRODUCTION_SAFETY_REVIEW_PASS_NOT_ACTIVATED');
  assert.equal(review.eligible_for_manual_authorization, true);
  assert.equal(review.failed_controls.length, 0);
  assert.equal(review.candidate.decision_weight, 0);
  assert.equal(review.governance.capital_execution_allowed, false);
  assert.equal(review.evaluation_firewall.graduation_evidence_reuse_for_training, false);
  assert.equal(review.evaluation_firewall.graduation_evidence_reuse_for_retuning, false);
});

test('Step 14 rejects Step 13 HOLD or non-graduation decision lineage', () => {
  const dossier = makeGraduationDossier();
  const bad = makeGraduationDecision(dossier, {
    state: 'STAGED_CANARY_HELD_AT_STEP12_AWAITING_NEW_EVIDENCE',
    decision: 'HOLD_STAGED_CANARY',
    candidate: null,
    enforcement: {
      step12_staged_canary_may_continue: true,
      routing_fraction_may_increase_here: false,
      probability_influence_may_increase_here: false,
      retirement_routing_fraction: null,
      retirement_probability_influence: null
    },
    next_stage: 'CONTINUE_STEP12_STAGED_CANARY_MONITORING_AND_REQUIRE_NEW_PRE_HEALTH_MANIFEST_AND_DOSSIER_FOR_LATER_DECISION'
  });
  assert.throws(() => createZeroWeightChallengerProductionSafetyReview({
    graduationDossier: dossier,
    graduationDecision: bad,
    controls: passingControls(),
    evidenceReferences: evidenceRefs(),
    reviewer: 'x', reviewedAt: '2026-02-03T00:00:00Z', rationale: 'x'
  }), /STEP14_EXACT_STEP13_GRADUATION_DECISION_REQUIRED/);
});

test('Step 14 fails closed when one safety control fails and records the failed gate', () => {
  const dossier = makeGraduationDossier();
  const graduationDecision = makeGraduationDecision(dossier);
  const controls = passingControls({ GATE6_CAPITAL_LOCK_CONFIRMED: false });
  const review = createZeroWeightChallengerProductionSafetyReview({
    graduationDossier: dossier,
    graduationDecision,
    controls,
    evidenceReferences: evidenceRefs(),
    reviewer: 'step14-reviewer', reviewedAt: '2026-02-03T00:00:00Z', rationale: 'capital lock missing'
  });
  assert.equal(review.state, 'ZERO_WEIGHT_CHALLENGER_PRODUCTION_SAFETY_REVIEW_HOLD_OR_REJECT_REQUIRED');
  assert.equal(review.eligible_for_manual_authorization, false);
  assert.deepEqual(review.failed_controls, ['GATE6_CAPITAL_LOCK_CONFIRMED']);
});

test('Step 14 requires a traceable evidence reference for every safety control', () => {
  const dossier = makeGraduationDossier();
  const graduationDecision = makeGraduationDecision(dossier);
  const refs = evidenceRefs({ DEPLOYMENT_CHANGE_REVERSIBLE: '' });
  assert.throws(() => createZeroWeightChallengerProductionSafetyReview({
    graduationDossier: dossier,
    graduationDecision,
    controls: passingControls(),
    evidenceReferences: refs,
    reviewer: 'x', reviewedAt: '2026-02-03T00:00:00Z', rationale: 'x'
  }), /STEP14_SAFETY_EVIDENCE_REFERENCE_REQUIRED:DEPLOYMENT_CHANGE_REVERSIBLE/);
});

test('Step 14 approval authorizes only the next governed activation step and keeps production weight zero', () => {
  const { review } = makePassingReview();
  const authorization = recordZeroWeightChallengerPromotionAuthorization({
    safetyReview: review,
    decision: 'APPROVE_FOR_CONTROLLED_PRODUCTION_ACTIVATION_NOT_ACTIVATED',
    approver: 'promotion-governor',
    rationale: 'all safety controls passed but activation remains separate',
    decidedAt: '2026-02-04T00:00:00Z'
  });
  assert.equal(verifyZeroWeightChallengerPromotionAuthorization(authorization), true);
  assert.equal(authorization.state, 'ZERO_WEIGHT_CHALLENGER_APPROVED_FOR_CONTROLLED_PRODUCTION_ACTIVATION_NOT_ACTIVATED');
  assert.equal(authorization.candidate.decision_weight, 0);
  assert.equal(authorization.candidate.production_activation_performed_here, false);
  assert.equal(authorization.candidate.nonzero_production_weight_authorized_here, false);
  assert.equal(authorization.enforcement.champion_unchanged, true);
  assert.equal(authorization.governance.capital_execution_allowed, false);
  assert.equal(authorization.next_stage, 'STEP_15_CONTROLLED_PRODUCTION_ACTIVATION_AND_EMERGENCY_ROLLBACK');
});

test('Step 14 cannot approve a challenger with any failed production safety gate', () => {
  const dossier = makeGraduationDossier();
  const graduationDecision = makeGraduationDecision(dossier);
  const review = createZeroWeightChallengerProductionSafetyReview({
    graduationDossier: dossier,
    graduationDecision,
    controls: passingControls({ REGRESSION_AND_SYSTEM_ASSURANCE_GREEN: false }),
    evidenceReferences: evidenceRefs(),
    reviewer: 'step14-reviewer', reviewedAt: '2026-02-03T00:00:00Z', rationale: 'regression gate failed'
  });
  assert.throws(() => recordZeroWeightChallengerPromotionAuthorization({
    safetyReview: review,
    decision: 'APPROVE_FOR_CONTROLLED_PRODUCTION_ACTIVATION_NOT_ACTIVATED',
    approver: 'promotion-governor', rationale: 'should fail', decidedAt: '2026-02-04T00:00:00Z'
  }), /STEP14_APPROVAL_REQUIRES_ALL_SAFETY_CONTROLS_PASS/);
});

test('Step 14 HOLD remains zero weight and requires a new safety review before later approval', () => {
  const { review } = makePassingReview();
  const authorization = recordZeroWeightChallengerPromotionAuthorization({
    safetyReview: review,
    decision: 'HOLD_ZERO_WEIGHT_CHALLENGER',
    approver: 'promotion-governor', rationale: 'manual hold despite passing review', decidedAt: '2026-02-04T00:00:00Z'
  });
  assert.equal(verifyZeroWeightChallengerPromotionAuthorization(authorization), true);
  assert.equal(authorization.candidate.decision_weight, 0);
  assert.equal(authorization.enforcement.new_safety_review_required_before_future_approval, true);
  assert.equal(authorization.next_stage, 'REPEAT_STEP14_WITH_NEW_SAFETY_REVIEW_BEFORE_FUTURE_APPROVAL');
});

test('Step 14 REJECT archives only the zero-weight challenger and leaves champion and capital unchanged', () => {
  const { review } = makePassingReview();
  const authorization = recordZeroWeightChallengerPromotionAuthorization({
    safetyReview: review,
    decision: 'REJECT_ZERO_WEIGHT_CHALLENGER',
    approver: 'promotion-governor', rationale: 'candidate rejected', decidedAt: '2026-02-04T00:00:00Z'
  });
  assert.equal(verifyZeroWeightChallengerPromotionAuthorization(authorization), true);
  assert.equal(authorization.candidate.archived, true);
  assert.equal(authorization.enforcement.same_step13_graduation_decision_may_be_reauthorized_after_rejection, false);
  assert.equal(authorization.enforcement.champion_unchanged, true);
  assert.equal(authorization.governance.capital_effect, 'NONE');
});

test('Step 14 review and authorization fingerprints fail closed on tampering', () => {
  const { review } = makePassingReview();
  const tamperedReview = { ...review, eligible_for_manual_authorization: false };
  assert.throws(() => verifyZeroWeightChallengerProductionSafetyReview(tamperedReview), /STEP14_SAFETY_REVIEW_FINGERPRINT_INVALID/);

  const authorization = recordZeroWeightChallengerPromotionAuthorization({
    safetyReview: review,
    decision: 'APPROVE_FOR_CONTROLLED_PRODUCTION_ACTIVATION_NOT_ACTIVATED',
    approver: 'promotion-governor', rationale: 'valid', decidedAt: '2026-02-04T00:00:00Z'
  });
  const tamperedAuthorization = { ...authorization, candidate: { ...authorization.candidate, decision_weight: 0.1 } };
  assert.throws(() => verifyZeroWeightChallengerPromotionAuthorization(tamperedAuthorization), /STEP14_AUTHORIZATION_FINGERPRINT_INVALID/);
});
