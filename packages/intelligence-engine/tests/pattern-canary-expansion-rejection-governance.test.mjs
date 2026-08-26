import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  CONTROLLED_PATTERN_CANARY_VERSION,
  evaluateControlledPatternCanaryHealth
} from '../src/controlled-pattern-canary-activation-rollback.mjs';
import {
  PATTERN_CANARY_EXPANSION_GOVERNANCE_VERSION,
  EXPANSION_CONFIRMATION_MIN_NEW_SETTLED_N,
  EXPANSION_MIN_TOTAL_SETTLED_N,
  EXPANSION_NEXT_STAGE_MAX_ROUTING_FRACTION,
  freezePatternCanaryExpansionCheckpoint,
  evaluatePatternCanaryExpansionEvidence,
  recordPatternCanaryExpansionDecision,
  verifyPatternCanaryExpansionDecision
} from '../src/pattern-canary-expansion-rejection-governance.mjs';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(stableStringify(value)).digest('hex'); }
function iso(base, days, hour = 0) { const d = new Date(base); d.setUTCDate(d.getUTCDate() + days); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); }
function loss(p, y) { const eps = 1e-15; return { brier: (p-y)**2, log_loss: -(y*Math.log(Math.max(eps,p))+(1-y)*Math.log(Math.max(eps,1-p))) }; }

function authorization() {
  const payload = {
    authorization_version: CONTROLLED_PATTERN_CANARY_VERSION,
    state: 'CONTROLLED_PATTERN_CANARY_ACTIVE_PAPER_ONLY',
    activated_at: '2026-01-01T00:00:00.000Z',
    activator: 'TEST_GOVERNOR', rationale: 'synthetic test only', channel: 'PAPER',
    source_step9_approval_fingerprint: 'STEP9-APPROVAL', source_step9_forward_evaluation_fingerprint: 'STEP9-FORWARD', source_dossier_fingerprint: 'DOSSIER', source_shadow_plan_fingerprint: 'SHADOW-PLAN',
    approved_pattern_ids: ['PATTERN-A'], calibration_version: 'CAL-V1', calibration_provenance: 'SYNTHETIC_TEST_ONLY',
    routing: { method: 'DETERMINISTIC_SHA256_MATCH_MARKET_SELECTION', seed: 'seed', maximum_fraction: 0.05, active_fraction: 0.05, cherry_pick_allowed: false },
    influence: { source: 'STEP8_SHADOW_MINUS_CHAMPION_DELTA', maximum_absolute_probability_shift: 0.02, maximum_contract_limit: 0.02, champion_probability_mutated_in_place: false },
    kill_switch: { state: 'ARMED', immediate_signals: ['MANUAL_KILL_SWITCH'], champion_fallback_required: true },
    health_policy: { minimum_routed_settled_n: 30, brier_non_degradation_required: true, log_loss_non_degradation_required: true, maximum_ece_degradation: 0.01 },
    governance: { paper_or_research_only: true, production_decision_weight: 0, production_mutation_allowed: false, capital_execution_allowed: false, gate6_capital_lock_preserved: true, automatic_full_promotion: false, automatic_retuning: false, p002_changed: false, gate1_to_gate6_ownership_changed: false, capital_effect: 'NONE', real_money: 'NO' }
  };
  return { ...payload, canary_authorization_fingerprint: sha256(payload) };
}

function decision(auth, i, { afterFreeze=true, canaryP=0.57, championP=0.55 } = {}) {
  const routedAt = afterFreeze ? iso('2026-02-02T00:00:00.000Z', i, 8) : iso('2026-01-10T00:00:00.000Z', i, 8);
  const kickoff = afterFreeze ? iso('2026-02-02T00:00:00.000Z', i, 12) : iso('2026-01-10T00:00:00.000Z', i, 12);
  const payload = {
    decision_version: CONTROLLED_PATTERN_CANARY_VERSION,
    state: 'CANARY_APPLIED_PAPER_ONLY', routed_at: routedAt,
    match_id: `CONF-${i}`, market_key: 'BINARY_TEST', selection: 'YES', kickoff_at: kickoff,
    source_canary_authorization_fingerprint: auth.canary_authorization_fingerprint,
    source_shadow_prediction_fingerprint: `SHADOW-${i}`, source_shadow_plan_fingerprint: auth.source_shadow_plan_fingerprint,
    routing: { value: 0.01, threshold: auth.routing.active_fraction, selected: true },
    champion: { probability: championP, model_version: 'CHAMPION-V1' },
    canary: { source_shadow_probability: canaryP, raw_probability_delta: canaryP-championP, bounded_probability_delta: canaryP-championP, probability: canaryP, applied: true },
    governance: { paper_or_research_only: true, production_decision_weight: 0, production_mutation_allowed: false, capital_execution_allowed: false, champion_fallback_available: true, rollback_enforced: false, real_money: 'NO' }
  };
  return { ...payload, canary_decision_fingerprint: sha256(payload) };
}

