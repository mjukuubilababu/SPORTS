import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  CONTROLLED_PRODUCTION_ACTIVATION_VERSION,
  MAX_INITIAL_PRODUCTION_DECISION_WEIGHT,
  MAX_ABSOLUTE_PROBABILITY_SHIFT,
  applyControlledProductionChallenger,
  settleControlledProductionDecision,
  evaluateControlledProductionHealth,
  verifyControlledProductionEmergencyRollback
} from '../src/controlled-production-activation-emergency-rollback.mjs';
import {
  CONTROLLED_PRODUCTION_EVIDENCE_WEIGHT_GOVERNANCE_VERSION,
  MAX_NEXT_CONTROLLED_PRODUCTION_DECISION_WEIGHT,
  MAX_WEIGHT_MULTIPLIER_PER_GOVERNED_STAGE,
  CONTROLLED_PRODUCTION_EVIDENCE_MIN_SETTLED_N,
  freezeStep15ProductionEvidenceCohortManifest,
  verifyStep15ProductionEvidenceCohortManifest,
  freezeControlledProductionEvidenceReview,
  verifyControlledProductionEvidenceReview,
  recordControlledProductionWeightGovernanceDecision,
  verifyControlledProductionWeightGovernanceDecision
} from '../src/controlled-production-evidence-review-weight-governance.mjs';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(stableStringify(value)).digest('hex'); }
function withFingerprint(payload, field) { return Object.freeze({ ...payload, [field]: sha256(payload) }); }

