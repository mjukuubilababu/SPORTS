import { createHash } from 'node:crypto';
import {
  PATTERN_PROMOTION_SHADOW_VERSION,
  verifyPatternShadowPlan
} from './pattern-promotion-shadow-integration.mjs';
import {
  PATTERN_SHADOW_FORWARD_APPROVAL_VERSION,
  verifyPatternPromotionApproval,
  verifyPatternPromotionDossier
} from './pattern-shadow-forward-monitoring-promotion-approval.mjs';

export const CONTROLLED_PATTERN_CANARY_VERSION = 'CONTROLLED_PATTERN_CANARY_ACTIVATION_ROLLBACK_V0_1';
export const CANARY_MAX_ROUTING_FRACTION = 0.05;
export const CANARY_MAX_ABS_PROBABILITY_SHIFT = 0.02;
export const CANARY_HEALTH_MIN_SETTLED_N = 30;
export const CANARY_MAX_ECE_DEGRADATION = 0.01;

const IMMEDIATE_ROLLBACK_SIGNALS = Object.freeze(new Set([
  'PROVENANCE_OR_FINGERPRINT_FAILURE',
  'POST_KICKOFF_LEAKAGE',
  'LINEAGE_OR_CALIBRATION_DRIFT',
  'MANUAL_KILL_SWITCH'
]));

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function keyOf(row) {
  return `${row.match_id}|${row.market_key}|${row.selection}`;
}

function fingerprintPayload(row, field, error) {
  const { [field]: fingerprint, ...payload } = row ?? {};
  if (!fingerprint || sha256(payload) !== fingerprint) throw new Error(error);
  return true;
}

function verifyStep8ShadowPrediction(row) {
  fingerprintPayload(row, 'shadow_prediction_fingerprint', 'STEP10_SHADOW_PREDICTION_FINGERPRINT_INVALID');
  if (row.shadow_version !== PATTERN_PROMOTION_SHADOW_VERSION) throw new Error('STEP10_SHADOW_PREDICTION_VERSION_INVALID');
  if (row.governance?.shadow_only !== true || row.governance?.production_decision_affected !== false) {
    throw new Error('STEP10_SHADOW_PREDICTION_GOVERNANCE_INVALID');
  }
  return true;
}

function verifyStep8Settlement(row) {
  fingerprintPayload(row, 'settlement_fingerprint', 'STEP10_STEP8_SETTLEMENT_FINGERPRINT_INVALID');
  if (row.settlement_version !== PATTERN_PROMOTION_SHADOW_VERSION) throw new Error('STEP10_STEP8_SETTLEMENT_VERSION_INVALID');
  if (row.governance?.shadow_only !== true || row.governance?.decision_weight !== 0 || row.governance?.settlement_rewrites_prediction !== false) {
    throw new Error('STEP10_STEP8_SETTLEMENT_GOVERNANCE_INVALID');
  }
  return true;
}

function sorted(values) {
  return [...values].sort();
}

