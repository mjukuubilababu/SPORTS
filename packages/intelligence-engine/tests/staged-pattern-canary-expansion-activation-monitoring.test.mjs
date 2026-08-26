import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PATTERN_PROMOTION_SHADOW_VERSION } from '../src/pattern-promotion-shadow-integration.mjs';
import { CONTROLLED_PATTERN_CANARY_VERSION } from '../src/controlled-pattern-canary-activation-rollback.mjs';
import { PATTERN_CANARY_EXPANSION_GOVERNANCE_VERSION } from '../src/pattern-canary-expansion-rejection-governance.mjs';
import {
  STAGED_PATTERN_CANARY_EXPANSION_VERSION,
  activateStagedPatternCanaryExpansion,
  verifyStagedPatternCanaryExpansionActivation,
  routeStagedPatternCanaryExpansion,
  verifyStagedPatternCanaryDecision,
  settleStagedPatternCanaryDecision,
  evaluateStagedPatternCanaryHealth,
  verifyStagedPatternCanaryHealth,
  recordStagedPatternCanaryRollback,
  verifyStagedPatternCanaryRollbackRecord
} from '../src/staged-pattern-canary-expansion-activation-monitoring.mjs';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(stableStringify(value)).digest('hex'); }
function withFingerprint(payload, field) { return Object.freeze({ ...payload, [field]: sha256(payload) }); }
function routeValue(seed, key) { const hex = createHash('sha256').update(`${seed}|${key}`).digest('hex').slice(0, 13); return Number.parseInt(hex, 16) / 0x10000000000000; }

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

function makeStep11Decision(step10Authorization, overrides = {}) {
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
    next_stage_name: 'STEP_12_STAGED_CANARY_EXPANSION_ACTIVATION_AND_MONITORING',
    ...overrides
  };
  return withFingerprint(payload, 'expansion_decision_fingerprint');
}

function makeActivation() {
  const step10Authorization = makeStep10Authorization();
  const step11Decision = makeStep11Decision(step10Authorization);
  const activation = activateStagedPatternCanaryExpansion({
    step10Authorization,
    step11Decision,
    activatedAt: '2026-01-03T00:00:00Z',
    activator: 'step12-governor',
    rationale: 'activate only approved staged paper canary expansion'
  });
  return { step10Authorization, step11Decision, activation };
}

function makeShadow(matchId, { championProbability = 0.55, shadowProbability = 0.57, generatedAt = '2026-01-04T00:00:00Z', kickoffAt = '2026-01-05T00:00:00Z' } = {}) {
  const payload = {
    shadow_version: PATTERN_PROMOTION_SHADOW_VERSION,
    state: 'SHADOW_PREDICTION_READY_ZERO_WEIGHT',
    generated_at: generatedAt,
    kickoff_at: kickoffAt,
    match_id: matchId,
    market_key: '1X2',
    selection: 'HOME',
    source_shadow_plan_fingerprint: 'shadow-plan-fixture',
    baseline: { probability: championProbability, model_version: 'champion-v1' },
    shadow: { probability: shadowProbability, model_version: 'pattern-shadow-v1' },
    governance: { shadow_only: true, production_decision_affected: false, decision_weight: 0, capital_execution_allowed: false, real_money: 'NO' }
  };
  return withFingerprint(payload, 'shadow_prediction_fingerprint');
}

function findMatchesInBand(seed, lowInclusive, highExclusive, count, start = 0) {
  const matches = [];
  for (let i = start; matches.length < count && i < start + 200000; i += 1) {
    const id = `step12-match-${i}`;
    const key = `${id}|1X2|HOME`;
    const value = routeValue(seed, key);
    if (value >= lowInclusive && value < highExclusive) matches.push(id);
  }
  if (matches.length !== count) throw new Error('TEST_COULD_NOT_FIND_ROUTING_BAND_FIXTURES');
  return matches;
}

function makeExpansionSettlements(activation, count, outcome = 1) {
  const ids = findMatchesInBand(activation.routing.seed, activation.routing.previous_fraction, activation.routing.active_fraction, count);
  return ids.map((id, index) => {
    const decision = routeStagedPatternCanaryExpansion({ activation, shadowPrediction: makeShadow(id), routedAt: `2026-01-04T01:${String(index % 60).padStart(2, '0')}:00Z` });
    assert.equal(decision.state, 'STAGED_CANARY_APPLIED_PAPER_ONLY');
    assert.equal(decision.routing.band, 'EXPANSION_BAND');
    return settleStagedPatternCanaryDecision({ decision, outcome, settledAt: '2026-01-06T00:00:00Z' });
  });
}

