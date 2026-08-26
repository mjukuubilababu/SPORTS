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
  activateStagedControlledProductionWeight,
  applyStagedControlledProductionWeight,
  settleStagedControlledProductionWeightDecision,
  evaluateStagedControlledProductionWeightHealth,
  verifyStagedControlledProductionWeightRollback
} from '../src/staged-controlled-production-weight-activation-monitoring.mjs';
import {
  STAGED_CONTROLLED_PRODUCTION_WEIGHT_EVIDENCE_GOVERNANCE_VERSION,
  STAGED_WEIGHT_EVIDENCE_MIN_SETTLED_N,
  STAGED_WEIGHT_MAX_DECISION_WEIGHT,
  STAGED_WEIGHT_MAX_MULTIPLIER_PER_GOVERNED_STAGE,
  freezeStep17StagedWeightEvidenceCohortManifest,
  verifyStep17StagedWeightEvidenceCohortManifest,
  freezeStagedControlledProductionWeightEvidenceReview,
  verifyStagedControlledProductionWeightEvidenceReview,
  recordStagedControlledProductionWeightGovernanceDecision,
  verifyStagedControlledProductionWeightGovernanceDecision
} from '../src/staged-controlled-production-weight-evidence-review-governance.mjs';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(stableStringify(value)).digest('hex'); }
function withFingerprint(payload, field) { return Object.freeze({ ...payload, [field]: sha256(payload) }); }