function verifyApprovedStep8Lineage({ dossier, shadowPlan, step8ShadowPredictions, step8Settlements }) {
  verifyPatternPromotionDossier(dossier);
  verifyPatternShadowPlan(shadowPlan);
  if (shadowPlan.state !== 'SHADOW_PLAN_READY_ZERO_WEIGHT') throw new Error('STEP10_READY_SHADOW_PLAN_REQUIRED');
  if (!Array.isArray(step8ShadowPredictions) || !Array.isArray(step8Settlements)) throw new Error('STEP10_EXACT_STEP8_LINEAGE_ARRAYS_REQUIRED');
  if (step8ShadowPredictions.length !== step8Settlements.length || step8Settlements.length !== dossier.source_step8_settled_n) {
    throw new Error('STEP10_EXACT_STEP8_LINEAGE_COHORT_REQUIRED');
  }
  const dossierSettlementFingerprints = sorted(dossier.source_step8_settlement_fingerprints ?? []);
  const suppliedSettlementFingerprints = sorted(step8Settlements.map(row => row.settlement_fingerprint));
  if (stableStringify(dossierSettlementFingerprints) !== stableStringify(suppliedSettlementFingerprints)) {
    throw new Error('STEP10_STEP8_DOSSIER_SETTLEMENT_COHORT_MISMATCH');
  }
  const predictionsByFingerprint = new Map();
  for (const prediction of step8ShadowPredictions) {
    verifyStep8ShadowPrediction(prediction);
    if (prediction.source_shadow_plan_fingerprint !== shadowPlan.shadow_plan_fingerprint) {
      throw new Error('STEP10_SHADOW_PLAN_LINEAGE_DRIFT');
    }
    if (predictionsByFingerprint.has(prediction.shadow_prediction_fingerprint)) throw new Error('STEP10_DUPLICATE_STEP8_SHADOW_PREDICTION');
    predictionsByFingerprint.set(prediction.shadow_prediction_fingerprint, prediction);
  }
  const seenKeys = new Set();
  for (const settlement of step8Settlements) {
    verifyStep8Settlement(settlement);
    const prediction = predictionsByFingerprint.get(settlement.source_shadow_prediction_fingerprint);
    if (!prediction) throw new Error('STEP10_STEP8_SETTLEMENT_PREDICTION_LINEAGE_MISSING');
    if (keyOf(prediction) !== keyOf(settlement)) throw new Error('STEP10_STEP8_MATCH_MARKET_SELECTION_LINEAGE_MISMATCH');
    const key = keyOf(settlement);
    if (seenKeys.has(key)) throw new Error('STEP10_DUPLICATE_STEP8_MATCH_MARKET_SELECTION');
    seenKeys.add(key);
  }
  return true;
}

function routingUnit(seed, key) {
  const hex = createHash('sha256').update(`${seed}|${key}`).digest('hex').slice(0, 13);
  return Number.parseInt(hex, 16) / 0x10000000000000;
}