function settlement(auth, { matchId, i, championP=0.55, canaryP=0.57, outcome, sourceDecision='INITIAL', dateBase='2026-01-02T00:00:00.000Z' }) {
  const payload = {
    settlement_version: CONTROLLED_PATTERN_CANARY_VERSION,
    match_id: matchId, market_key: 'BINARY_TEST', selection: 'YES', outcome,
    settled_at: iso(dateBase, i, 16),
    source_canary_authorization_fingerprint: auth.canary_authorization_fingerprint,
    source_canary_decision_fingerprint: sourceDecision,
    champion_probability: championP, canary_probability: canaryP,
    champion_loss: loss(championP, outcome), canary_loss: loss(canaryP, outcome),
    governance: { routed_canary_only: true, production_decision_weight: 0, capital_execution_allowed: false, real_money: 'NO' }
  };
  return { ...payload, canary_settlement_fingerprint: sha256(payload) };
}

function healthyInitial(auth, n=30) {
  return Array.from({length:n}, (_,i) => settlement(auth, { matchId:`INIT-${i}`, i, outcome:i%10<7?1:0 }));
}
function confirmation(auth, n=30, { healthy=true, afterFreeze=true } = {}) {
  const ds=[], ss=[];
  for (let i=0;i<n;i+=1) {
    const championP = healthy ? 0.55 : 0.50;
    const canaryP = healthy ? 0.57 : 0.52;
    const outcome = healthy ? (i%10<7?1:0) : (i%10<2?1:0);
    const d=decision(auth,i,{afterFreeze,championP,canaryP});
    ds.push(d);
    ss.push(settlement(auth,{matchId:d.match_id,i,championP,canaryP,outcome,sourceDecision:d.canary_decision_fingerprint,dateBase:'2026-02-02T00:00:00.000Z'}));
  }
  return { decisions:ds, settlements:ss };
}
function setupCheckpoint() {
  const auth=authorization();
  const initial=healthyInitial(auth,30);
  const health=evaluateControlledPatternCanaryHealth({authorization:auth,settlements:initial,evaluatedAt:'2026-01-31T20:00:00.000Z'});
  assert.equal(health.state,'CANARY_HEALTHY_CONTINUE_PAPER_ONLY');
  const checkpoint=freezePatternCanaryExpansionCheckpoint({authorization:auth,healthEvaluation:health,settlements:initial,frozenAt:'2026-02-01T00:00:00.000Z'});
  return {auth,initial,health,checkpoint};
}

test('Step 11 freezes an exact healthy Step 10 checkpoint and remains zero weight',()=>{
  const {checkpoint}=setupCheckpoint();
  assert.equal(PATTERN_CANARY_EXPANSION_GOVERNANCE_VERSION,'PATTERN_CANARY_EXPANSION_REJECTION_GOVERNANCE_V0_1');
  assert.equal(checkpoint.initial_routed_settled_n,30);
  assert.equal(checkpoint.governance.production_decision_weight,0);
  assert.equal(checkpoint.governance.expansion_activated_here,false);
});

test('checkpoint refuses a settlement cohort that does not reproduce Step 10 health',()=>{
  const {auth,initial,health}=setupCheckpoint();
  assert.throws(()=>freezePatternCanaryExpansionCheckpoint({authorization:auth,healthEvaluation:health,settlements:initial.slice(0,29),frozenAt:'2026-02-01T00:00:00.000Z'}),/STEP11_CHECKPOINT_EXACT_SETTLEMENT_COHORT_REQUIRED/);
});

