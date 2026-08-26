import { createHash } from 'node:crypto';
import {
  ZERO_WEIGHT_CHALLENGER_PROMOTION_SAFETY_VERSION,
  verifyZeroWeightChallengerProductionSafetyReview,
  verifyZeroWeightChallengerPromotionAuthorization
} from './zero-weight-challenger-promotion-authorization-production-safety-review.mjs';

export const CONTROLLED_PRODUCTION_ACTIVATION_VERSION = 'CONTROLLED_PRODUCTION_ACTIVATION_EMERGENCY_ROLLBACK_V0_1';
export const MAX_INITIAL_PRODUCTION_DECISION_WEIGHT = 0.05;
export const MAX_ABSOLUTE_PROBABILITY_SHIFT = 0.02;
export const CONTROLLED_PRODUCTION_HEALTH_MIN_SETTLED_N = 30;
export const CONTROLLED_PRODUCTION_MAX_ECE_DEGRADATION = 0.01;

export const IMMEDIATE_EMERGENCY_ROLLBACK_SIGNALS = Object.freeze([
  'PROVENANCE_OR_FINGERPRINT_FAILURE',
  'POST_EVENT_START_LEAKAGE',
  'CALIBRATION_OR_LINEAGE_DRIFT',
  'OBSERVABILITY_OR_KILL_PATH_FAILURE',
  'DEPLOYMENT_REVERSIBILITY_FAILURE',
  'GATE6_CAPITAL_LOCK_VIOLATION',
  'MANUAL_KILL_SWITCH'
]);

const IMMEDIATE_SIGNAL_SET = new Set(IMMEDIATE_EMERGENCY_ROLLBACK_SIGNALS);
const EPS = 1e-15;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function parseTimestamp(name, value) {
  const ms = Date.parse(value);
  if (!value || Number.isNaN(ms)) throw new Error(`${name}_INVALID_TIMESTAMP`);
  return ms;
}

function fingerprintPayload(row, field, error) {
  const { [field]: fingerprint, ...payload } = row ?? {};
  if (!fingerprint || sha256(payload) !== fingerprint) throw new Error(error);
  return true;
}

