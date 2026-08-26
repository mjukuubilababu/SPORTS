import { createHash } from 'node:crypto';
import { PATTERN_PROMOTION_SHADOW_VERSION } from './pattern-promotion-shadow-integration.mjs';
import { verifyControlledPatternCanaryAuthorization } from './controlled-pattern-canary-activation-rollback.mjs';
import { verifyPatternCanaryExpansionDecision } from './pattern-canary-expansion-rejection-governance.mjs';

export const STAGED_PATTERN_CANARY_EXPANSION_VERSION = 'STAGED_PATTERN_CANARY_EXPANSION_ACTIVATION_MONITORING_V0_1';
export const STAGED_EXPANSION_MAX_ROUTING_FRACTION = 0.10;
export const STAGED_EXPANSION_MAX_ABS_PROBABILITY_SHIFT = 0.02;
export const STAGED_EXPANSION_HEALTH_MIN_SETTLED_N = 30;
export const STAGED_EXPANSION_BAND_MIN_SETTLED_N = 30;
export const STAGED_EXPANSION_MAX_ECE_DEGRADATION = 0.01;

const IMMEDIATE_ROLLBACK_SIGNALS = new Set([
  'PROVENANCE_OR_FINGERPRINT_FAILURE',
  'POST_KICKOFF_LEAKAGE',
  'LINEAGE_OR_CALIBRATION_DRIFT',
  'MANUAL_KILL_SWITCH'
]);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(stableStringify(value)).digest('hex'); }
function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const v of Object.values(value)) deepFreeze(v); return value; }
function parseTimestamp(name, value) { const ms = Date.parse(value); if (!value || Number.isNaN(ms)) throw new Error(`${name}_INVALID_TIMESTAMP`); return ms; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function keyOf(row) { return `${row.match_id}|${row.market_key}|${row.selection}`; }
function sorted(values) { return [...values].sort(); }
function fingerprintPayload(row, field, error) { const { [field]: fp, ...payload } = row ?? {}; if (!fp || sha256(payload) !== fp) throw new Error(error); return true; }
function routingUnit(seed, key) { const hex = createHash('sha256').update(`${seed}|${key}`).digest('hex').slice(0, 13); return Number.parseInt(hex, 16) / 0x10000000000000; }

function verifyShadowPrediction(row) {
  fingerprintPayload(row, 'shadow_prediction_fingerprint', 'STEP12_SHADOW_PREDICTION_FINGERPRINT_INVALID');
  if (row.shadow_version !== PATTERN_PROMOTION_SHADOW_VERSION) throw new Error('STEP12_SHADOW_PREDICTION_VERSION_INVALID');
  if (row.governance?.shadow_only !== true || row.governance?.production_decision_affected !== false) throw new Error('STEP12_SHADOW_PREDICTION_GOVERNANCE_INVALID');
  if (!(row.baseline?.probability > 0 && row.baseline?.probability < 1) || !(row.shadow?.probability > 0 && row.shadow?.probability < 1)) throw new Error('STEP12_SHADOW_PROBABILITY_INVALID');
  return true;
}

export function activateStagedPatternCanaryExpansion({ step10Authorization, step11Decision, activatedAt, activator, rationale }) {
  verifyControlledPatternCanaryAuthorization(step10Authorization);
  verifyPatternCanaryExpansionDecision(step11Decision);
  if (step11Decision.state !== 'NEXT_CANARY_STAGE_APPROVED_NOT_ACTIVATED' || step11Decision.decision !== 'APPROVE_NEXT_CANARY_STAGE') throw new Error('STEP12_EXPLICIT_STEP11_EXPANSION_APPROVAL_REQUIRED');
  if (step11Decision.canary_authorization_fingerprint !== step10Authorization.canary_authorization_fingerprint) throw new Error('STEP12_STEP11_STEP10_AUTHORIZATION_MISMATCH');
  if (step11Decision.next_stage?.approved_not_activated !== true || step11Decision.next_stage?.activation_performed_here !== false) throw new Error('STEP12_STEP11_APPROVAL_NOT_ACTIVATED_REQUIRED');
  if (step11Decision.next_stage_name !== 'STEP_12_STAGED_CANARY_EXPANSION_ACTIVATION_AND_MONITORING') throw new Error('STEP12_STEP11_NEXT_STAGE_LINEAGE_INVALID');
  if (step11Decision.current_stage?.routing_fraction !== step10Authorization.routing.active_fraction) throw new Error('STEP12_CURRENT_ROUTING_STAGE_MISMATCH');
  const nextRouting = step11Decision.next_stage.maximum_routing_fraction;
  const nextShift = step11Decision.next_stage.maximum_absolute_probability_shift;
  if (!(nextRouting > step10Authorization.routing.active_fraction && nextRouting <= STAGED_EXPANSION_MAX_ROUTING_FRACTION)) throw new Error('STEP12_STAGED_ROUTING_FRACTION_OUT_OF_BOUNDS');
  if (!(nextShift > 0 && nextShift <= STAGED_EXPANSION_MAX_ABS_PROBABILITY_SHIFT)) throw new Error('STEP12_STAGED_PROBABILITY_SHIFT_OUT_OF_BOUNDS');
  if (nextShift > step10Authorization.influence.maximum_absolute_probability_shift) throw new Error('STEP12_PROBABILITY_INFLUENCE_CAP_INCREASE_FORBIDDEN');
  if (!['PAPER', 'RESEARCH'].includes(step10Authorization.channel)) throw new Error('STEP12_CHANNEL_MUST_BE_PAPER_OR_RESEARCH');
  if (!activator || !String(activator).trim()) throw new Error('STEP12_ACTIVATOR_REQUIRED');
  if (!rationale || !String(rationale).trim()) throw new Error('STEP12_ACTIVATION_RATIONALE_REQUIRED');
  if (parseTimestamp('STEP12_ACTIVATED_AT', activatedAt) <= parseTimestamp('STEP12_STEP11_DECIDED_AT', step11Decision.decided_at)) throw new Error('STEP12_ACTIVATION_MUST_FOLLOW_STEP11_DECISION');
  const payload = {
    activation_version: STAGED_PATTERN_CANARY_EXPANSION_VERSION,
    state: 'STAGED_PATTERN_CANARY_EXPANSION_ACTIVE_PAPER_ONLY',
    activated_at: activatedAt,
    activator: String(activator).trim(),
    rationale: String(rationale).trim(),
    channel: step10Authorization.channel,
    source_step10_canary_authorization_fingerprint: step10Authorization.canary_authorization_fingerprint,
    source_step11_expansion_decision_fingerprint: step11Decision.expansion_decision_fingerprint,
    source_step11_checkpoint_fingerprint: step11Decision.expansion_checkpoint_fingerprint,
    source_step11_evaluation_fingerprint: step11Decision.expansion_evaluation_fingerprint,
    source_shadow_plan_fingerprint: step10Authorization.source_shadow_plan_fingerprint,
    calibration_version: step10Authorization.calibration_version ?? null,
    calibration_provenance: step10Authorization.calibration_provenance ?? null,
    routing: {
      method: 'DETERMINISTIC_SHA256_MATCH_MARKET_SELECTION',
      seed: step10Authorization.routing.seed,
      previous_fraction: step10Authorization.routing.active_fraction,
      active_fraction: nextRouting,
      maximum_fraction: STAGED_EXPANSION_MAX_ROUTING_FRACTION,
      cherry_pick_allowed: false,
      expansion_band: { lower_bound_inclusive: step10Authorization.routing.active_fraction, upper_bound_exclusive: nextRouting }
    },
    influence: {
      source: 'STEP8_SHADOW_MINUS_CHAMPION_DELTA',
      maximum_absolute_probability_shift: nextShift,
      maximum_contract_limit: STAGED_EXPANSION_MAX_ABS_PROBABILITY_SHIFT,
      champion_probability_mutated_in_place: false
    },
    kill_switch: { state: 'ARMED', immediate_signals: sorted(IMMEDIATE_ROLLBACK_SIGNALS), champion_fallback_required: true },
    health_policy: {
      minimum_new_stage_routed_settled_n: STAGED_EXPANSION_HEALTH_MIN_SETTLED_N,
      minimum_expansion_band_routed_settled_n: STAGED_EXPANSION_BAND_MIN_SETTLED_N,
      brier_non_degradation_required: true,
      log_loss_non_degradation_required: true,
      maximum_ece_degradation: STAGED_EXPANSION_MAX_ECE_DEGRADATION,
      additional_alpha_spent: false
    },
    governance: {
      paper_or_research_only: true,
      production_decision_weight: 0,
      production_mutation_allowed: false,
      capital_execution_allowed: false,
      gate6_capital_lock_preserved: true,
      automatic_further_expansion: false,
      automatic_full_promotion: false,
      automatic_retuning: false,
      p002_changed: false,
      gate1_to_gate6_ownership_changed: false,
      capital_effect: 'NONE',
      real_money: 'NO'
    }
  };
  return deepFreeze({ ...payload, staged_activation_fingerprint: sha256(payload) });
}

export function verifyStagedPatternCanaryExpansionActivation(a) {
  if (!a || a.activation_version !== STAGED_PATTERN_CANARY_EXPANSION_VERSION) throw new Error('STEP12_ACTIVATION_VERSION_INVALID');
  fingerprintPayload(a, 'staged_activation_fingerprint', 'STEP12_ACTIVATION_FINGERPRINT_INVALID');
  if (a.state !== 'STAGED_PATTERN_CANARY_EXPANSION_ACTIVE_PAPER_ONLY') throw new Error('STEP12_ACTIVATION_STATE_INVALID');
  if (a.routing?.method !== 'DETERMINISTIC_SHA256_MATCH_MARKET_SELECTION' || a.routing?.active_fraction > STAGED_EXPANSION_MAX_ROUTING_FRACTION || a.routing?.active_fraction <= a.routing?.previous_fraction) throw new Error('STEP12_ACTIVATION_ROUTING_INVALID');
  if (a.influence?.maximum_absolute_probability_shift > STAGED_EXPANSION_MAX_ABS_PROBABILITY_SHIFT) throw new Error('STEP12_ACTIVATION_SHIFT_CAP_BREACH');
  if (a.governance?.production_decision_weight !== 0 || a.governance?.production_mutation_allowed !== false || a.governance?.capital_execution_allowed !== false || a.governance?.real_money !== 'NO') throw new Error('STEP12_ACTIVATION_GOVERNANCE_INVALID');
  return true;
}

export function routeStagedPatternCanaryExpansion({ activation, shadowPrediction, routedAt, rollbackRecord = null }) {
  verifyStagedPatternCanaryExpansionActivation(activation);
  verifyShadowPrediction(shadowPrediction);
  if (shadowPrediction.source_shadow_plan_fingerprint !== activation.source_shadow_plan_fingerprint) throw new Error('STEP12_SHADOW_PLAN_LINEAGE_DRIFT');
  const activationMs = parseTimestamp('STEP12_ACTIVATED_AT', activation.activated_at);
  const generatedMs = parseTimestamp('STEP12_SHADOW_GENERATED_AT', shadowPrediction.generated_at);
  const routedMs = parseTimestamp('STEP12_ROUTED_AT', routedAt);
  const kickoffMs = parseTimestamp('STEP12_KICKOFF_AT', shadowPrediction.kickoff_at);
  if (generatedMs < activationMs || routedMs <= activationMs) throw new Error('STEP12_RETROACTIVE_ROUTING_FORBIDDEN');
  if (generatedMs >= kickoffMs || routedMs >= kickoffMs) throw new Error('STEP12_POST_KICKOFF_ROUTING_FORBIDDEN');
  if (routedMs < generatedMs) throw new Error('STEP12_ROUTING_CANNOT_PREDATE_SHADOW_PREDICTION');
  if (rollbackRecord) {
    verifyStagedPatternCanaryRollbackRecord(rollbackRecord);
    if (rollbackRecord.staged_activation_fingerprint !== activation.staged_activation_fingerprint) throw new Error('STEP12_ROLLBACK_ACTIVATION_MISMATCH');
    if (routedMs < parseTimestamp('STEP12_ROLLED_BACK_AT', rollbackRecord.rolled_back_at)) throw new Error('STEP12_ROLLBACK_CANNOT_APPLY_RETROACTIVELY');
  }
  const routeValue = routingUnit(activation.routing.seed, keyOf(shadowPrediction));
  const selected = !rollbackRecord && routeValue < activation.routing.active_fraction;
  const routingBand = selected ? (routeValue < activation.routing.previous_fraction ? 'BASE_CANARY_BAND' : 'EXPANSION_BAND') : 'CHAMPION_ONLY';
  const baseline = shadowPrediction.baseline.probability;
  const rawDelta = shadowPrediction.shadow.probability - baseline;
  const boundedDelta = selected ? clamp(rawDelta, -activation.influence.maximum_absolute_probability_shift, activation.influence.maximum_absolute_probability_shift) : 0;
  const payload = {
    decision_version: STAGED_PATTERN_CANARY_EXPANSION_VERSION,
    state: rollbackRecord ? 'CHAMPION_FALLBACK_STAGE_ROLLED_BACK' : selected ? 'STAGED_CANARY_APPLIED_PAPER_ONLY' : 'CHAMPION_FALLBACK_NOT_ROUTED',
    routed_at: routedAt,
    match_id: shadowPrediction.match_id,
    market_key: shadowPrediction.market_key,
    selection: shadowPrediction.selection,
    kickoff_at: shadowPrediction.kickoff_at,
    source_staged_activation_fingerprint: activation.staged_activation_fingerprint,
    source_shadow_prediction_fingerprint: shadowPrediction.shadow_prediction_fingerprint,
    source_shadow_plan_fingerprint: shadowPrediction.source_shadow_plan_fingerprint,
    routing: { value: routeValue, threshold: activation.routing.active_fraction, previous_threshold: activation.routing.previous_fraction, selected, band: routingBand },
    champion: { probability: baseline, model_version: shadowPrediction.baseline.model_version },
    canary: {
      source_shadow_probability: shadowPrediction.shadow.probability,
      raw_probability_delta: rawDelta,
      bounded_probability_delta: boundedDelta,
      probability: clamp(baseline + boundedDelta, 1e-9, 1 - 1e-9),
      applied: selected
    },
    governance: {
      paper_or_research_only: true,
      production_decision_weight: 0,
      production_mutation_allowed: false,
      capital_execution_allowed: false,
      champion_fallback_available: true,
      rollback_enforced: Boolean(rollbackRecord),
      real_money: 'NO'
    }
  };
  return deepFreeze({ ...payload, staged_decision_fingerprint: sha256(payload) });
}

export function verifyStagedPatternCanaryDecision(d) {
  if (!d || d.decision_version !== STAGED_PATTERN_CANARY_EXPANSION_VERSION) throw new Error('STEP12_DECISION_VERSION_INVALID');
  fingerprintPayload(d, 'staged_decision_fingerprint', 'STEP12_DECISION_FINGERPRINT_INVALID');
  if (d.governance?.production_decision_weight !== 0 || d.governance?.capital_execution_allowed !== false || d.governance?.real_money !== 'NO') throw new Error('STEP12_DECISION_GOVERNANCE_INVALID');
  if (Math.abs(d.canary?.bounded_probability_delta ?? 0) > STAGED_EXPANSION_MAX_ABS_PROBABILITY_SHIFT + 1e-12) throw new Error('STEP12_DECISION_SHIFT_CAP_BREACH');
  if (d.routing?.band === 'EXPANSION_BAND' && !(d.routing.value >= d.routing.previous_threshold && d.routing.value < d.routing.threshold)) throw new Error('STEP12_EXPANSION_BAND_CLASSIFICATION_INVALID');
  return true;
}

export function settleStagedPatternCanaryDecision({ decision, outcome, settledAt }) {
  verifyStagedPatternCanaryDecision(decision);
  if (decision.state !== 'STAGED_CANARY_APPLIED_PAPER_ONLY' || decision.canary?.applied !== true) throw new Error('STEP12_ONLY_ROUTED_STAGED_CANARY_DECISIONS_COUNT');
  if (![0, 1].includes(outcome)) throw new Error('STEP12_BINARY_OUTCOME_REQUIRED');
  if (parseTimestamp('STEP12_SETTLED_AT', settledAt) <= parseTimestamp('STEP12_KICKOFF_AT', decision.kickoff_at)) throw new Error('STEP12_SETTLEMENT_MUST_FOLLOW_KICKOFF');
  const eps = 1e-15;
  const loss = p => ({ brier: (p - outcome) ** 2, log_loss: -(outcome * Math.log(Math.max(eps, p)) + (1 - outcome) * Math.log(Math.max(eps, 1 - p))) });
  const payload = {
    settlement_version: STAGED_PATTERN_CANARY_EXPANSION_VERSION,
    match_id: decision.match_id,
    market_key: decision.market_key,
    selection: decision.selection,
    outcome,
    settled_at: settledAt,
    routing_band: decision.routing.band,
    source_staged_activation_fingerprint: decision.source_staged_activation_fingerprint,
    source_staged_decision_fingerprint: decision.staged_decision_fingerprint,
    champion_probability: decision.champion.probability,
    canary_probability: decision.canary.probability,
    champion_loss: loss(decision.champion.probability),
    canary_loss: loss(decision.canary.probability),
    governance: { routed_staged_canary_only: true, production_decision_weight: 0, capital_execution_allowed: false, real_money: 'NO' }
  };
  return deepFreeze({ ...payload, staged_settlement_fingerprint: sha256(payload) });
}

export function verifyStagedPatternCanarySettlement(s) {
  if (!s || s.settlement_version !== STAGED_PATTERN_CANARY_EXPANSION_VERSION) throw new Error('STEP12_SETTLEMENT_VERSION_INVALID');
  fingerprintPayload(s, 'staged_settlement_fingerprint', 'STEP12_SETTLEMENT_FINGERPRINT_INVALID');
  if (s.governance?.routed_staged_canary_only !== true || s.governance?.capital_execution_allowed !== false || s.governance?.real_money !== 'NO') throw new Error('STEP12_SETTLEMENT_GOVERNANCE_INVALID');
  if (!['BASE_CANARY_BAND', 'EXPANSION_BAND'].includes(s.routing_band)) throw new Error('STEP12_SETTLEMENT_ROUTING_BAND_INVALID');
  return true;
}

function mean(values) { return values.reduce((sum, v) => sum + v, 0) / values.length; }
function ece(rows, key, bins = 10) {
  let total = 0;
  for (let b = 0; b < bins; b += 1) {
    const lo = b / bins, hi = (b + 1) / bins;
    const bucket = rows.filter(r => r[key] >= lo && (b === bins - 1 ? r[key] <= hi : r[key] < hi));
    if (!bucket.length) continue;
    total += (bucket.length / rows.length) * Math.abs(mean(bucket.map(r => r[key])) - mean(bucket.map(r => r.outcome)));
  }
  return total;
}
function metrics(rows, prefix) {
  if (!rows.length) return { n: 0, brier: null, logLoss: null, ece: null };
  const pk = `${prefix}_probability`, lk = `${prefix}_loss`;
  return { n: rows.length, brier: mean(rows.map(r => r[lk].brier)), logLoss: mean(rows.map(r => r[lk].log_loss)), ece: ece(rows, pk) };
}
function degraded(champion, canary) {
  return canary.brier > champion.brier || canary.logLoss > champion.logLoss || canary.ece > champion.ece + STAGED_EXPANSION_MAX_ECE_DEGRADATION;
}

export function evaluateStagedPatternCanaryHealth({ activation, settlements, evaluatedAt, integritySignals = [] }) {
  verifyStagedPatternCanaryExpansionActivation(activation);
  const evaluatedMs = parseTimestamp('STEP12_HEALTH_EVALUATED_AT', evaluatedAt);
  if (!Array.isArray(settlements) || !Array.isArray(integritySignals)) throw new Error('STEP12_HEALTH_ARRAYS_REQUIRED');
  const seen = new Set();
  for (const s of settlements) {
    verifyStagedPatternCanarySettlement(s);
    if (s.source_staged_activation_fingerprint !== activation.staged_activation_fingerprint) throw new Error('STEP12_SETTLEMENT_ACTIVATION_MISMATCH');
    if (parseTimestamp('STEP12_SETTLED_AT', s.settled_at) > evaluatedMs) throw new Error('STEP12_HEALTH_EVALUATION_CANNOT_PREDATE_SETTLEMENT');
    if (seen.has(keyOf(s))) throw new Error('STEP12_DUPLICATE_STAGED_SETTLEMENT');
    seen.add(keyOf(s));
  }
  const signals = sorted(new Set(integritySignals));
  for (const signal of signals) if (!IMMEDIATE_ROLLBACK_SIGNALS.has(signal)) throw new Error(`STEP12_UNKNOWN_INTEGRITY_SIGNAL:${signal}`);
  const expansionRows = settlements.filter(s => s.routing_band === 'EXPANSION_BAND');
  const fullChampion = metrics(settlements, 'champion');
  const fullCanary = metrics(settlements, 'canary');
  const expansionChampion = metrics(expansionRows, 'champion');
  const expansionCanary = metrics(expansionRows, 'canary');
  const enoughFull = settlements.length >= STAGED_EXPANSION_HEALTH_MIN_SETTLED_N;
  const enoughExpansion = expansionRows.length >= STAGED_EXPANSION_BAND_MIN_SETTLED_N;
  const immediateRollback = signals.length > 0;
  const fullPerformanceRollback = enoughFull && degraded(fullChampion, fullCanary);
  const expansionPerformanceRollback = enoughExpansion && degraded(expansionChampion, expansionCanary);
  const rollbackRequired = immediateRollback || fullPerformanceRollback || expansionPerformanceRollback;
  const healthy = enoughFull && enoughExpansion && !rollbackRequired;
  const payload = {
    health_version: STAGED_PATTERN_CANARY_EXPANSION_VERSION,
    state: rollbackRequired ? 'STAGED_CANARY_ROLLBACK_TO_CHAMPION_REQUIRED' : healthy ? 'STAGED_CANARY_HEALTHY_CONTINUE_PAPER_ONLY' : 'STAGED_CANARY_HEALTH_ACCUMULATING_PAPER_ONLY',
    evaluated_at: evaluatedAt,
    staged_activation_fingerprint: activation.staged_activation_fingerprint,
    new_stage_routed_settled_n: settlements.length,
    expansion_band_routed_settled_n: expansionRows.length,
    minimum_new_stage_routed_settled_n: STAGED_EXPANSION_HEALTH_MIN_SETTLED_N,
    minimum_expansion_band_routed_settled_n: STAGED_EXPANSION_BAND_MIN_SETTLED_N,
    full_stage: { champion: fullChampion, canary: fullCanary },
    expansion_band: { champion: expansionChampion, canary: expansionCanary },
    integrity_signals: signals,
    gates: {
      minimum_new_stage_n: enoughFull,
      minimum_expansion_band_n: enoughExpansion,
      no_integrity_signal: !immediateRollback,
      full_stage_brier_non_degraded: !enoughFull || fullCanary.brier <= fullChampion.brier,
      full_stage_log_loss_non_degraded: !enoughFull || fullCanary.logLoss <= fullChampion.logLoss,
      full_stage_ece_non_degraded: !enoughFull || fullCanary.ece <= fullChampion.ece + STAGED_EXPANSION_MAX_ECE_DEGRADATION,
      expansion_band_brier_non_degraded: !enoughExpansion || expansionCanary.brier <= expansionChampion.brier,
      expansion_band_log_loss_non_degraded: !enoughExpansion || expansionCanary.logLoss <= expansionChampion.logLoss,
      expansion_band_ece_non_degraded: !enoughExpansion || expansionCanary.ece <= expansionChampion.ece + STAGED_EXPANSION_MAX_ECE_DEGRADATION
    },
    rollback_required: rollbackRequired,
    rollback_reason: immediateRollback ? 'IMMEDIATE_INTEGRITY_OR_KILL_SIGNAL' : (fullPerformanceRollback || expansionPerformanceRollback) ? 'STAGED_CANARY_PERFORMANCE_DEGRADATION' : null,
    additional_alpha_spent: false,
    governance: {
      automatic_further_expansion: false,
      automatic_full_promotion: false,
      champion_fallback_required_on_rollback: true,
      production_decision_weight: 0,
      capital_execution_allowed: false,
      real_money: 'NO'
    },
    next_stage: healthy ? 'STEP_13_PATTERN_CANARY_GRADUATION_OR_RETIREMENT_GOVERNANCE' : 'CONTINUE_STEP12_MONITORING_OR_ROLLBACK'
  };
  return deepFreeze({ ...payload, staged_health_fingerprint: sha256(payload) });
}

export function verifyStagedPatternCanaryHealth(e) {
  if (!e || e.health_version !== STAGED_PATTERN_CANARY_EXPANSION_VERSION) throw new Error('STEP12_HEALTH_VERSION_INVALID');
  fingerprintPayload(e, 'staged_health_fingerprint', 'STEP12_HEALTH_FINGERPRINT_INVALID');
  if (e.additional_alpha_spent !== false || e.governance?.production_decision_weight !== 0 || e.governance?.capital_execution_allowed !== false) throw new Error('STEP12_HEALTH_GOVERNANCE_INVALID');
  return true;
}

export function recordStagedPatternCanaryRollback({ activation, healthEvaluation = null, reason, actor, rationale, rolledBackAt }) {
  verifyStagedPatternCanaryExpansionActivation(activation);
  if (!reason || !String(reason).trim()) throw new Error('STEP12_ROLLBACK_REASON_REQUIRED');
  if (!actor || !String(actor).trim()) throw new Error('STEP12_ROLLBACK_ACTOR_REQUIRED');
  if (!rationale || !String(rationale).trim()) throw new Error('STEP12_ROLLBACK_RATIONALE_REQUIRED');
  const rolledBackMs = parseTimestamp('STEP12_ROLLED_BACK_AT', rolledBackAt);
  if (rolledBackMs <= parseTimestamp('STEP12_ACTIVATED_AT', activation.activated_at)) throw new Error('STEP12_ROLLBACK_MUST_FOLLOW_ACTIVATION');
  if (healthEvaluation) {
    verifyStagedPatternCanaryHealth(healthEvaluation);
    if (healthEvaluation.staged_activation_fingerprint !== activation.staged_activation_fingerprint) throw new Error('STEP12_ROLLBACK_HEALTH_ACTIVATION_MISMATCH');
    if (rolledBackMs <= parseTimestamp('STEP12_HEALTH_EVALUATED_AT', healthEvaluation.evaluated_at)) throw new Error('STEP12_ROLLBACK_MUST_FOLLOW_HEALTH_EVALUATION');
    if (!healthEvaluation.rollback_required && reason !== 'MANUAL_KILL_SWITCH') throw new Error('STEP12_ROLLBACK_WITHOUT_TRIGGER_FORBIDDEN');
  } else if (reason !== 'MANUAL_KILL_SWITCH') {
    throw new Error('STEP12_HEALTH_EVALUATION_REQUIRED_UNLESS_MANUAL_KILL');
  }
  const payload = {
    rollback_version: STAGED_PATTERN_CANARY_EXPANSION_VERSION,
    state: 'STAGED_CANARY_ROLLED_BACK_CHAMPION_ONLY',
    rolled_back_at: rolledBackAt,
    reason: String(reason).trim(),
    actor: String(actor).trim(),
    rationale: String(rationale).trim(),
    staged_activation_fingerprint: activation.staged_activation_fingerprint,
    source_health_fingerprint: healthEvaluation?.staged_health_fingerprint ?? null,
    enforcement: { routing_fraction_after_rollback: 0, canary_probability_influence_after_rollback: 0, champion_only_required: true, same_activation_reactivation_allowed: false },
    governance: { canary_reactivation_allowed: false, new_governed_authorization_required_for_future_attempt: true, production_decision_weight: 0, capital_execution_allowed: false, real_money: 'NO' }
  };
  return deepFreeze({ ...payload, staged_rollback_fingerprint: sha256(payload) });
}

export function verifyStagedPatternCanaryRollbackRecord(r) {
  if (!r || r.rollback_version !== STAGED_PATTERN_CANARY_EXPANSION_VERSION) throw new Error('STEP12_ROLLBACK_VERSION_INVALID');
  fingerprintPayload(r, 'staged_rollback_fingerprint', 'STEP12_ROLLBACK_FINGERPRINT_INVALID');
  if (r.state !== 'STAGED_CANARY_ROLLED_BACK_CHAMPION_ONLY' || r.governance?.canary_reactivation_allowed !== false) throw new Error('STEP12_ROLLBACK_STATE_INVALID');
  if (r.enforcement?.routing_fraction_after_rollback !== 0 || r.enforcement?.canary_probability_influence_after_rollback !== 0) throw new Error('STEP12_ROLLBACK_ENFORCEMENT_INVALID');
  return true;
}