test('N=29 new confirmation remains accumulating even when full cohort is healthy',()=>{
  const {auth,initial,checkpoint}=setupCheckpoint(); const c=confirmation(auth,29);
  const e=evaluatePatternCanaryExpansionEvidence({checkpoint,authorization:auth,checkpointSettlements:initial,confirmationDecisions:c.decisions,confirmationSettlements:c.settlements,evaluatedAt:'2026-03-10T00:00:00.000Z'});
  assert.equal(EXPANSION_CONFIRMATION_MIN_NEW_SETTLED_N,30); assert.equal(EXPANSION_MIN_TOTAL_SETTLED_N,60);
  assert.equal(e.state,'EXPANSION_CONFIRMATION_ACCUMULATING_CURRENT_STAGE'); assert.equal(e.gates.minimum_new_confirmation_n,false);
});

test('a second disjoint healthy N=30 cohort makes Step 11 manually decision-eligible',()=>{
  const {auth,initial,checkpoint}=setupCheckpoint(); const c=confirmation(auth,30);
  const e=evaluatePatternCanaryExpansionEvidence({checkpoint,authorization:auth,checkpointSettlements:initial,confirmationDecisions:c.decisions,confirmationSettlements:c.settlements,evaluatedAt:'2026-03-10T00:00:00.000Z'});
  assert.equal(e.state,'ELIGIBLE_FOR_MANUAL_NEXT_CANARY_STAGE_DECISION'); assert.equal(e.total_routed_settled_n,60); assert.ok(Object.values(e.gates).every(Boolean));
});

test('Step 11 forbids reuse of initial canary match-market-selection evidence',()=>{
  const {auth,initial,checkpoint}=setupCheckpoint(); const c=confirmation(auth,30);
  const d={...c.decisions[0],match_id:'INIT-0'}; const {canary_decision_fingerprint,...dp}=d; const d2={...dp,canary_decision_fingerprint:sha256(dp)};
  const s=settlement(auth,{matchId:'INIT-0',i:0,championP:0.55,canaryP:0.57,outcome:1,sourceDecision:d2.canary_decision_fingerprint,dateBase:'2026-02-02T00:00:00.000Z'});
  assert.throws(()=>evaluatePatternCanaryExpansionEvidence({checkpoint,authorization:auth,checkpointSettlements:initial,confirmationDecisions:[d2,...c.decisions.slice(1)],confirmationSettlements:[s,...c.settlements.slice(1)],evaluatedAt:'2026-03-10T00:00:00.000Z'}),/STEP11_INITIAL_CANARY_EVIDENCE_REUSE_FORBIDDEN/);
});

test('confirmation decisions routed before checkpoint freeze are rejected',()=>{
  const {auth,initial,checkpoint}=setupCheckpoint(); const c=confirmation(auth,30,{afterFreeze:false});
  assert.throws(()=>evaluatePatternCanaryExpansionEvidence({checkpoint,authorization:auth,checkpointSettlements:initial,confirmationDecisions:c.decisions,confirmationSettlements:c.settlements,evaluatedAt:'2026-03-10T00:00:00.000Z'}),/STEP11_CONFIRMATION_DECISION_MUST_FOLLOW_CHECKPOINT_FREEZE/);
});

test('degraded second cohort requires rejection/rollback instead of expansion',()=>{
  const {auth,initial,checkpoint}=setupCheckpoint(); const c=confirmation(auth,30,{healthy:false});
  const e=evaluatePatternCanaryExpansionEvidence({checkpoint,authorization:auth,checkpointSettlements:initial,confirmationDecisions:c.decisions,confirmationSettlements:c.settlements,evaluatedAt:'2026-03-10T00:00:00.000Z'});
  assert.equal(e.state,'CANARY_REJECTION_REQUIRED_ROLLBACK_TO_CHAMPION'); assert.equal(e.gates.no_rollback_signal,false);
  assert.throws(()=>recordPatternCanaryExpansionDecision({checkpoint,authorization:auth,evaluation:e,decision:'HOLD_CURRENT_CANARY',approver:'GOV',rationale:'bad cohort',decidedAt:'2026-03-11T00:00:00.000Z'}),/STEP11_HOLD_WHILE_ROLLBACK_REQUIRED_FORBIDDEN/);
});