export function createControlledPatternCanaryAuthorization({
  approval,
  dossier,
  shadowPlan,
  step8ShadowPredictions,
  step8Settlements,
  activatedAt,
  activator,
  rationale,
  channel = 'PAPER',
  requestedRoutingFraction = CANARY_MAX_ROUTING_FRACTION,
  requestedMaxAbsProbabilityShift = CANARY_MAX_ABS_PROBABILITY_SHIFT
}) {
  verifyPatternPromotionApproval(approval);
  if (approval.state !== 'CONTROLLED_CANARY_APPROVED_NOT_ACTIVATED_ZERO_WEIGHT' || approval.decision !== 'APPROVE_CONTROLLED_CANARY') {
    throw new Error('STEP10_STEP9_CONTROLLED_CANARY_APPROVAL_REQUIRED');
  }
  verifyPatternPromotionDossier(dossier);
  if (approval.dossier_fingerprint !== dossier.dossier_fingerprint) throw new Error('STEP10_APPROVAL_DOSSIER_MISMATCH');
  verifyApprovedStep8Lineage({ dossier, shadowPlan, step8ShadowPredictions, step8Settlements });
  if (!['PAPER', 'RESEARCH'].includes(channel)) throw new Error('STEP10_CANARY_CHANNEL_MUST_BE_PAPER_OR_RESEARCH');
  if (!(requestedRoutingFraction > 0 && requestedRoutingFraction <= CANARY_MAX_ROUTING_FRACTION)) throw new Error('STEP10_CANARY_ROUTING_FRACTION_OUT_OF_BOUNDS');
  if (!(requestedMaxAbsProbabilityShift > 0 && requestedMaxAbsProbabilityShift <= CANARY_MAX_ABS_PROBABILITY_SHIFT)) throw new Error('STEP10_CANARY_PROBABILITY_SHIFT_OUT_OF_BOUNDS');
  if (!activator || !String(activator).trim()) throw new Error('STEP10_ACTIVATOR_REQUIRED');
  if (!rationale || !String(rationale).trim()) throw new Error('STEP10_ACTIVATION_RATIONALE_REQUIRED');
  const activatedMs = parseTimestamp('STEP10_ACTIVATED_AT', activatedAt);
  if (activatedMs <= parseTimestamp('STEP10_STEP9_APPROVED_AT', approval.decided_at)) throw new Error('STEP10_ACTIVATION_MUST_FOLLOW_STEP9_APPROVAL');
  const routingSeed = sha256({ approval_fingerprint: approval.approval_fingerprint, shadow_plan_fingerprint: shadowPlan.shadow_plan_fingerprint });
  const payload = {
    authorization_version: CONTROLLED_PATTERN_CANARY_VERSION,
    state: 'CONTROLLED_PATTERN_CANARY_ACTIVE_PAPER_ONLY',
    activated_at: activatedAt,
    activator: String(activator).trim(),
    rationale: String(rationale).trim(),
    channel,
    source_step9_approval_fingerprint: approval.approval_fingerprint,
    source_dossier_fingerprint: dossier.dossier_fingerprint,
    source_shadow_plan_fingerprint: shadowPlan.shadow_plan_fingerprint,
    approved_pattern_ids: sorted(shadowPlan.validated_pattern_ids ?? []),
    calibration_version: shadowPlan.calibration?.version ?? null,
    calibration_provenance: shadowPlan.calibration?.provenance ?? null,
    routing: {
      method: 'DETERMINISTIC_SHA256_MATCH_MARKET_SELECTION',
      seed: routingSeed,
      maximum_fraction: CANARY_MAX_ROUTING_FRACTION,
      active_fraction: requestedRoutingFraction,
      cherry_pick_allowed: false
    },
    influence: {
      source: 'STEP8_SHADOW_MINUS_CHAMPION_DELTA',
      maximum_absolute_probability_shift: requestedMaxAbsProbabilityShift,
      maximum_contract_limit: CANARY_MAX_ABS_PROBABILITY_SHIFT,
      champion_probability_mutated_in_place: false
    },
    kill_switch: {
      state: 'ARMED',
      immediate_signals: sorted(IMMEDIATE_ROLLBACK_SIGNALS),
      champion_fallback_required: true
    },
    health_policy: {
      minimum_routed_settled_n: CANARY_HEALTH_MIN_SETTLED_N,
      brier_non_degradation_required: true,
      log_loss_non_degradation_required: true,
      maximum_ece_degradation: CANARY_MAX_ECE_DEGRADATION
    },
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
  return deepFreeze({ ...payload, canary_authorization_fingerprint: sha256(payload) });
}

export function verifyControlledPatternCanaryAuthorization(authorization) {
  if (!authorization || authorization.authorization_version !== CONTROLLED_PATTERN_CANARY_VERSION) throw new Error('STEP10_CANARY_AUTHORIZATION_VERSION_INVALID');
  fingerprintPayload(authorization, 'canary_authorization_fingerprint', 'STEP10_CANARY_AUTHORIZATION_FINGERPRINT_INVALID');
  if (authorization.state !== 'CONTROLLED_PATTERN_CANARY_ACTIVE_PAPER_ONLY') throw new Error('STEP10_CANARY_AUTHORIZATION_STATE_INVALID');
  if (authorization.governance?.production_decision_weight !== 0 || authorization.governance?.production_mutation_allowed !== false || authorization.governance?.capital_execution_allowed !== false || authorization.governance?.real_money !== 'NO') {
    throw new Error('STEP10_CANARY_AUTHORIZATION_GOVERNANCE_INVALID');
  }
  if (authorization.routing?.active_fraction > CANARY_MAX_ROUTING_FRACTION || authorization.influence?.maximum_absolute_probability_shift > CANARY_MAX_ABS_PROBABILITY_SHIFT) {
    throw new Error('STEP10_CANARY_AUTHORIZATION_CAP_BREACH');
  }
  return true;
}

export function verifyPatternCanaryRollbackRecord(record) {
  if (!record || record.rollback_version !== CONTROLLED_PATTERN_CANARY_VERSION) throw new Error('STEP10_ROLLBACK_VERSION_INVALID');
  fingerprintPayload(record, 'rollback_fingerprint', 'STEP10_ROLLBACK_FINGERPRINT_INVALID');
  if (record.state !== 'CANARY_ROLLED_BACK_CHAMPION_ONLY' || record.governance?.canary_reactivation_allowed !== false) throw new Error('STEP10_ROLLBACK_STATE_INVALID');
  return true;
}

export function routeControlledPatternCanary({ authorization, shadowPrediction, routedAt, rollbackRecord = null }) {
  verifyControlledPatternCanaryAuthorization(authorization);
  verifyStep8ShadowPrediction(shadowPrediction);
  if (shadowPrediction.source_shadow_plan_fingerprint !== authorization.source_shadow_plan_fingerprint) throw new Error('STEP10_CANARY_SHADOW_PLAN_LINEAGE_DRIFT');
  const routedMs = parseTimestamp('STEP10_ROUTED_AT', routedAt);
  const generatedMs = parseTimestamp('STEP10_SHADOW_GENERATED_AT', shadowPrediction.generated_at);
  const kickoffMs = parseTimestamp('STEP10_KICKOFF_AT', shadowPrediction.kickoff_at);
  if (generatedMs >= kickoffMs || routedMs >= kickoffMs) throw new Error('STEP10_POST_KICKOFF_CANARY_ROUTING_FORBIDDEN');
  if (routedMs < generatedMs) throw new Error('STEP10_ROUTING_CANNOT_PREDATE_SHADOW_PREDICTION');
  if (rollbackRecord !== null) {
    verifyPatternCanaryRollbackRecord(rollbackRecord);
    if (rollbackRecord.canary_authorization_fingerprint !== authorization.canary_authorization_fingerprint) throw new Error('STEP10_ROLLBACK_AUTHORIZATION_MISMATCH');
  }
  const key = keyOf(shadowPrediction);
  const routeValue = routingUnit(authorization.routing.seed, key);
  const selected = rollbackRecord === null && routeValue < authorization.routing.active_fraction;
  const baselineProbability = shadowPrediction.baseline.probability;
  const rawDelta = shadowPrediction.shadow.probability - baselineProbability;
  const boundedDelta = selected ? clamp(rawDelta, -authorization.influence.maximum_absolute_probability_shift, authorization.influence.maximum_absolute_probability_shift) : 0;
  const canaryProbability = clamp(baselineProbability + boundedDelta, 1e-9, 1 - 1e-9);
  const payload = {
    decision_version: CONTROLLED_PATTERN_CANARY_VERSION,
    state: rollbackRecord !== null ? 'CHAMPION_FALLBACK_CANARY_ROLLED_BACK' : selected ? 'CANARY_APPLIED_PAPER_ONLY' : 'CHAMPION_FALLBACK_NOT_ROUTED',
    routed_at: routedAt,
    match_id: shadowPrediction.match_id,
    market_key: shadowPrediction.market_key,
    selection: shadowPrediction.selection,
    kickoff_at: shadowPrediction.kickoff_at,
    source_canary_authorization_fingerprint: authorization.canary_authorization_fingerprint,
    source_shadow_prediction_fingerprint: shadowPrediction.shadow_prediction_fingerprint,
    source_shadow_plan_fingerprint: shadowPrediction.source_shadow_plan_fingerprint,
    routing: { value: routeValue, threshold: authorization.routing.active_fraction, selected },
    champion: { probability: baselineProbability, model_version: shadowPrediction.baseline.model_version },
    canary: {
      source_shadow_probability: shadowPrediction.shadow.probability,
      raw_probability_delta: rawDelta,
      bounded_probability_delta: boundedDelta,
      probability: canaryProbability,
      applied: selected
    },
    governance: {
      paper_or_research_only: true,
      production_decision_weight: 0,
      production_mutation_allowed: false,
      capital_execution_allowed: false,
      champion_fallback_available: true,
      rollback_enforced: rollbackRecord !== null,
      real_money: 'NO'
    }
  };
  return deepFreeze({ ...payload, canary_decision_fingerprint: sha256(payload) });
}

export function verifyControlledPatternCanaryDecision(decision) {
  if (!decision || decision.decision_version !== CONTROLLED_PATTERN_CANARY_VERSION) throw new Error('STEP10_CANARY_DECISION_VERSION_INVALID');
  fingerprintPayload(decision, 'canary_decision_fingerprint', 'STEP10_CANARY_DECISION_FINGERPRINT_INVALID');
  if (decision.governance?.production_decision_weight !== 0 || decision.governance?.capital_execution_allowed !== false || decision.governance?.real_money !== 'NO') throw new Error('STEP10_CANARY_DECISION_GOVERNANCE_INVALID');
  if (Math.abs(decision.canary?.bounded_probability_delta ?? 0) > CANARY_MAX_ABS_PROBABILITY_SHIFT + 1e-12) throw new Error('STEP10_CANARY_DECISION_SHIFT_CAP_BREACH');
  return true;
}

export function settleControlledPatternCanaryDecision({ decision, outcome, settledAt }) {
  verifyControlledPatternCanaryDecision(decision);
  if (decision.state !== 'CANARY_APPLIED_PAPER_ONLY' || decision.canary?.applied !== true) throw new Error('STEP10_ONLY_ROUTED_CANARY_DECISIONS_COUNT_FOR_CANARY_HEALTH');
  if (![0, 1].includes(outcome)) throw new Error('STEP10_BINARY_OUTCOME_REQUIRED');
  const settledMs = parseTimestamp('STEP10_CANARY_SETTLED_AT', settledAt);
  if (settledMs <= parseTimestamp('STEP10_CANARY_KICKOFF_AT', decision.kickoff_at)) throw new Error('STEP10_CANARY_SETTLEMENT_MUST_FOLLOW_KICKOFF');
  const eps = 1e-15;
  const loss = p => ({
    brier: (p - outcome) ** 2,
    log_loss: -(outcome * Math.log(Math.max(eps, p)) + (1 - outcome) * Math.log(Math.max(eps, 1 - p)))
  });
  const payload = {
    settlement_version: CONTROLLED_PATTERN_CANARY_VERSION,
    match_id: decision.match_id,
    market_key: decision.market_key,
    selection: decision.selection,
    outcome,
    settled_at: settledAt,
    source_canary_authorization_fingerprint: decision.source_canary_authorization_fingerprint,
    source_canary_decision_fingerprint: decision.canary_decision_fingerprint,
    champion_probability: decision.champion.probability,
    canary_probability: decision.canary.probability,
    champion_loss: loss(decision.champion.probability),
    canary_loss: loss(decision.canary.probability),
    governance: { routed_canary_only: true, production_decision_weight: 0, capital_execution_allowed: false, real_money: 'NO' }
  };
  return deepFreeze({ ...payload, canary_settlement_fingerprint: sha256(payload) });
}

export function verifyControlledPatternCanarySettlement(settlement) {
  if (!settlement || settlement.settlement_version !== CONTROLLED_PATTERN_CANARY_VERSION) throw new Error('STEP10_CANARY_SETTLEMENT_VERSION_INVALID');
  fingerprintPayload(settlement, 'canary_settlement_fingerprint', 'STEP10_CANARY_SETTLEMENT_FINGERPRINT_INVALID');
  if (settlement.governance?.routed_canary_only !== true || settlement.governance?.capital_execution_allowed !== false) throw new Error('STEP10_CANARY_SETTLEMENT_GOVERNANCE_INVALID');
  return true;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ece(rows, key, bins = 10) {
  let total = 0;
  for (let b = 0; b < bins; b += 1) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const bucket = rows.filter(row => row[key] >= lo && (b === bins - 1 ? row[key] <= hi : row[key] < hi));
    if (!bucket.length) continue;
    const avgP = mean(bucket.map(row => row[key]));
    const avgY = mean(bucket.map(row => row.outcome));
    total += (bucket.length / rows.length) * Math.abs(avgP - avgY);
  }
  return total;
}

function metrics(rows, prefix) {
  if (!rows.length) return { n: 0, brier: null, logLoss: null, ece: null };
  const probabilityKey = `${prefix}_probability`;
  const lossKey = `${prefix}_loss`;
  return {
    n: rows.length,
    brier: mean(rows.map(row => row[lossKey].brier)),
    logLoss: mean(rows.map(row => row[lossKey].log_loss)),
    ece: ece(rows, probabilityKey)
  };
}

export function evaluateControlledPatternCanaryHealth({ authorization, settlements, evaluatedAt, integritySignals = [] }) {
  verifyControlledPatternCanaryAuthorization(authorization);
  const evaluatedMs = parseTimestamp('STEP10_CANARY_HEALTH_EVALUATED_AT', evaluatedAt);
  if (!Array.isArray(settlements) || !Array.isArray(integritySignals)) throw new Error('STEP10_CANARY_HEALTH_ARRAYS_REQUIRED');
  const seen = new Set();
  for (const row of settlements) {
    verifyControlledPatternCanarySettlement(row);
    if (row.source_canary_authorization_fingerprint !== authorization.canary_authorization_fingerprint) throw new Error('STEP10_CANARY_SETTLEMENT_AUTHORIZATION_MISMATCH');
    if (parseTimestamp('STEP10_CANARY_SETTLED_AT', row.settled_at) > evaluatedMs) throw new Error('STEP10_CANARY_HEALTH_EVALUATION_CANNOT_PREDATE_SETTLEMENT');
    const key = keyOf(row);
    if (seen.has(key)) throw new Error('STEP10_DUPLICATE_CANARY_SETTLEMENT');
    seen.add(key);
  }
  const signals = sorted(new Set(integritySignals));
  for (const signal of signals) if (!IMMEDIATE_ROLLBACK_SIGNALS.has(signal)) throw new Error(`STEP10_UNKNOWN_INTEGRITY_SIGNAL:${signal}`);
  const immediateRollback = signals.length > 0;
  const champion = metrics(settlements, 'champion');
  const canary = metrics(settlements, 'canary');
  const enoughN = settlements.length >= CANARY_HEALTH_MIN_SETTLED_N;
  const performanceRollback = enoughN && (
    canary.brier > champion.brier ||
    canary.logLoss > champion.logLoss ||
    canary.ece > champion.ece + CANARY_MAX_ECE_DEGRADATION
  );
  const rollbackRequired = immediateRollback || performanceRollback;
  const payload = {
    health_version: CONTROLLED_PATTERN_CANARY_VERSION,
    state: rollbackRequired ? 'ROLLBACK_TO_CHAMPION_REQUIRED' : enoughN ? 'CANARY_HEALTHY_CONTINUE_PAPER_ONLY' : 'CANARY_HEALTH_ACCUMULATING_PAPER_ONLY',
    evaluated_at: evaluatedAt,
    canary_authorization_fingerprint: authorization.canary_authorization_fingerprint,
    routed_settled_n: settlements.length,
    minimum_routed_settled_n: CANARY_HEALTH_MIN_SETTLED_N,
    champion,
    canary,
    integrity_signals: signals,
    gates: {
      minimum_n: enoughN,
      no_integrity_signal: !immediateRollback,
      brier_non_degraded: !enoughN || canary.brier <= champion.brier,
      log_loss_non_degraded: !enoughN || canary.logLoss <= champion.logLoss,
      ece_non_degradation: !enoughN || canary.ece <= champion.ece + CANARY_MAX_ECE_DEGRADATION
    },
    rollback_required: rollbackRequired,
    rollback_reason: immediateRollback ? 'IMMEDIATE_INTEGRITY_OR_KILL_SIGNAL' : performanceRollback ? 'CANARY_PERFORMANCE_DEGRADATION' : null,
    governance: {
      automatic_full_promotion: false,
      champion_fallback_required_on_rollback: true,
      production_decision_weight: 0,
      capital_execution_allowed: false,
      real_money: 'NO'
    }
  };
  return deepFreeze({ ...payload, canary_health_fingerprint: sha256(payload) });
}

export function verifyControlledPatternCanaryHealth(evaluation) {
  if (!evaluation || evaluation.health_version !== CONTROLLED_PATTERN_CANARY_VERSION) throw new Error('STEP10_CANARY_HEALTH_VERSION_INVALID');
  fingerprintPayload(evaluation, 'canary_health_fingerprint', 'STEP10_CANARY_HEALTH_FINGERPRINT_INVALID');
  if (evaluation.governance?.production_decision_weight !== 0 || evaluation.governance?.capital_execution_allowed !== false) throw new Error('STEP10_CANARY_HEALTH_GOVERNANCE_INVALID');
  return true;
}

export function recordControlledPatternCanaryRollback({ authorization, healthEvaluation = null, reason, actor, rationale, rolledBackAt }) {
  verifyControlledPatternCanaryAuthorization(authorization);
  if (!reason || !String(reason).trim()) throw new Error('STEP10_ROLLBACK_REASON_REQUIRED');
  if (!actor || !String(actor).trim()) throw new Error('STEP10_ROLLBACK_ACTOR_REQUIRED');
  if (!rationale || !String(rationale).trim()) throw new Error('STEP10_ROLLBACK_RATIONALE_REQUIRED');
  const rolledBackMs = parseTimestamp('STEP10_ROLLED_BACK_AT', rolledBackAt);
  if (rolledBackMs <= parseTimestamp('STEP10_CANARY_ACTIVATED_AT', authorization.activated_at)) throw new Error('STEP10_ROLLBACK_MUST_FOLLOW_ACTIVATION');
  if (healthEvaluation !== null) {
    verifyControlledPatternCanaryHealth(healthEvaluation);
    if (healthEvaluation.canary_authorization_fingerprint !== authorization.canary_authorization_fingerprint) throw new Error('STEP10_ROLLBACK_HEALTH_AUTHORIZATION_MISMATCH');
    if (rolledBackMs <= parseTimestamp('STEP10_CANARY_HEALTH_EVALUATED_AT', healthEvaluation.evaluated_at)) throw new Error('STEP10_ROLLBACK_MUST_FOLLOW_HEALTH_EVALUATION');
    if (healthEvaluation.rollback_required !== true && reason !== 'MANUAL_KILL_SWITCH') throw new Error('STEP10_ROLLBACK_WITHOUT_TRIGGER_FORBIDDEN');
  } else if (reason !== 'MANUAL_KILL_SWITCH') {
    throw new Error('STEP10_HEALTH_EVALUATION_REQUIRED_UNLESS_MANUAL_KILL');
  }
  const payload = {
    rollback_version: CONTROLLED_PATTERN_CANARY_VERSION,
    state: 'CANARY_ROLLED_BACK_CHAMPION_ONLY',
    rolled_back_at: rolledBackAt,
    reason: String(reason).trim(),
    actor: String(actor).trim(),
    rationale: String(rationale).trim(),
    canary_authorization_fingerprint: authorization.canary_authorization_fingerprint,
    source_health_fingerprint: healthEvaluation?.canary_health_fingerprint ?? null,
    enforcement: {
      routing_fraction_after_rollback: 0,
      canary_probability_influence_after_rollback: 0,
      champion_only_required: true,
      same_authorization_reactivation_allowed: false
    },
    governance: {
      canary_reactivation_allowed: false,
      new_governed_authorization_required_for_future_canary: true,
      production_decision_weight: 0,
      capital_execution_allowed: false,
      real_money: 'NO'
    }
  };
  return deepFreeze({ ...payload, rollback_fingerprint: sha256(payload) });
}