function probability(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name}_INVALID_PROBABILITY`);
  }
  return value;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sameStringSet(a, b) {
  return stableStringify([...(a ?? [])].sort()) === stableStringify([...(b ?? [])].sort());
}

function verifyExactStep14Approval({ safetyReview, promotionAuthorization }) {
  verifyZeroWeightChallengerProductionSafetyReview(safetyReview);
  verifyZeroWeightChallengerPromotionAuthorization(promotionAuthorization);
  if (promotionAuthorization.authorization_version !== ZERO_WEIGHT_CHALLENGER_PROMOTION_SAFETY_VERSION) {
    throw new Error('STEP15_STEP14_AUTHORIZATION_VERSION_INVALID');
  }
  if (safetyReview.state !== 'ZERO_WEIGHT_CHALLENGER_PRODUCTION_SAFETY_REVIEW_PASS_NOT_ACTIVATED' ||
      safetyReview.eligible_for_manual_authorization !== true ||
      Object.values(safetyReview.safety_controls ?? {}).some(value => value !== true)) {
    throw new Error('STEP15_PASSING_STEP14_SAFETY_REVIEW_REQUIRED');
  }
  if (promotionAuthorization.decision !== 'APPROVE_FOR_CONTROLLED_PRODUCTION_ACTIVATION_NOT_ACTIVATED' ||
      promotionAuthorization.state !== 'ZERO_WEIGHT_CHALLENGER_APPROVED_FOR_CONTROLLED_PRODUCTION_ACTIVATION_NOT_ACTIVATED' ||
      promotionAuthorization.next_stage !== 'STEP_15_CONTROLLED_PRODUCTION_ACTIVATION_AND_EMERGENCY_ROLLBACK') {
    throw new Error('STEP15_EXACT_STEP14_APPROVAL_REQUIRED');
  }
  if (promotionAuthorization.source_production_safety_review_fingerprint !== safetyReview.production_safety_review_fingerprint) {
    throw new Error('STEP15_STEP14_SAFETY_REVIEW_AUTHORIZATION_MISMATCH');
  }
  if (promotionAuthorization.candidate?.decision_weight !== 0 ||
      promotionAuthorization.candidate?.production_activation_performed_here !== false ||
      promotionAuthorization.candidate?.nonzero_production_weight_authorized_here !== false ||
      promotionAuthorization.candidate?.champion_replacement_authorized_here !== false ||
      promotionAuthorization.candidate?.capital_use_authorized_here !== false ||
      promotionAuthorization.candidate?.archived !== false) {
    throw new Error('STEP15_STEP14_ZERO_WEIGHT_CANDIDATE_REQUIRED');
  }
  if (!sameStringSet(promotionAuthorization.candidate.approved_pattern_ids, safetyReview.candidate.approved_pattern_ids)) {
    throw new Error('STEP15_APPROVED_PATTERN_LINEAGE_MISMATCH');
  }
  if (promotionAuthorization.candidate.source_shadow_plan_fingerprint !== safetyReview.candidate.source_shadow_plan_fingerprint ||
      stableStringify(promotionAuthorization.candidate.calibration) !== stableStringify(safetyReview.candidate.calibration)) {
    throw new Error('STEP15_CANDIDATE_LINEAGE_MISMATCH');
  }
  if (promotionAuthorization.governance?.gate6_capital_lock_preserved !== true ||
      promotionAuthorization.governance?.capital_execution_allowed !== false ||
      promotionAuthorization.governance?.real_money !== 'NO') {
    throw new Error('STEP15_GATE6_CAPITAL_LOCK_REQUIRED');
  }
  return true;
}

export function activateControlledProductionChallenger({
  safetyReview,
  promotionAuthorization,
  decisionWeight,
  activatedBy,
  activatedAt,
  deploymentReference,
  killSwitchReference
}) {
  verifyExactStep14Approval({ safetyReview, promotionAuthorization });
  if (typeof decisionWeight !== 'number' || !Number.isFinite(decisionWeight) || decisionWeight <= 0 || decisionWeight > MAX_INITIAL_PRODUCTION_DECISION_WEIGHT) {
    throw new Error('STEP15_INITIAL_PRODUCTION_DECISION_WEIGHT_OUT_OF_RANGE');
  }
  if (!activatedBy || !String(activatedBy).trim()) throw new Error('STEP15_ACTIVATED_BY_REQUIRED');
  if (!deploymentReference || !String(deploymentReference).trim()) throw new Error('STEP15_DEPLOYMENT_REFERENCE_REQUIRED');
  if (!killSwitchReference || !String(killSwitchReference).trim()) throw new Error('STEP15_KILL_SWITCH_REFERENCE_REQUIRED');
  const activatedMs = parseTimestamp('STEP15_ACTIVATED_AT', activatedAt);
  if (activatedMs <= parseTimestamp('STEP15_STEP14_DECIDED_AT', promotionAuthorization.decided_at)) {
    throw new Error('STEP15_ACTIVATION_MUST_FOLLOW_STEP14_AUTHORIZATION');
  }

  const payload = {
    activation_version: CONTROLLED_PRODUCTION_ACTIVATION_VERSION,
    state: 'CONTROLLED_PRODUCTION_ACTIVATION_ACTIVE_CAPITAL_LOCKED',
    activated_at: activatedAt,
    activated_by: String(activatedBy).trim(),
    source_step14_safety_review_fingerprint: safetyReview.production_safety_review_fingerprint,
    source_step14_promotion_authorization_fingerprint: promotionAuthorization.promotion_authorization_fingerprint,
    source_graduation_dossier_fingerprint: promotionAuthorization.source_graduation_dossier_fingerprint,
    source_graduation_decision_fingerprint: promotionAuthorization.source_graduation_decision_fingerprint,
    candidate: {
      approved_pattern_ids: [...(promotionAuthorization.candidate.approved_pattern_ids ?? [])].sort(),
      source_shadow_plan_fingerprint: promotionAuthorization.candidate.source_shadow_plan_fingerprint,
      calibration: promotionAuthorization.candidate.calibration
    },
    production: {
      decision_weight: decisionWeight,
      maximum_initial_decision_weight: MAX_INITIAL_PRODUCTION_DECISION_WEIGHT,
      maximum_absolute_probability_shift: MAX_ABSOLUTE_PROBABILITY_SHIFT,
      mutation_method: 'WEIGHTED_CHALLENGER_DELTA_WITH_ABSOLUTE_CAP',
      champion_remains_primary_fallback: true,
      champion_replacement_authorized: false,
      capital_execution_allowed: false
    },
    deployment: {
      deployment_reference: String(deploymentReference).trim(),
      reversible: true
    },
    emergency_rollback: {
      kill_switch_armed: true,
      kill_switch_reference: String(killSwitchReference).trim(),
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
  return deepFreeze({ ...payload, controlled_production_activation_fingerprint: sha256(payload) });
}

export function verifyControlledProductionActivation(activation) {
  if (!activation || activation.activation_version !== CONTROLLED_PRODUCTION_ACTIVATION_VERSION) throw new Error('STEP15_ACTIVATION_VERSION_INVALID');
  fingerprintPayload(activation, 'controlled_production_activation_fingerprint', 'STEP15_ACTIVATION_FINGERPRINT_INVALID');
  if (activation.state !== 'CONTROLLED_PRODUCTION_ACTIVATION_ACTIVE_CAPITAL_LOCKED') throw new Error('STEP15_ACTIVATION_STATE_INVALID');
  if (activation.production?.decision_weight <= 0 || activation.production?.decision_weight > MAX_INITIAL_PRODUCTION_DECISION_WEIGHT ||
      activation.production?.maximum_absolute_probability_shift !== MAX_ABSOLUTE_PROBABILITY_SHIFT ||
      activation.production?.champion_remains_primary_fallback !== true ||
      activation.production?.champion_replacement_authorized !== false || activation.production?.capital_execution_allowed !== false) {
    throw new Error('STEP15_ACTIVATION_PRODUCTION_BOUNDARY_INVALID');
  }
  if (activation.emergency_rollback?.kill_switch_armed !== true || activation.emergency_rollback?.rollback_target !== 'CHAMPION_ONLY') {
    throw new Error('STEP15_KILL_SWITCH_NOT_ARMED');
  }
  if (activation.governance?.production_prediction_mutation_allowed !== true ||
      activation.governance?.automatic_weight_ramp !== false || activation.governance?.automatic_retuning !== false ||
      activation.governance?.champion_replacement_authorized !== false || activation.governance?.capital_execution_allowed !== false ||
      activation.governance?.gate6_capital_lock_preserved !== true || activation.governance?.real_money !== 'NO') {
    throw new Error('STEP15_ACTIVATION_GOVERNANCE_INVALID');
  }
  return true;
}

export function applyControlledProductionChallenger({
  activation,
  matchId,
  marketKey,
  selection,
  championProbability,
  challengerProbability,
  generatedAt,
  eventStartAt,
  rollbackRecord = null
}) {
  verifyControlledProductionActivation(activation);
  if (!matchId || !marketKey || !selection) throw new Error('STEP15_DECISION_IDENTITY_REQUIRED');
  const generatedMs = parseTimestamp('STEP15_GENERATED_AT', generatedAt);
  const startMs = parseTimestamp('STEP15_EVENT_START_AT', eventStartAt);
  if (generatedMs < parseTimestamp('STEP15_ACTIVATED_AT', activation.activated_at)) throw new Error('STEP15_RETROACTIVE_PRODUCTION_DECISION_FORBIDDEN');
  if (generatedMs >= startMs) throw new Error('STEP15_POST_EVENT_START_PRODUCTION_MUTATION_FORBIDDEN');
  const champion = probability('STEP15_CHAMPION', championProbability);
  const challenger = probability('STEP15_CHALLENGER', challengerProbability);

  if (rollbackRecord) {
    verifyControlledProductionEmergencyRollback(rollbackRecord);
    if (rollbackRecord.source_activation_fingerprint !== activation.controlled_production_activation_fingerprint) {
      throw new Error('STEP15_ROLLBACK_ACTIVATION_MISMATCH');
    }
    const payload = {
      decision_version: CONTROLLED_PRODUCTION_ACTIVATION_VERSION,
      state: 'CONTROLLED_PRODUCTION_ROLLED_BACK_CHAMPION_ONLY',
      match_id: String(matchId), market_key: String(marketKey), selection: String(selection),
      generated_at: generatedAt, event_start_at: eventStartAt,
      source_activation_fingerprint: activation.controlled_production_activation_fingerprint,
      champion_probability: champion, challenger_probability: challenger,
      decision_weight: 0, applied_probability_shift: 0, production_probability: champion,
      rollback_fingerprint: rollbackRecord.emergency_rollback_fingerprint,
      capital_execution_allowed: false, real_money: 'NO'
    };
    return deepFreeze({ ...payload, controlled_production_decision_fingerprint: sha256(payload) });
  }

  const rawDelta = challenger - champion;
  const weightedDelta = rawDelta * activation.production.decision_weight;
  const appliedDelta = clamp(weightedDelta, -MAX_ABSOLUTE_PROBABILITY_SHIFT, MAX_ABSOLUTE_PROBABILITY_SHIFT);
  const productionProbability = clamp(champion + appliedDelta, 0, 1);
  const payload = {
    decision_version: CONTROLLED_PRODUCTION_ACTIVATION_VERSION,
    state: 'CONTROLLED_PRODUCTION_CHALLENGER_INFLUENCE_APPLIED_CAPITAL_LOCKED',
    match_id: String(matchId), market_key: String(marketKey), selection: String(selection),
    generated_at: generatedAt, event_start_at: eventStartAt,
    source_activation_fingerprint: activation.controlled_production_activation_fingerprint,
    champion_probability: champion, challenger_probability: challenger,
    decision_weight: activation.production.decision_weight,
    raw_probability_delta: rawDelta,
    weighted_probability_delta: weightedDelta,
    applied_probability_shift: appliedDelta,
    production_probability: productionProbability,
    maximum_absolute_probability_shift: MAX_ABSOLUTE_PROBABILITY_SHIFT,
    rollback_fingerprint: null,
    capital_execution_allowed: false,
    real_money: 'NO'
  };
  return deepFreeze({ ...payload, controlled_production_decision_fingerprint: sha256(payload) });
}

export function verifyControlledProductionDecision(decision) {
  if (!decision || decision.decision_version !== CONTROLLED_PRODUCTION_ACTIVATION_VERSION) throw new Error('STEP15_DECISION_VERSION_INVALID');
  fingerprintPayload(decision, 'controlled_production_decision_fingerprint', 'STEP15_DECISION_FINGERPRINT_INVALID');
  probability('STEP15_DECISION_CHAMPION', decision.champion_probability);
  probability('STEP15_DECISION_CHALLENGER', decision.challenger_probability);
  probability('STEP15_DECISION_PRODUCTION', decision.production_probability);
  if (decision.capital_execution_allowed !== false || decision.real_money !== 'NO') throw new Error('STEP15_DECISION_CAPITAL_BOUNDARY_INVALID');
  if (Math.abs(decision.applied_probability_shift) > MAX_ABSOLUTE_PROBABILITY_SHIFT + 1e-12) throw new Error('STEP15_DECISION_PROBABILITY_SHIFT_CAP_EXCEEDED');
  if (decision.state === 'CONTROLLED_PRODUCTION_ROLLED_BACK_CHAMPION_ONLY') {
    if (!decision.rollback_fingerprint || decision.decision_weight !== 0 || decision.applied_probability_shift !== 0 ||
        Math.abs(decision.production_probability - decision.champion_probability) > 1e-12) throw new Error('STEP15_ROLLED_BACK_DECISION_INVALID');
  } else if (decision.state === 'CONTROLLED_PRODUCTION_CHALLENGER_INFLUENCE_APPLIED_CAPITAL_LOCKED') {
    if (decision.rollback_fingerprint !== null || decision.decision_weight <= 0 || decision.decision_weight > MAX_INITIAL_PRODUCTION_DECISION_WEIGHT) {
      throw new Error('STEP15_ACTIVE_DECISION_WEIGHT_INVALID');
    }
    const expected = clamp(decision.champion_probability + decision.applied_probability_shift, 0, 1);
    if (Math.abs(expected - decision.production_probability) > 1e-12) throw new Error('STEP15_DECISION_PROBABILITY_REPRODUCTION_FAILED');
  } else throw new Error('STEP15_DECISION_STATE_INVALID');
  return true;
}

export function settleControlledProductionDecision({ decision, outcome, settledAt }) {
  verifyControlledProductionDecision(decision);
  if (outcome !== 0 && outcome !== 1) throw new Error('STEP15_BINARY_OUTCOME_REQUIRED');
  const settledMs = parseTimestamp('STEP15_SETTLED_AT', settledAt);
  if (settledMs <= parseTimestamp('STEP15_EVENT_START_AT', decision.event_start_at)) throw new Error('STEP15_SETTLEMENT_MUST_FOLLOW_EVENT_START');
  const payload = {
    settlement_version: CONTROLLED_PRODUCTION_ACTIVATION_VERSION,
    state: 'CONTROLLED_PRODUCTION_DECISION_SETTLED',
    settled_at: settledAt,
    source_activation_fingerprint: decision.source_activation_fingerprint,
    source_decision_fingerprint: decision.controlled_production_decision_fingerprint,
    match_id: decision.match_id, market_key: decision.market_key, selection: decision.selection,
    champion_probability: decision.champion_probability,
    production_probability: decision.production_probability,
    outcome,
    capital_execution_allowed: false,
    real_money: 'NO'
  };
  return deepFreeze({ ...payload, controlled_production_settlement_fingerprint: sha256(payload) });
}

export function verifyControlledProductionSettlement(settlement) {
  if (!settlement || settlement.settlement_version !== CONTROLLED_PRODUCTION_ACTIVATION_VERSION) throw new Error('STEP15_SETTLEMENT_VERSION_INVALID');
  fingerprintPayload(settlement, 'controlled_production_settlement_fingerprint', 'STEP15_SETTLEMENT_FINGERPRINT_INVALID');
  probability('STEP15_SETTLEMENT_CHAMPION', settlement.champion_probability);
  probability('STEP15_SETTLEMENT_PRODUCTION', settlement.production_probability);
  if (settlement.outcome !== 0 && settlement.outcome !== 1) throw new Error('STEP15_SETTLEMENT_OUTCOME_INVALID');
  if (settlement.capital_execution_allowed !== false || settlement.real_money !== 'NO') throw new Error('STEP15_SETTLEMENT_CAPITAL_BOUNDARY_INVALID');
  return true;
}

function metrics(rows, field) {
  if (!rows.length) return { n: 0, brier: null, log_loss: null, ece: null };
  let brier = 0, logLoss = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const row of rows) {
    const p = probability('STEP15_METRIC_PROBABILITY', row[field]);
    const y = row.outcome;
    brier += (p - y) ** 2;
    const q = clamp(p, EPS, 1 - EPS);
    logLoss += -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
    const index = Math.min(9, Math.floor(p * 10));
    bins[index].n += 1; bins[index].p += p; bins[index].y += y;
  }
  let ece = 0;
  for (const bin of bins) if (bin.n) ece += (bin.n / rows.length) * Math.abs(bin.p / bin.n - bin.y / bin.n);
  return { n: rows.length, brier: brier / rows.length, log_loss: logLoss / rows.length, ece };
}

export function evaluateControlledProductionHealth({ activation, settlements, evaluatedAt, integritySignals = [] }) {
  verifyControlledProductionActivation(activation);
  parseTimestamp('STEP15_HEALTH_EVALUATED_AT', evaluatedAt);
  if (!Array.isArray(settlements)) throw new Error('STEP15_SETTLEMENT_ARRAY_REQUIRED');
  const seen = new Set();
  for (const settlement of settlements) {
    verifyControlledProductionSettlement(settlement);
    if (settlement.source_activation_fingerprint !== activation.controlled_production_activation_fingerprint) throw new Error('STEP15_HEALTH_SETTLEMENT_ACTIVATION_MISMATCH');
    const key = `${settlement.match_id}|${settlement.market_key}|${settlement.selection}`;
    if (seen.has(key)) throw new Error('STEP15_HEALTH_DUPLICATE_MATCH_MARKET_SELECTION');
    seen.add(key);
  }
  const signals = [...new Set(integritySignals)];
  for (const signal of signals) if (!IMMEDIATE_SIGNAL_SET.has(signal)) throw new Error(`STEP15_UNKNOWN_INTEGRITY_SIGNAL:${signal}`);
  const champion = metrics(settlements, 'champion_probability');
  const production = metrics(settlements, 'production_probability');
  const minNPassed = settlements.length >= CONTROLLED_PRODUCTION_HEALTH_MIN_SETTLED_N;
  const brierPassed = minNPassed && production.brier <= champion.brier + 1e-12;
  const logLossPassed = minNPassed && production.log_loss <= champion.log_loss + 1e-12;
  const ecePassed = minNPassed && production.ece <= champion.ece + CONTROLLED_PRODUCTION_MAX_ECE_DEGRADATION + 1e-12;
  const immediateRollback = signals.length > 0;
  const performanceRollback = minNPassed && !(brierPassed && logLossPassed && ecePassed);
  const rollbackRequired = immediateRollback || performanceRollback;
  let state;
  if (rollbackRequired) state = 'CONTROLLED_PRODUCTION_ROLLBACK_TO_CHAMPION_REQUIRED';
  else if (!minNPassed) state = 'CONTROLLED_PRODUCTION_HEALTH_ACCUMULATING_CAPITAL_LOCKED';
  else state = 'CONTROLLED_PRODUCTION_HEALTHY_CONTINUE_BOUNDED_CAPITAL_LOCKED';
  const payload = {
    health_version: CONTROLLED_PRODUCTION_ACTIVATION_VERSION,
    state,
    evaluated_at: evaluatedAt,
    source_activation_fingerprint: activation.controlled_production_activation_fingerprint,
    settled_n: settlements.length,
    champion,
    production,
    integrity_signals: signals.sort(),
    gates: {
      minimum_settled_n_passed: minNPassed,
      brier_non_degradation_passed: brierPassed,
      log_loss_non_degradation_passed: logLossPassed,
      ece_degradation_cap_passed: ecePassed
    },
    rollback_required: rollbackRequired,
    governance: {
      automatic_weight_increase: false,
      champion_replacement_authorized: false,
      capital_execution_allowed: false,
      additional_alpha_spent: false,
      gate6_capital_lock_preserved: true,
      real_money: 'NO'
    },
    next_stage: state === 'CONTROLLED_PRODUCTION_HEALTHY_CONTINUE_BOUNDED_CAPITAL_LOCKED'
      ? 'STEP_16_CONTROLLED_PRODUCTION_EVIDENCE_REVIEW_AND_WEIGHT_GOVERNANCE'
      : null
  };
  return deepFreeze({ ...payload, controlled_production_health_fingerprint: sha256(payload) });
}

export function verifyControlledProductionHealth(health) {
  if (!health || health.health_version !== CONTROLLED_PRODUCTION_ACTIVATION_VERSION) throw new Error('STEP15_HEALTH_VERSION_INVALID');
  fingerprintPayload(health, 'controlled_production_health_fingerprint', 'STEP15_HEALTH_FINGERPRINT_INVALID');
  if (![
    'CONTROLLED_PRODUCTION_HEALTH_ACCUMULATING_CAPITAL_LOCKED',
    'CONTROLLED_PRODUCTION_HEALTHY_CONTINUE_BOUNDED_CAPITAL_LOCKED',
    'CONTROLLED_PRODUCTION_ROLLBACK_TO_CHAMPION_REQUIRED'
  ].includes(health.state)) throw new Error('STEP15_HEALTH_STATE_INVALID');
  if (health.governance?.automatic_weight_increase !== false || health.governance?.champion_replacement_authorized !== false ||
      health.governance?.capital_execution_allowed !== false || health.governance?.real_money !== 'NO') throw new Error('STEP15_HEALTH_GOVERNANCE_INVALID');
  if ((health.state === 'CONTROLLED_PRODUCTION_ROLLBACK_TO_CHAMPION_REQUIRED') !== (health.rollback_required === true)) {
    throw new Error('STEP15_HEALTH_ROLLBACK_STATE_MISMATCH');
  }
  return true;
}

export function recordControlledProductionEmergencyRollback({ activation, reason, actor, rationale, rolledBackAt, healthEvaluation = null }) {
  verifyControlledProductionActivation(activation);
  if (!IMMEDIATE_SIGNAL_SET.has(reason) && reason !== 'PERFORMANCE_DEGRADATION_AFTER_MINIMUM_N') throw new Error('STEP15_ROLLBACK_REASON_INVALID');
  if (!actor || !String(actor).trim()) throw new Error('STEP15_ROLLBACK_ACTOR_REQUIRED');
  if (!rationale || !String(rationale).trim()) throw new Error('STEP15_ROLLBACK_RATIONALE_REQUIRED');
  if (parseTimestamp('STEP15_ROLLED_BACK_AT', rolledBackAt) <= parseTimestamp('STEP15_ACTIVATED_AT', activation.activated_at)) {
    throw new Error('STEP15_ROLLBACK_MUST_FOLLOW_ACTIVATION');
  }
  if (reason === 'PERFORMANCE_DEGRADATION_AFTER_MINIMUM_N') {
    verifyControlledProductionHealth(healthEvaluation);
    if (healthEvaluation.source_activation_fingerprint !== activation.controlled_production_activation_fingerprint ||
        healthEvaluation.state !== 'CONTROLLED_PRODUCTION_ROLLBACK_TO_CHAMPION_REQUIRED' ||
        healthEvaluation.gates?.minimum_settled_n_passed !== true) {
      throw new Error('STEP15_PERFORMANCE_ROLLBACK_REQUIRES_FAILED_MIN_N_HEALTH');
    }
  }
  const payload = {
    rollback_version: CONTROLLED_PRODUCTION_ACTIVATION_VERSION,
    state: 'CONTROLLED_PRODUCTION_EMERGENCY_ROLLED_BACK_CHAMPION_ONLY',
    rolled_back_at: rolledBackAt,
    actor: String(actor).trim(),
    reason,
    rationale: String(rationale).trim(),
    source_activation_fingerprint: activation.controlled_production_activation_fingerprint,
    source_health_fingerprint: healthEvaluation?.controlled_production_health_fingerprint ?? null,
    enforcement: {
      rollback_target: 'CHAMPION_ONLY',
      production_decision_weight: 0,
      probability_influence: 0,
      same_activation_reactivation_allowed: false,
      new_governed_authorization_required_for_future_attempt: true
    },
    governance: {
      champion_replacement_authorized: false,
      capital_execution_allowed: false,
      gate6_capital_lock_preserved: true,
      capital_effect: 'NONE',
      real_money: 'NO'
    }
  };
  return deepFreeze({ ...payload, emergency_rollback_fingerprint: sha256(payload) });
}

export function verifyControlledProductionEmergencyRollback(rollback) {
  if (!rollback || rollback.rollback_version !== CONTROLLED_PRODUCTION_ACTIVATION_VERSION) throw new Error('STEP15_ROLLBACK_VERSION_INVALID');
  fingerprintPayload(rollback, 'emergency_rollback_fingerprint', 'STEP15_ROLLBACK_FINGERPRINT_INVALID');
  if (rollback.state !== 'CONTROLLED_PRODUCTION_EMERGENCY_ROLLED_BACK_CHAMPION_ONLY' ||
      rollback.enforcement?.rollback_target !== 'CHAMPION_ONLY' || rollback.enforcement?.production_decision_weight !== 0 ||
      rollback.enforcement?.probability_influence !== 0 || rollback.enforcement?.same_activation_reactivation_allowed !== false ||
      rollback.governance?.capital_execution_allowed !== false || rollback.governance?.real_money !== 'NO') {
    throw new Error('STEP15_ROLLBACK_BOUNDARY_INVALID');
  }
  return true;
}
