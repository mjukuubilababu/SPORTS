import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CONTROLLED_PATTERN_CANARY_VERSION } from '../src/controlled-pattern-canary-activation-rollback.mjs';
import { PATTERN_CANARY_EXPANSION_GOVERNANCE_VERSION } from '../src/pattern-canary-expansion-rejection-governance.mjs';
import {
  STAGED_PATTERN_CANARY_EXPANSION_VERSION,
  activateStagedPatternCanaryExpansion,
  evaluateStagedPatternCanaryHealth
} from '../src/staged-pattern-canary-expansion-activation-monitoring.mjs';
import {
  PATTERN_CANARY_GRADUATION_GOVERNANCE_VERSION,
  createStep12GraduationCohortManifest,
  verifyStep12GraduationCohortManifest,
  freezePatternCanaryGraduationDossier,
  verifyPatternCanaryGraduationDossier,
  recordPatternCanaryGraduationDecision,
  verifyPatternCanaryGraduationDecision
} from '../src/pattern-canary-graduation-retirement-governance.mjs';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(stableStringify(value)).digest('hex'); }
function withFingerprint(payload, field) { return Object.freeze({ ...payload, [field]: sha256(payload) }); }
function loss(p, outcome) {
  const eps = 1e-15;
  return {
    brier: (p - outcome) ** 2,
    log_loss: -(outcome * Math.log(Math.max(eps, p)) + (1 - outcome) * Math.log(Math.max(eps, 1 - p)))
  };
}

function makeStep10Authorization() {
  const payload = {
    authorization_version: CONTROLLED_PATTERN_CANARY_VERSION,
    state: 'CONTROLLED_PATTERN_CANARY_ACTIVE_PAPER_ONLY',
    activated_at: '2026-01-01T00:00:00Z',
    activator: 'fixture-governor',
    rationale: 'synthetic Step 10 fixture',
    channel: 'PAPER',
    source_step9_approval_fingerprint: 'step9-approval-fixture',
    source_step9_forward_evaluation_fingerprint: 'step9-forward-fixture',
    source_dossier_fingerprint: 'dossier-fixture',
    source_shadow_plan_fingerprint: 'shadow-plan-fixture',
    approved_pattern_ids: ['P002'],
    calibration_version: 'calibration-v1',
    calibration_provenance: 'synthetic-test-only',
    routing: {
      method: 'DETERMINISTIC_SHA256_MATCH_MARKET_SELECTION',
      seed: 'step10-seed-fixture',
      maximum_fraction: 0.05,
      active_fraction: 0.05,
      cherry_pick_allowed: false
    },
    influence: {
      source: 'STEP8_SHADOW_MINUS_CHAMPION_DELTA',
      maximum_absolute_probability_shift: 0.02,
      maximum_contract_limit: 0.02,
      champion_probability_mutated_in_place: false
    },
    kill_switch: { state: 'ARMED', immediate_signals: ['MANUAL_KILL_SWITCH'], champion_fallback_required: true },
    health_policy: { minimum_routed_settled_n: 30, brier_non_degradation_required: true, log_loss_non_degradation_required: true, maximum_ece_degradation: 0.01 },
    governance: {
      paper_or_research_only: true,
      production_decision_weight: 0,
      production_mutation_allowed: false,
      capital_execution_allowed: false,
      gate6_capital_lock_preserved: true,
      automatic_full_promotion: false,
      automatic_retuning: false,
      p002_changed: false,
      gate1_to_gate6_ownership_changed: false,
      capital_effect: 'NONE',
      real_money: 'NO'
    }
  };
  return withFingerprint(payload, 'canary_authorization_fingerprint');
}

function makeStep11Decision(step10Authorization) {
  const payload = {
    decision_version: PATTERN_CANARY_EXPANSION_GOVERNANCE_VERSION,
    state: 'NEXT_CANARY_STAGE_APPROVED_NOT_ACTIVATED',
    decision: 'APPROVE_NEXT_CANARY_STAGE',
    approver: 'fixture-governor',
    rationale: 'synthetic Step 11 approval',
    decided_at: '2026-01-02T00:00:00Z',
    expansion_checkpoint_fingerprint: 'checkpoint-fixture',
    expansion_evaluation_fingerprint: 'evaluation-fixture',
    canary_authorization_fingerprint: step10Authorization.canary_authorization_fingerprint,
    current_stage: { routing_fraction: 0.05, maximum_absolute_probability_shift: 0.02 },
    next_stage: {
      approved_not_activated: true,
      maximum_routing_fraction: 0.10,
      maximum_absolute_probability_shift: 0.02,
      activation_performed_here: false,
      full_production_promotion_authorized: false
    },
    rollback_fingerprint: null,
    governance: {
      automatic_expansion: false,
      automatic_full_promotion: false,
      production_decision_weight: 0,
      capital_execution_allowed: false,
      same_authorization_reactivation_allowed: true,
      gate6_capital_lock_preserved: true,
      capital_effect: 'NONE',
      real_money: 'NO'
    },
    next_stage_name: 'STEP_12_STAGED_CANARY_EXPANSION_ACTIVATION_AND_MONITORING'
  };
  return withFingerprint(payload, 'expansion_decision_fingerprint');
}