test('Step 12 activation consumes exact Step 11 approval and preserves frozen safety boundaries', () => {
  const { step10Authorization, activation } = makeActivation();
  assert.equal(verifyStagedPatternCanaryExpansionActivation(activation), true);
  assert.equal(activation.activation_version, STAGED_PATTERN_CANARY_EXPANSION_VERSION);
  assert.equal(activation.routing.previous_fraction, 0.05);
  assert.equal(activation.routing.active_fraction, 0.10);
  assert.equal(activation.routing.seed, step10Authorization.routing.seed);
  assert.equal(activation.influence.maximum_absolute_probability_shift, 0.02);
  assert.equal(activation.governance.production_decision_weight, 0);
  assert.equal(activation.governance.capital_execution_allowed, false);
  assert.equal(activation.governance.real_money, 'NO');
});

test('Step 12 refuses activation without explicit Step 11 approval state', () => {
  const step10Authorization = makeStep10Authorization();
  const step11Decision = makeStep11Decision(step10Authorization, { state: 'CANARY_HELD_AT_CURRENT_STAGE', decision: 'HOLD_CURRENT_CANARY' });
  assert.throws(() => activateStagedPatternCanaryExpansion({ step10Authorization, step11Decision, activatedAt: '2026-01-03T00:00:00Z', activator: 'x', rationale: 'x' }), /STEP12_EXPLICIT_STEP11_EXPANSION_APPROVAL_REQUIRED/);
});

test('Step 12 refuses routing above the 10 percent staged cap', () => {
  const step10Authorization = makeStep10Authorization();
  const step11Decision = makeStep11Decision(step10Authorization, { next_stage: { approved_not_activated: true, maximum_routing_fraction: 0.11, maximum_absolute_probability_shift: 0.02, activation_performed_here: false, full_production_promotion_authorized: false } });
  assert.throws(() => activateStagedPatternCanaryExpansion({ step10Authorization, step11Decision, activatedAt: '2026-01-03T00:00:00Z', activator: 'x', rationale: 'x' }), /STEP12_STAGED_ROUTING_FRACTION_OUT_OF_BOUNDS/);
});

test('Step 12 deterministic routing identifies the new expansion band and keeps probability shift capped', () => {
  const { activation } = makeActivation();
  const id = findMatchesInBand(activation.routing.seed, 0.05, 0.10, 1)[0];
  const decision = routeStagedPatternCanaryExpansion({ activation, shadowPrediction: makeShadow(id, { championProbability: 0.50, shadowProbability: 0.90 }), routedAt: '2026-01-04T01:00:00Z' });
  assert.equal(verifyStagedPatternCanaryDecision(decision), true);
  assert.equal(decision.routing.band, 'EXPANSION_BAND');
  assert.equal(decision.canary.applied, true);
  assert.equal(decision.canary.bounded_probability_delta, 0.02);
  assert.equal(decision.governance.production_decision_weight, 0);
});

test('Step 12 forbids retroactive and post-kickoff routing', () => {
  const { activation } = makeActivation();
  const id = findMatchesInBand(activation.routing.seed, 0.05, 0.10, 1)[0];
  assert.throws(() => routeStagedPatternCanaryExpansion({ activation, shadowPrediction: makeShadow(id, { generatedAt: '2026-01-02T00:00:00Z' }), routedAt: '2026-01-04T01:00:00Z' }), /STEP12_RETROACTIVE_ROUTING_FORBIDDEN/);
  assert.throws(() => routeStagedPatternCanaryExpansion({ activation, shadowPrediction: makeShadow(id), routedAt: '2026-01-05T00:00:00Z' }), /STEP12_POST_KICKOFF_ROUTING_FORBIDDEN/);
});

test('Step 12 settlement is post-kickoff only', () => {
  const { activation } = makeActivation();
  const id = findMatchesInBand(activation.routing.seed, 0.05, 0.10, 1)[0];
  const decision = routeStagedPatternCanaryExpansion({ activation, shadowPrediction: makeShadow(id), routedAt: '2026-01-04T01:00:00Z' });
  assert.throws(() => settleStagedPatternCanaryDecision({ decision, outcome: 1, settledAt: '2026-01-04T23:00:00Z' }), /STEP12_SETTLEMENT_MUST_FOLLOW_KICKOFF/);
});