function makeActivation(weight = 0.05) {
  const payload = {
    activation_version: CONTROLLED_PRODUCTION_ACTIVATION_VERSION,
    state: 'CONTROLLED_PRODUCTION_ACTIVATION_ACTIVE_CAPITAL_LOCKED',
    activated_at: '2026-03-01T00:00:00Z',
    activated_by: 'step16-fixture',
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
    deployment: { deployment_reference: 'synthetic-deployment:step16', reversible: true },
    emergency_rollback: {
      kill_switch_armed: true,
      kill_switch_reference: 'synthetic-kill-switch:step16',
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

function makeSettlement(activation, i, { matchId = null, challengerProbability = 0.8, outcome = 1 } = {}) {
  const decision = applyControlledProductionChallenger({
    activation,
    matchId: matchId ?? `S16-${String(i).padStart(3, '0')}`,
    marketKey: 'TOTALS_U35',
    selection: 'UNDER',
    championProbability: 0.5,
    challengerProbability,
    generatedAt: '2026-03-01T01:00:00Z',
    eventStartAt: '2026-03-01T02:00:00Z'
  });
  return settleControlledProductionDecision({ decision, outcome, settledAt: '2026-03-01T04:00:00Z' });
}

function makeSettlements(activation, n = 30) {
  return Array.from({ length: n }, (_, i) => makeSettlement(activation, i));
}

function makeEvidenceBundle(weight = 0.05, n = 30) {
  const activation = makeActivation(weight);
  const settlements = makeSettlements(activation, n);
  const manifest = freezeStep15ProductionEvidenceCohortManifest({
    activation,
    settlements,
    frozenAt: '2026-03-02T00:00:00Z'
  });
  const health = evaluateControlledProductionHealth({
    activation,
    settlements,
    evaluatedAt: '2026-03-02T01:00:00Z'
  });
  const review = freezeControlledProductionEvidenceReview({
    activation,
    healthEvaluation: health,
    evidenceManifest: manifest,
    settlements,
    reviewedAt: '2026-03-02T02:00:00Z',
    reviewedBy: 'step16-reviewer',
    rationale: 'synthetic healthy manifest-bound Step15 evidence review'
  });
  return { activation, settlements, manifest, health, review };
}

test('Step 16 pre-health manifest cryptographically binds exact ordered Step 15 production evidence', () => {
  const activation = makeActivation();
  const settlements = makeSettlements(activation, 30);
  const manifest = freezeStep15ProductionEvidenceCohortManifest({ activation, settlements, frozenAt: '2026-03-02T00:00:00Z' });
  assert.equal(verifyStep15ProductionEvidenceCohortManifest(manifest), true);
  assert.equal(manifest.manifest_version, CONTROLLED_PRODUCTION_EVIDENCE_WEIGHT_GOVERNANCE_VERSION);
  assert.equal(manifest.state, 'STEP15_PRODUCTION_EVIDENCE_COHORT_MANIFEST_FROZEN_PRE_HEALTH');
  assert.equal(manifest.settled_n, CONTROLLED_PRODUCTION_EVIDENCE_MIN_SETTLED_N);
  assert.equal(manifest.settlement_fingerprints_in_evaluation_order.length, 30);
  assert.equal(manifest.settlement_fingerprint_set.length, 30);
  assert.equal(new Set(manifest.match_market_selection_key_set).size, 30);
  assert.equal(manifest.governance.historical_unbound_health_eligible, false);
});

test('Step 16 healthy manifest-bound evidence freezes into a manual weight-governance review without changing weight', () => {
  const { activation, review } = makeEvidenceBundle();
  assert.equal(verifyControlledProductionEvidenceReview(review), true);
  assert.equal(review.state, 'CONTROLLED_PRODUCTION_EVIDENCE_REVIEW_PASS_WEIGHT_GOVERNANCE_ELIGIBLE');
  assert.equal(review.evidence.manifest_bound, true);
  assert.equal(review.evidence.exact_health_reproduced, true);
  assert.equal(review.current_stage.decision_weight, activation.production.decision_weight);
  assert.equal(review.proposed_boundary.maximum_next_decision_weight, 0.10);
  assert.equal(review.proposed_boundary.maximum_absolute_probability_shift, 0.02);
  assert.equal(review.proposed_boundary.weight_change_applied_here, false);
  assert.equal(review.governance.capital_execution_allowed, false);
});

test('Step 16 refuses N29 before any weight-governance review can exist', () => {
  const activation = makeActivation();
  const settlements = makeSettlements(activation, 29);
  assert.throws(() => freezeStep15ProductionEvidenceCohortManifest({
    activation, settlements, frozenAt: '2026-03-02T00:00:00Z'
  }), /STEP16_MINIMUM_SETTLED_N_NOT_MET/);
});

test('Step 16 rejects same-metric settlement substitution because exact manifest fingerprints and identities are bound', () => {
  const activation = makeActivation();
  const settlements = makeSettlements(activation, 30);
  const manifest = freezeStep15ProductionEvidenceCohortManifest({ activation, settlements, frozenAt: '2026-03-02T00:00:00Z' });
  const health = evaluateControlledProductionHealth({ activation, settlements, evaluatedAt: '2026-03-02T01:00:00Z' });
  const substituted = [...settlements];
  substituted[0] = makeSettlement(activation, 0, { matchId: 'SAME-METRIC-DIFFERENT-EVIDENCE' });
  assert.throws(() => freezeControlledProductionEvidenceReview({
    activation,
    healthEvaluation: health,
    evidenceManifest: manifest,
    settlements: substituted,
    reviewedAt: '2026-03-02T02:00:00Z',
    reviewedBy: 'reviewer',
    rationale: 'must reject cohort substitution'
  }), /STEP16_MANIFEST_BOUND_COHORT_REPRODUCTION_FAILED/);
});

test('Step 16 rejects a manifest frozen after the Step 15 health evaluation even if the cohort is otherwise exact', () => {
  const activation = makeActivation();
  const settlements = makeSettlements(activation, 30);
  const health = evaluateControlledProductionHealth({ activation, settlements, evaluatedAt: '2026-03-02T01:00:00Z' });
  const lateManifest = freezeStep15ProductionEvidenceCohortManifest({ activation, settlements, frozenAt: '2026-03-02T02:00:00Z' });
  assert.throws(() => freezeControlledProductionEvidenceReview({
    activation,
    healthEvaluation: health,
    evidenceManifest: lateManifest,
    settlements,
    reviewedAt: '2026-03-02T03:00:00Z',
    reviewedBy: 'reviewer',
    rationale: 'late manifest must be rejected'
  }), /STEP16_PRE_HEALTH_MANIFEST_REQUIRED/);
});

test('Step 16 authorization only authorizes the next stage ceiling and does not apply a new weight', () => {
  const { activation, review } = makeEvidenceBundle(0.05);
  const decision = recordControlledProductionWeightGovernanceDecision({
    activation,
    evidenceReview: review,
    decision: 'AUTHORIZE_NEXT_CONTROLLED_WEIGHT_STAGE_NOT_APPLIED',
    governor: 'step16-governor',
    rationale: 'healthy evidence supports one bounded staged increase',
    decidedAt: '2026-03-02T03:00:00Z'
  });
  assert.equal(verifyControlledProductionWeightGovernanceDecision(decision), true);
  assert.equal(decision.state, 'NEXT_CONTROLLED_PRODUCTION_WEIGHT_STAGE_AUTHORIZED_NOT_APPLIED');
  assert.equal(decision.enforcement.current_production_decision_weight, 0.05);
  assert.equal(decision.enforcement.production_decision_weight_after_step16, 0.05);
  assert.equal(decision.enforcement.authorized_maximum_next_stage_decision_weight, MAX_NEXT_CONTROLLED_PRODUCTION_DECISION_WEIGHT);
  assert.equal(decision.enforcement.weight_change_applied_here, false);
  assert.equal(decision.enforcement.maximum_absolute_probability_shift, MAX_ABSOLUTE_PROBABILITY_SHIFT);
  assert.equal(decision.enforcement.capital_execution_allowed, false);
  assert.equal(decision.next_stage, 'STEP_17_STAGED_CONTROLLED_PRODUCTION_WEIGHT_ACTIVATION_AND_MONITORING');
});

test('Step 16 next-stage ceiling is at most a governed doubling for a smaller current weight', () => {
  const { review } = makeEvidenceBundle(0.02);
  assert.equal(MAX_WEIGHT_MULTIPLIER_PER_GOVERNED_STAGE, 2);
  assert.equal(review.proposed_boundary.maximum_next_decision_weight, 0.04);
  assert.equal(review.proposed_boundary.absolute_maximum_next_stage_decision_weight, 0.10);
});

test('Step 16 HOLD keeps the exact current weight and requires new manifest-bound evidence before a later increase', () => {
  const { activation, review } = makeEvidenceBundle();
  const decision = recordControlledProductionWeightGovernanceDecision({
    activation,
    evidenceReview: review,
    decision: 'HOLD_CURRENT_CONTROLLED_WEIGHT',
    governor: 'step16-governor',
    rationale: 'continue current bounded stage while more evidence accumulates',
    decidedAt: '2026-03-02T03:00:00Z'
  });
  assert.equal(verifyControlledProductionWeightGovernanceDecision(decision), true);
  assert.equal(decision.state, 'CONTROLLED_PRODUCTION_WEIGHT_HELD_CURRENT_STAGE');
  assert.equal(decision.enforcement.production_decision_weight_after_step16, activation.production.decision_weight);
  assert.equal(decision.enforcement.authorized_maximum_next_stage_decision_weight, activation.production.decision_weight);
  assert.equal(decision.enforcement.new_pre_health_manifest_and_health_review_required_before_future_increase, true);
  assert.equal(decision.governance.capital_execution_allowed, false);
});

test('Step 16 RETIRE reuses the Step 15 emergency rollback owner and forces champion-only zero influence', () => {
  const { activation, review } = makeEvidenceBundle();
  const decision = recordControlledProductionWeightGovernanceDecision({
    activation,
    evidenceReview: review,
    decision: 'RETIRE_AND_ROLLBACK_TO_CHAMPION',
    governor: 'step16-governor',
    rationale: 'manual governance retirement despite healthy evidence',
    decidedAt: '2026-03-02T03:00:00Z'
  });
  assert.equal(verifyControlledProductionWeightGovernanceDecision(decision), true);
  assert.equal(verifyControlledProductionEmergencyRollback(decision.rollback), true);
  assert.equal(decision.state, 'CONTROLLED_PRODUCTION_RETIRED_CHAMPION_ONLY');
  assert.equal(decision.enforcement.production_decision_weight_after_step16, 0);
  assert.equal(decision.enforcement.probability_influence_after_retirement, 0);
  assert.equal(decision.enforcement.rollback_target, 'CHAMPION_ONLY');
  assert.equal(decision.enforcement.same_step15_activation_reactivation_allowed, false);
  assert.equal(decision.governance.real_money, 'NO');
});

test('Step 16 manifest, review and decision fingerprints fail closed on tampering', () => {
  const { activation, manifest, review } = makeEvidenceBundle();
  const badManifest = { ...manifest, settled_n: 31 };
  assert.throws(() => verifyStep15ProductionEvidenceCohortManifest(badManifest), /STEP16_MANIFEST_FINGERPRINT_INVALID/);
  const badReview = { ...review, eligible_for_manual_weight_governance: false };
  assert.throws(() => verifyControlledProductionEvidenceReview(badReview), /STEP16_REVIEW_FINGERPRINT_INVALID/);
  const decision = recordControlledProductionWeightGovernanceDecision({
    activation,
    evidenceReview: review,
    decision: 'AUTHORIZE_NEXT_CONTROLLED_WEIGHT_STAGE_NOT_APPLIED',
    governor: 'governor',
    rationale: 'synthetic decision',
    decidedAt: '2026-03-02T03:00:00Z'
  });
  const badDecision = { ...decision, state: 'TAMPERED' };
  assert.throws(() => verifyControlledProductionWeightGovernanceDecision(badDecision), /STEP16_DECISION_FINGERPRINT_INVALID/);
});