function makeLineage() {
  const step10Authorization = makeStep10Authorization();
  const step11Decision = makeStep11Decision(step10Authorization);
  const step12Activation = activateStagedPatternCanaryExpansion({
    step10Authorization,
    step11Decision,
    activatedAt: '2026-01-03T00:00:00Z',
    activator: 'step12-governor',
    rationale: 'activate approved staged canary'
  });
  return { step10Authorization, step11Decision, step12Activation };
}

function makeSettlement(activation, i, { outcome = 1, championProbability = 0.55, canaryProbability = 0.57, band = 'EXPANSION_BAND' } = {}) {
  const payload = {
    settlement_version: STAGED_PATTERN_CANARY_EXPANSION_VERSION,
    match_id: `step13-match-${i}`,
    market_key: '1X2',
    selection: 'HOME',
    outcome,
    settled_at: '2026-01-06T00:00:00Z',
    routing_band: band,
    source_staged_activation_fingerprint: activation.staged_activation_fingerprint,
    source_staged_decision_fingerprint: `staged-decision-fixture-${i}`,
    champion_probability: championProbability,
    canary_probability: canaryProbability,
    champion_loss: loss(championProbability, outcome),
    canary_loss: loss(canaryProbability, outcome),
    governance: { routed_staged_canary_only: true, production_decision_weight: 0, capital_execution_allowed: false, real_money: 'NO' }
  };
  return withFingerprint(payload, 'staged_settlement_fingerprint');
}

function makeHealthyFixture(count = 30) {
  const lineage = makeLineage();
  const settlements = Array.from({ length: count }, (_, i) => makeSettlement(lineage.step12Activation, i));
  const cohortManifest = createStep12GraduationCohortManifest({
    step12Activation: lineage.step12Activation,
    settlements,
    capturedAt: '2026-01-06T12:00:00Z'
  });
  const step12Health = evaluateStagedPatternCanaryHealth({
    activation: lineage.step12Activation,
    settlements,
    evaluatedAt: '2026-01-07T00:00:00Z'
  });
  return { ...lineage, settlements, cohortManifest, step12Health };
}

function makeDossier() {
  const fixture = makeHealthyFixture();
  const dossier = freezePatternCanaryGraduationDossier({
    ...fixture,
    frozenAt: '2026-01-08T00:00:00Z'
  });
  return { ...fixture, dossier };
}

test('Step 13 pre-health manifest cryptographically binds the exact Step 12 settlement cohort', () => {
  const { cohortManifest } = makeHealthyFixture();
  assert.equal(verifyStep12GraduationCohortManifest(cohortManifest), true);
  assert.equal(cohortManifest.full_stage_routed_settled_n, 30);
  assert.equal(cohortManifest.expansion_band_routed_settled_n, 30);
  assert.equal(cohortManifest.settlement_fingerprints.length, 30);
  assert.equal(cohortManifest.governance.post_manifest_cohort_rewrite_allowed, false);
});

test('Step 13 freezes exact manifest-bound healthy Step 12 evidence into a zero-weight graduation dossier', () => {
  const { dossier } = makeDossier();
  assert.equal(verifyPatternCanaryGraduationDossier(dossier), true);
  assert.equal(dossier.dossier_version, PATTERN_CANARY_GRADUATION_GOVERNANCE_VERSION);
  assert.equal(dossier.evidence.full_stage_routed_settled_n, 30);
  assert.equal(dossier.evidence.expansion_band_routed_settled_n, 30);
  assert.equal(dossier.evidence.pre_health_cohort_manifest_bound, true);
  assert.equal(dossier.evidence.step12_health_reproduced_exactly, true);
  assert.equal(dossier.governance.production_decision_weight, 0);
  assert.equal(dossier.governance.champion_replacement_authorized, false);
  assert.equal(dossier.governance.capital_execution_allowed, false);
});

test('Step 13 refuses graduation dossier before Step 12 independent minimum evidence is healthy', () => {
  const fixture = makeHealthyFixture(29);
  assert.equal(fixture.step12Health.state, 'STAGED_CANARY_HEALTH_ACCUMULATING_PAPER_ONLY');
  assert.throws(() => freezePatternCanaryGraduationDossier({ ...fixture, frozenAt: '2026-01-08T00:00:00Z' }), /STEP13_HEALTHY_STEP12_REQUIRED/);
});

test('Step 13 refuses same-metric settlement substitution because manifest fingerprint set is exact', () => {
  const fixture = makeHealthyFixture();
  const replacement = makeSettlement(fixture.step12Activation, 999);
  const altered = [...fixture.settlements.slice(0, -1), replacement];
  assert.throws(() => freezePatternCanaryGraduationDossier({ ...fixture, settlements: altered, frozenAt: '2026-01-08T00:00:00Z' }), /STEP13_SETTLEMENT_MANIFEST_FINGERPRINT_SET_MISMATCH/);
});