test('manual expansion approval doubles at most to 10% but does not activate it',()=>{
  const {auth,initial,checkpoint}=setupCheckpoint(); const c=confirmation(auth,30);
  const e=evaluatePatternCanaryExpansionEvidence({checkpoint,authorization:auth,checkpointSettlements:initial,confirmationDecisions:c.decisions,confirmationSettlements:c.settlements,evaluatedAt:'2026-03-10T00:00:00.000Z'});
  const d=recordPatternCanaryExpansionDecision({checkpoint,authorization:auth,evaluation:e,decision:'APPROVE_NEXT_CANARY_STAGE',approver:'GOVERNOR',rationale:'second cohort stable',decidedAt:'2026-03-11T00:00:00.000Z'});
  assert.equal(d.state,'NEXT_CANARY_STAGE_APPROVED_NOT_ACTIVATED'); assert.equal(d.next_stage.maximum_routing_fraction,EXPANSION_NEXT_STAGE_MAX_ROUTING_FRACTION); assert.equal(d.next_stage.maximum_absolute_probability_shift,0.02); assert.equal(d.next_stage.activation_performed_here,false); assert.equal(d.governance.production_decision_weight,0); assert.equal(verifyPatternCanaryExpansionDecision(d),true);
});

test('hold is allowed while more evidence accumulates but expansion approval is not',()=>{
  const {auth,initial,checkpoint}=setupCheckpoint(); const c=confirmation(auth,10);
  const e=evaluatePatternCanaryExpansionEvidence({checkpoint,authorization:auth,checkpointSettlements:initial,confirmationDecisions:c.decisions,confirmationSettlements:c.settlements,evaluatedAt:'2026-03-10T00:00:00.000Z'});
  const h=recordPatternCanaryExpansionDecision({checkpoint,authorization:auth,evaluation:e,decision:'HOLD_CURRENT_CANARY',approver:'GOVERNOR',rationale:'collect more',decidedAt:'2026-03-11T00:00:00.000Z'});
  assert.equal(h.state,'CANARY_HELD_AT_CURRENT_STAGE');
  assert.throws(()=>recordPatternCanaryExpansionDecision({checkpoint,authorization:auth,evaluation:e,decision:'APPROVE_NEXT_CANARY_STAGE',approver:'GOVERNOR',rationale:'too early',decidedAt:'2026-03-11T00:00:00.000Z'}),/STEP11_EXPANSION_APPROVAL_WITHOUT_ELIGIBILITY_FORBIDDEN/);
});

test('reject and retire reuses Step 10 rollback and forces champion-only routing zero',()=>{
  const {auth,initial,checkpoint}=setupCheckpoint(); const c=confirmation(auth,30,{healthy:false});
  const e=evaluatePatternCanaryExpansionEvidence({checkpoint,authorization:auth,checkpointSettlements:initial,confirmationDecisions:c.decisions,confirmationSettlements:c.settlements,evaluatedAt:'2026-03-10T00:00:00.000Z'});
  const d=recordPatternCanaryExpansionDecision({checkpoint,authorization:auth,evaluation:e,decision:'REJECT_AND_RETIRE_PATTERN_CANARY',approver:'GOVERNOR',rationale:'confirmation degraded',decidedAt:'2026-03-11T00:00:00.000Z'});
  assert.equal(d.state,'CANARY_REJECTED_RETIRED_CHAMPION_ONLY'); assert.equal(d.next_stage.maximum_routing_fraction,0); assert.ok(d.rollback_fingerprint); assert.equal(d.governance.same_authorization_reactivation_allowed,false); assert.equal(verifyPatternCanaryExpansionDecision(d),true);
});

test('tampered Step 11 governance decision fails closed',()=>{
  const {auth,initial,checkpoint}=setupCheckpoint(); const c=confirmation(auth,30);
  const e=evaluatePatternCanaryExpansionEvidence({checkpoint,authorization:auth,checkpointSettlements:initial,confirmationDecisions:c.decisions,confirmationSettlements:c.settlements,evaluatedAt:'2026-03-10T00:00:00.000Z'});
  const d=recordPatternCanaryExpansionDecision({checkpoint,authorization:auth,evaluation:e,decision:'APPROVE_NEXT_CANARY_STAGE',approver:'GOVERNOR',rationale:'stable',decidedAt:'2026-03-11T00:00:00.000Z'});
  const t=structuredClone(d); t.next_stage.maximum_routing_fraction=1;
  assert.throws(()=>verifyPatternCanaryExpansionDecision(t),/STEP11_DECISION_FINGERPRINT_INVALID/);
});