function makeBaseActivation(weight = 0.02) {
  const payload = {
    activation_version: CONTROLLED_PRODUCTION_ACTIVATION_VERSION,
    state: 'CONTROLLED_PRODUCTION_ACTIVATION_ACTIVE_CAPITAL_LOCKED',
    activated_at: '2026-03-01T00:00:00Z',
    activated_by: 'step18-fixture',
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
    deployment: { deployment_reference: 'synthetic-deployment:step18-base', reversible: true },
    emergency_rollback: {
      kill_switch_armed: true,
      kill_switch_reference: 'synthetic-kill-switch:step18-base',
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

function makeStep15Settlement(activation, i) {
  const decision = applyControlledProductionChallenger({
    activation,
    matchId: `S16-${String(i).padStart(3, '0')}`,
    marketKey: 'TOTALS_U35', selection: 'UNDER',
    championProbability: 0.5, challengerProbability: 0.8,
    generatedAt: '2026-03-01T01:00:00Z', eventStartAt: '2026-03-01T02:00:00Z'
  });
  return settleControlledProductionDecision({ decision, outcome: 1, settledAt: '2026-03-01T04:00:00Z' });
}

function makeStep16Authorization(currentWeight = 0.02) {
  const baseActivation = makeBaseActivation(currentWeight);
  const settlements = Array.from({ length: 30 }, (_, i) => makeStep15Settlement(baseActivation, i));
  const evidenceManifest = freezeStep15ProductionEvidenceCohortManifest({
    activation: baseActivation, settlements, frozenAt: '2026-03-02T00:00:00Z'
  });
  const health = evaluateControlledProductionHealth({
    activation: baseActivation, settlements, evaluatedAt: '2026-03-02T01:00:00Z'
  });
  const evidenceReview = freezeControlledProductionEvidenceReview({
    activation: baseActivation, healthEvaluation: health, evidenceManifest, settlements,
    reviewedAt: '2026-03-02T02:00:00Z', reviewedBy: 'step16-reviewer', rationale: 'synthetic healthy Step15 evidence'
  });
  const weightGovernanceDecision = recordControlledProductionWeightGovernanceDecision({
    activation: baseActivation, evidenceReview,
    decision: 'AUTHORIZE_NEXT_CONTROLLED_WEIGHT_STAGE_NOT_APPLIED',
    governor: 'step16-governor', rationale: 'synthetic bounded Step16 authorization',
    decidedAt: '2026-03-02T03:00:00Z'
  });
  return { baseActivation, evidenceManifest, evidenceReview, weightGovernanceDecision };
}

function makeStagedActivation({ currentWeight = 0.02, targetWeight = 0.04 } = {}) {
  const bundle = makeStep16Authorization(currentWeight);
  const activation = activateStagedControlledProductionWeight({
    baseActivation: bundle.baseActivation,
    evidenceManifest: bundle.evidenceManifest,
    evidenceReview: bundle.evidenceReview,
    weightGovernanceDecision: bundle.weightGovernanceDecision,
    targetDecisionWeight: targetWeight,
    activatedAt: '2026-03-03T00:00:00Z', activatedBy: 'step17-operator',
    deploymentReference: 'synthetic-deployment:step17', killSwitchReference: 'synthetic-kill-switch:step17'
  });
  return { ...bundle, activation };
}

function makeStagedSettlement(activation, i, { matchId = null, outcome = 1, challengerProbability = 0.7 } = {}) {
  const decision = applyStagedControlledProductionWeight({
    activation,
    matchId: matchId ?? `S17-${String(i).padStart(3, '0')}`,
    marketKey: 'TOTALS_U35', selection: 'UNDER',
    championProbability: 0.5, challengerProbability,
    generatedAt: '2026-03-03T01:00:00Z', eventStartAt: '2026-03-03T02:00:00Z'
  });
  return settleStagedControlledProductionWeightDecision({ decision, outcome, settledAt: '2026-03-03T04:00:00Z' });
}

function makeStagedSettlements(activation, n = 30) {
  return Array.from({ length: n }, (_, i) => makeStagedSettlement(activation, i));
}

function makeReviewBundle({ currentWeight = 0.02, targetWeight = 0.04, n = 30 } = {}) {
  const staged = makeStagedActivation({ currentWeight, targetWeight });
  const settlements = makeStagedSettlements(staged.activation, n);
  const manifest = freezeStep17StagedWeightEvidenceCohortManifest({
    activation: staged.activation, settlements, frozenAt: '2026-03-04T00:00:00Z'
  });
  const health = evaluateStagedControlledProductionWeightHealth({
    activation: staged.activation, settlements, evaluatedAt: '2026-03-04T01:00:00Z'
  });
  const review = freezeStagedControlledProductionWeightEvidenceReview({
    activation: staged.activation, healthEvaluation: health, evidenceManifest: manifest, settlements,
    reviewedAt: '2026-03-04T02:00:00Z', reviewedBy: 'step18-reviewer', rationale: 'synthetic healthy manifest-bound Step17 evidence'
  });
  return { ...staged, settlements, manifest, health, review };
}

test('Step 18 pre-health manifest binds exact ordered Step 17 staged settlement evidence', () => {
  const { activation } = makeStagedActivation();
  const settlements = makeStagedSettlements(activation, 30);
  const manifest = freezeStep17StagedWeightEvidenceCohortManifest({ activation, settlements, frozenAt: '2026-03-04T00:00:00Z' });
  assert.equal(verifyStep17StagedWeightEvidenceCohortManifest(manifest), true);
  assert.equal(manifest.manifest_version, STAGED_CONTROLLED_PRODUCTION_WEIGHT_EVIDENCE_GOVERNANCE_VERSION);
  assert.equal(manifest.state, 'STEP17_STAGED_WEIGHT_EVIDENCE_COHORT_MANIFEST_FROZEN_PRE_HEALTH');
  assert.equal(manifest.settled_n, STAGED_WEIGHT_EVIDENCE_MIN_SETTLED_N);
  assert.equal(manifest.settlement_fingerprints_in_evaluation_order.length, 30);
  assert.equal(new Set(manifest.match_market_selection_key_set).size, 30);
  assert.equal(manifest.governance.historical_unbound_health_eligible, false);
});

test('Step 18 healthy manifest-bound Step 17 evidence freezes into manual governance review without changing weight', () => {
  const { activation, review } = makeReviewBundle();
  assert.equal(verifyStagedControlledProductionWeightEvidenceReview(review), true);
  assert.equal(review.state, 'STAGED_CONTROLLED_WEIGHT_EVIDENCE_REVIEW_PASS_MANUAL_GOVERNANCE_ELIGIBLE');
  assert.equal(review.evidence.manifest_bound, true);
  assert.equal(review.evidence.exact_health_reproduced, true);
  assert.equal(review.current_stage.staged_decision_weight, activation.production.staged_decision_weight);
  assert.equal(review.proposed_boundary.maximum_next_decision_weight, 0.08);
  assert.equal(review.proposed_boundary.further_weight_increase_eligible, true);
  assert.equal(review.proposed_boundary.weight_change_applied_here, false);
  assert.equal(review.governance.capital_execution_allowed, false);
});

test('Step 18 refuses N29 before staged evidence governance can exist', () => {
  const { activation } = makeStagedActivation();
  const settlements = makeStagedSettlements(activation, 29);
  assert.throws(() => freezeStep17StagedWeightEvidenceCohortManifest({
    activation, settlements, frozenAt: '2026-03-04T00:00:00Z'
  }), /STEP18_MINIMUM_SETTLED_N_NOT_MET/);
});

test('Step 18 rejects same-metric staged settlement substitution because exact fingerprints and identities are bound', () => {
  const { activation } = makeStagedActivation();
  const settlements = makeStagedSettlements(activation, 30);
  const manifest = freezeStep17StagedWeightEvidenceCohortManifest({ activation, settlements, frozenAt: '2026-03-04T00:00:00Z' });
  const health = evaluateStagedControlledProductionWeightHealth({ activation, settlements, evaluatedAt: '2026-03-04T01:00:00Z' });
  const substituted = [...settlements];
  substituted[0] = makeStagedSettlement(activation, 0, { matchId: 'SAME-METRIC-DIFFERENT-STAGED-EVIDENCE' });
  assert.throws(() => freezeStagedControlledProductionWeightEvidenceReview({
    activation, healthEvaluation: health, evidenceManifest: manifest, settlements: substituted,
    reviewedAt: '2026-03-04T02:00:00Z', reviewedBy: 'reviewer', rationale: 'must reject substitution'
  }), /STEP18_MANIFEST_BOUND_COHORT_REPRODUCTION_FAILED/);
});

test('Step 18 rejects a manifest frozen after Step 17 health evaluation', () => {
  const { activation } = makeStagedActivation();
  const settlements = makeStagedSettlements(activation, 30);
  const health = evaluateStagedControlledProductionWeightHealth({ activation, settlements, evaluatedAt: '2026-03-04T01:00:00Z' });
  const lateManifest = freezeStep17StagedWeightEvidenceCohortManifest({ activation, settlements, frozenAt: '2026-03-04T02:00:00Z' });
  assert.throws(() => freezeStagedControlledProductionWeightEvidenceReview({
    activation, healthEvaluation: health, evidenceManifest: lateManifest, settlements,
    reviewedAt: '2026-03-04T03:00:00Z', reviewedBy: 'reviewer', rationale: 'late manifest rejected'
  }), /STEP18_PRE_HEALTH_MANIFEST_REQUIRED/);
});

test('Step 18 authorization only authorizes the next staged ceiling and does not apply a new weight', () => {
  const { activation, review } = makeReviewBundle({ currentWeight: 0.02, targetWeight: 0.04 });
  const decision = recordStagedControlledProductionWeightGovernanceDecision({
    activation, evidenceReview: review,
    decision: 'AUTHORIZE_NEXT_STAGED_WEIGHT_STAGE_NOT_APPLIED',
    governor: 'step18-governor', rationale: 'healthy exact evidence supports one bounded next stage',
    decidedAt: '2026-03-04T03:00:00Z'
  });
  assert.equal(verifyStagedControlledProductionWeightGovernanceDecision(decision), true);
  assert.equal(decision.state, 'NEXT_STAGED_CONTROLLED_PRODUCTION_WEIGHT_STAGE_AUTHORIZED_NOT_APPLIED');
  assert.equal(decision.enforcement.current_staged_decision_weight, 0.04);
  assert.equal(decision.enforcement.production_decision_weight_after_step18, 0.04);
  assert.equal(decision.enforcement.authorized_maximum_next_stage_decision_weight, 0.08);
  assert.equal(decision.enforcement.weight_change_applied_here, false);
  assert.equal(decision.enforcement.maximum_absolute_probability_shift, 0.02);
  assert.equal(decision.next_stage, 'STEP_19_NEXT_STAGED_CONTROLLED_PRODUCTION_WEIGHT_ACTIVATION_AND_MONITORING');
});

test('Step 18 preserves governed doubling discipline and absolute 10 percent ceiling', () => {
  assert.equal(STAGED_WEIGHT_MAX_MULTIPLIER_PER_GOVERNED_STAGE, 2);
  assert.equal(STAGED_WEIGHT_MAX_DECISION_WEIGHT, 0.10);
  const { review } = makeReviewBundle({ currentWeight: 0.02, targetWeight: 0.04 });
  assert.equal(review.proposed_boundary.maximum_next_decision_weight, 0.08);
  assert.equal(review.proposed_boundary.absolute_maximum_staged_decision_weight, 0.10);
});

test('Step 18 forbids another weight authorization when current staged weight already equals absolute 10 percent maximum', () => {
  const { activation, review } = makeReviewBundle({ currentWeight: 0.05, targetWeight: 0.10 });
  assert.equal(review.proposed_boundary.maximum_next_decision_weight, 0.10);
  assert.equal(review.proposed_boundary.further_weight_increase_eligible, false);
  assert.throws(() => recordStagedControlledProductionWeightGovernanceDecision({
    activation, evidenceReview: review,
    decision: 'AUTHORIZE_NEXT_STAGED_WEIGHT_STAGE_NOT_APPLIED',
    governor: 'step18-governor', rationale: 'must not exceed max', decidedAt: '2026-03-04T03:00:00Z'
  }), /STEP18_MAX_STAGED_WEIGHT_BOUNDARY_REACHED/);
});

test('Step 18 HOLD keeps the exact current staged weight and requires new manifest-bound evidence before later increase', () => {
  const { activation, review } = makeReviewBundle({ currentWeight: 0.05, targetWeight: 0.10 });
  const decision = recordStagedControlledProductionWeightGovernanceDecision({
    activation, evidenceReview: review,
    decision: 'HOLD_CURRENT_STAGED_WEIGHT',
    governor: 'step18-governor', rationale: 'hold healthy staged weight at current governed boundary',
    decidedAt: '2026-03-04T03:00:00Z'
  });
  assert.equal(verifyStagedControlledProductionWeightGovernanceDecision(decision), true);
  assert.equal(decision.state, 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_HELD_CURRENT_STAGE');
  assert.equal(decision.enforcement.production_decision_weight_after_step18, 0.10);
  assert.equal(decision.enforcement.authorized_maximum_next_stage_decision_weight, 0.10);
  assert.equal(decision.enforcement.new_pre_health_manifest_and_health_review_required_before_future_increase, true);
  assert.equal(decision.governance.capital_execution_allowed, false);
});

test('Step 18 RETIRE reuses Step 17 rollback and forces champion-only zero influence', () => {
  const { activation, review } = makeReviewBundle();
  const decision = recordStagedControlledProductionWeightGovernanceDecision({
    activation, evidenceReview: review,
    decision: 'RETIRE_AND_ROLLBACK_TO_CHAMPION',
    governor: 'step18-governor', rationale: 'manual retirement despite healthy evidence',
    decidedAt: '2026-03-04T03:00:00Z'
  });
  assert.equal(verifyStagedControlledProductionWeightGovernanceDecision(decision), true);
  assert.equal(verifyStagedControlledProductionWeightRollback(decision.rollback), true);
  assert.equal(decision.state, 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_RETIRED_CHAMPION_ONLY');
  assert.equal(decision.enforcement.production_decision_weight_after_step18, 0);
  assert.equal(decision.enforcement.probability_influence_after_retirement, 0);
  assert.equal(decision.enforcement.rollback_target, 'CHAMPION_ONLY');
  assert.equal(decision.governance.real_money, 'NO');
});

test('Step 18 manifest, review and decision fingerprints fail closed on tampering', () => {
  const { activation, manifest, review } = makeReviewBundle();
  assert.throws(() => verifyStep17StagedWeightEvidenceCohortManifest({ ...manifest, settled_n: 31 }), /STEP18_MANIFEST_FINGERPRINT_INVALID/);
  assert.throws(() => verifyStagedControlledProductionWeightEvidenceReview({ ...review, eligible_for_manual_governance: false }), /STEP18_REVIEW_FINGERPRINT_INVALID/);
  const decision = recordStagedControlledProductionWeightGovernanceDecision({
    activation, evidenceReview: review,
    decision: 'HOLD_CURRENT_STAGED_WEIGHT', governor: 'governor', rationale: 'synthetic hold', decidedAt: '2026-03-04T03:00:00Z'
  });
  assert.throws(() => verifyStagedControlledProductionWeightGovernanceDecision({ ...decision, state: 'TAMPERED' }), /STEP18_DECISION_FINGERPRINT_INVALID/);
});