test('Step 13 refuses a cohort manifest captured after the Step 12 health evaluation', () => {
  const fixture = makeHealthyFixture();
  const lateManifest = createStep12GraduationCohortManifest({
    step12Activation: fixture.step12Activation,
    settlements: fixture.settlements,
    capturedAt: '2026-01-07T01:00:00Z'
  });
  assert.throws(() => freezePatternCanaryGraduationDossier({ ...fixture, cohortManifest: lateManifest, frozenAt: '2026-01-08T00:00:00Z' }), /STEP13_MANIFEST_MUST_NOT_FOLLOW_STEP12_HEALTH/);
});

test('Step 13 graduation creates only a zero-weight challenger candidate and does not activate production', () => {
  const { dossier, step12Activation, step12Health } = makeDossier();
  const decision = recordPatternCanaryGraduationDecision({
    dossier,
    step12Activation,
    step12Health,
    decision: 'GRADUATE_TO_ZERO_WEIGHT_CHALLENGER_CANDIDATE',
    approver: 'step13-governor',
    rationale: 'healthy manifest-bound staged evidence qualifies only for future governed review',
    decidedAt: '2026-01-09T00:00:00Z'
  });
  assert.equal(verifyPatternCanaryGraduationDecision(decision), true);
  assert.equal(decision.state, 'PATTERN_GRADUATED_ZERO_WEIGHT_CHALLENGER_CANDIDATE_NOT_PRODUCTION_ACTIVATED');
  assert.equal(decision.candidate.decision_weight, 0);
  assert.equal(decision.candidate.production_activation_authorized, false);
  assert.equal(decision.candidate.champion_replacement_authorized, false);
  assert.equal(decision.governance.capital_execution_allowed, false);
  assert.equal(decision.next_stage, 'STEP_14_ZERO_WEIGHT_CHALLENGER_PROMOTION_AUTHORIZATION_AND_PRODUCTION_SAFETY_REVIEW');
});

test('Step 13 hold keeps Step 12 staged canary bounded and requires new manifest-bound evidence', () => {
  const { dossier, step12Activation, step12Health } = makeDossier();
  const decision = recordPatternCanaryGraduationDecision({
    dossier,
    step12Activation,
    step12Health,
    decision: 'HOLD_STAGED_CANARY',
    approver: 'step13-governor',
    rationale: 'collect more independently bound evidence',
    decidedAt: '2026-01-09T00:00:00Z'
  });
  assert.equal(verifyPatternCanaryGraduationDecision(decision), true);
  assert.equal(decision.state, 'STAGED_CANARY_HELD_AT_STEP12_AWAITING_NEW_EVIDENCE');
  assert.equal(decision.enforcement.step12_staged_canary_may_continue, true);
  assert.equal(decision.enforcement.routing_fraction_may_increase_here, false);
  assert.equal(decision.enforcement.probability_influence_may_increase_here, false);
});

test('Step 13 retirement reuses Step 12 rollback and forces champion-only zero routing', () => {
  const { dossier, step12Activation, step12Health } = makeDossier();
  const decision = recordPatternCanaryGraduationDecision({
    dossier,
    step12Activation,
    step12Health,
    decision: 'RETIRE_PATTERN_CANARY',
    approver: 'step13-governor',
    rationale: 'manual lifecycle retirement despite healthy evidence',
    decidedAt: '2026-01-09T00:00:00Z'
  });
  assert.equal(verifyPatternCanaryGraduationDecision(decision), true);
  assert.equal(decision.state, 'PATTERN_CANARY_RETIRED_CHAMPION_ONLY');
  assert.ok(decision.rollback_fingerprint);
  assert.equal(decision.enforcement.retirement_routing_fraction, 0);
  assert.equal(decision.enforcement.retirement_probability_influence, 0);
});

test('Step 13 decision cannot predate or equal the frozen graduation dossier', () => {
  const { dossier, step12Activation, step12Health } = makeDossier();
  assert.throws(() => recordPatternCanaryGraduationDecision({
    dossier,
    step12Activation,
    step12Health,
    decision: 'GRADUATE_TO_ZERO_WEIGHT_CHALLENGER_CANDIDATE',
    approver: 'step13-governor',
    rationale: 'invalid chronology',
    decidedAt: '2026-01-08T00:00:00Z'
  }), /STEP13_DECISION_MUST_FOLLOW_DOSSIER_FREEZE/);
});

test('Step 13 fingerprint tampering is rejected', () => {
  const { dossier } = makeDossier();
  const tampered = { ...dossier, evidence: { ...dossier.evidence, full_stage_routed_settled_n: 31 } };
  assert.throws(() => verifyPatternCanaryGraduationDossier(tampered), /STEP13_DOSSIER_FINGERPRINT_INVALID/);
});