test('Step 12 health remains accumulating before the independent expansion-band minimum N', () => {
  const { activation } = makeActivation();
  const settlements = makeExpansionSettlements(activation, 29, 1);
  const health = evaluateStagedPatternCanaryHealth({ activation, settlements, evaluatedAt: '2026-01-07T00:00:00Z' });
  assert.equal(health.state, 'STAGED_CANARY_HEALTH_ACCUMULATING_PAPER_ONLY');
  assert.equal(health.gates.minimum_expansion_band_n, false);
  assert.equal(health.rollback_required, false);
});

test('Step 12 declares healthy only after both full-stage and expansion-band minimum N pass without degradation', () => {
  const { activation } = makeActivation();
  const settlements = makeExpansionSettlements(activation, 30, 1);
  const health = evaluateStagedPatternCanaryHealth({ activation, settlements, evaluatedAt: '2026-01-07T00:00:00Z' });
  assert.equal(verifyStagedPatternCanaryHealth(health), true);
  assert.equal(health.state, 'STAGED_CANARY_HEALTHY_CONTINUE_PAPER_ONLY');
  assert.equal(health.gates.minimum_new_stage_n, true);
  assert.equal(health.gates.minimum_expansion_band_n, true);
  assert.equal(health.rollback_required, false);
  assert.equal(health.additional_alpha_spent, false);
});

test('Step 12 performance degradation at minimum N requires champion rollback', () => {
  const { activation } = makeActivation();
  const settlements = makeExpansionSettlements(activation, 30, 0);
  const health = evaluateStagedPatternCanaryHealth({ activation, settlements, evaluatedAt: '2026-01-07T00:00:00Z' });
  assert.equal(health.state, 'STAGED_CANARY_ROLLBACK_TO_CHAMPION_REQUIRED');
  assert.equal(health.rollback_required, true);
  assert.equal(health.rollback_reason, 'STAGED_CANARY_PERFORMANCE_DEGRADATION');
});

test('Step 12 immediate integrity signal rolls back even before minimum N', () => {
  const { activation } = makeActivation();
  const settlements = makeExpansionSettlements(activation, 1, 1);
  const health = evaluateStagedPatternCanaryHealth({ activation, settlements, evaluatedAt: '2026-01-07T00:00:00Z', integritySignals: ['POST_KICKOFF_LEAKAGE'] });
  assert.equal(health.rollback_required, true);
  assert.equal(health.rollback_reason, 'IMMEDIATE_INTEGRITY_OR_KILL_SIGNAL');
});

test('Step 12 rollback permanently forces champion-only routing for the same activation', () => {
  const { activation } = makeActivation();
  const health = evaluateStagedPatternCanaryHealth({ activation, settlements: [], evaluatedAt: '2026-01-07T00:00:00Z', integritySignals: ['PROVENANCE_OR_FINGERPRINT_FAILURE'] });
  const rollback = recordStagedPatternCanaryRollback({ activation, healthEvaluation: health, reason: health.rollback_reason, actor: 'step12-governor', rationale: 'integrity boundary failed', rolledBackAt: '2026-01-08T00:00:00Z' });
  assert.equal(verifyStagedPatternCanaryRollbackRecord(rollback), true);
  assert.equal(rollback.enforcement.routing_fraction_after_rollback, 0);
  const id = findMatchesInBand(activation.routing.seed, 0.05, 0.10, 1, 5000)[0];
  const decision = routeStagedPatternCanaryExpansion({ activation, shadowPrediction: makeShadow(id, { generatedAt: '2026-01-09T00:00:00Z', kickoffAt: '2026-01-10T00:00:00Z' }), routedAt: '2026-01-09T01:00:00Z', rollbackRecord: rollback });
  assert.equal(decision.state, 'CHAMPION_FALLBACK_STAGE_ROLLED_BACK');
  assert.equal(decision.canary.applied, false);
  assert.equal(decision.canary.bounded_probability_delta, 0);
});

test('Step 12 fingerprint tampering is rejected', () => {
  const { activation } = makeActivation();
  const tampered = { ...activation, routing: { ...activation.routing, active_fraction: 0.09 } };
  assert.throws(() => verifyStagedPatternCanaryExpansionActivation(tampered), /STEP12_ACTIVATION_FINGERPRINT_INVALID/);
});
