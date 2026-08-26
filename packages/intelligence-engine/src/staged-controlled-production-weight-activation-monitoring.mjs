import { createHash } from 'node:crypto';
import {
  MAX_ABSOLUTE_PROBABILITY_SHIFT,
  CONTROLLED_PRODUCTION_HEALTH_MIN_SETTLED_N,
  verifyControlledProductionActivation
} from './controlled-production-activation-emergency-rollback.mjs';
import {
  CONTROLLED_PRODUCTION_EVIDENCE_WEIGHT_GOVERNANCE_VERSION,
  MAX_NEXT_CONTROLLED_PRODUCTION_DECISION_WEIGHT,
  verifyStep15ProductionEvidenceCohortManifest,
  verifyControlledProductionEvidenceReview,
  verifyControlledProductionWeightGovernanceDecision
} from './controlled-production-evidence-review-weight-governance.mjs';

export const STAGED_CONTROLLED_PRODUCTION_WEIGHT_VERSION = 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_ACTIVATION_MONITORING_V0_1';
export const STAGED_CONTROLLED_PRODUCTION_MAX_DECISION_WEIGHT = MAX_NEXT_CONTROLLED_PRODUCTION_DECISION_WEIGHT;
export const STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT = MAX_ABSOLUTE_PROBABILITY_SHIFT;
export const STAGED_CONTROLLED_PRODUCTION_HEALTH_MIN_SETTLED_N = CONTROLLED_PRODUCTION_HEALTH_MIN_SETTLED_N;
export const STAGED_CONTROLLED_PRODUCTION_MAX_ECE_DEGRADATION = 0.01;

export const STAGED_CONTROLLED_PRODUCTION_IMMEDIATE_ROLLBACK_SIGNALS = Object.freeze([
  'PROVENANCE_OR_FINGERPRINT_FAILURE',
  'POST_EVENT_START_LEAKAGE',
  'CALIBRATION_OR_LINEAGE_DRIFT',
  'OBSERVABILITY_OR_KILL_PATH_FAILURE',
  'DEPLOYMENT_REVERSIBILITY_FAILURE',
  'GATE6_CAPITAL_LOCK_VIOLATION',
  'STEP16_AUTHORIZATION_OR_REVIEW_DRIFT',
  'STAGED_WEIGHT_BOUNDARY_VIOLATION',
  'MANUAL_KILL_SWITCH'
]);

const SIGNAL_SET = new Set(STAGED_CONTROLLED_PRODUCTION_IMMEDIATE_ROLLBACK_SIGNALS);
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

function identityKey(matchId, marketKey, selection) {
  return `${matchId}|${marketKey}|${selection}`;
}

function validateExactStep16Authorization({ baseActivation, evidenceManifest, evidenceReview, weightGovernanceDecision }) {
  verifyControlledProductionActivation(baseActivation);
  verifyStep15ProductionEvidenceCohortManifest(evidenceManifest);
  verifyControlledProductionEvidenceReview(evidenceReview);
  verifyControlledProductionWeightGovernanceDecision(weightGovernanceDecision);

  if (evidenceManifest.manifest_version !== CONTROLLED_PRODUCTION_EVIDENCE_WEIGHT_GOVERNANCE_VERSION ||
      evidenceReview.review_version !== CONTROLLED_PRODUCTION_EVIDENCE_WEIGHT_GOVERNANCE_VERSION ||
      weightGovernanceDecision.decision_version !== CONTROLLED_PRODUCTION_EVIDENCE_WEIGHT_GOVERNANCE_VERSION) {
    throw new Error('STEP17_STEP16_VERSION_INVALID');
  }
  if (weightGovernanceDecision.decision !== 'AUTHORIZE_NEXT_CONTROLLED_WEIGHT_STAGE_NOT_APPLIED' ||
      weightGovernanceDecision.state !== 'NEXT_CONTROLLED_PRODUCTION_WEIGHT_STAGE_AUTHORIZED_NOT_APPLIED' ||
      weightGovernanceDecision.next_stage !== 'STEP_17_STAGED_CONTROLLED_PRODUCTION_WEIGHT_ACTIVATION_AND_MONITORING') {
    throw new Error('STEP17_EXACT_STEP16_AUTHORIZATION_REQUIRED');
  }
  if (weightGovernanceDecision.source_activation_fingerprint !== baseActivation.controlled_production_activation_fingerprint ||
      evidenceReview.source_activation_fingerprint !== baseActivation.controlled_production_activation_fingerprint ||
      evidenceManifest.source_activation_fingerprint !== baseActivation.controlled_production_activation_fingerprint) {
    throw new Error('STEP17_BASE_ACTIVATION_LINEAGE_MISMATCH');
  }
  if (weightGovernanceDecision.source_evidence_review_fingerprint !== evidenceReview.controlled_production_evidence_review_fingerprint ||
      weightGovernanceDecision.source_evidence_manifest_fingerprint !== evidenceManifest.step15_production_evidence_cohort_manifest_fingerprint ||
      evidenceReview.source_evidence_manifest_fingerprint !== evidenceManifest.step15_production_evidence_cohort_manifest_fingerprint) {
    throw new Error('STEP17_STEP16_REVIEW_OR_MANIFEST_LINEAGE_MISMATCH');
  }
  if (weightGovernanceDecision.enforcement?.current_production_decision_weight !== baseActivation.production.decision_weight ||
      evidenceReview.current_stage?.decision_weight !== baseActivation.production.decision_weight ||
      evidenceManifest.activation_decision_weight !== baseActivation.production.decision_weight) {
    throw new Error('STEP17_CURRENT_WEIGHT_LINEAGE_MISMATCH');
  }
  if (weightGovernanceDecision.governance?.capital_execution_allowed !== false ||
      weightGovernanceDecision.governance?.gate6_capital_lock_preserved !== true ||
      weightGovernanceDecision.governance?.real_money !== 'NO') {
    throw new Error('STEP17_GATE6_CAPITAL_LOCK_REQUIRED');
  }
  return true;
}

export function activateStagedControlledProductionWeight({
  baseActivation,
  evidenceManifest,
  evidenceReview,
  weightGovernanceDecision,
  targetDecisionWeight,
  activatedAt,
  activatedBy,
  deploymentReference,
  killSwitchReference
}) {
  validateExactStep16Authorization({ baseActivation, evidenceManifest, evidenceReview, weightGovernanceDecision });
  const currentWeight = baseActivation.production.decision_weight;
  const ceiling = weightGovernanceDecision.enforcement.authorized_maximum_next_stage_decision_weight;
  if (typeof targetDecisionWeight !== 'number' || !Number.isFinite(targetDecisionWeight) ||
      targetDecisionWeight <= currentWeight || targetDecisionWeight > ceiling ||
      targetDecisionWeight > STAGED_CONTROLLED_PRODUCTION_MAX_DECISION_WEIGHT) {
    throw new Error('STEP17_TARGET_WEIGHT_OUT_OF_AUTHORIZED_RANGE');
  }
  if (!activatedBy || !String(activatedBy).trim()) throw new Error('STEP17_ACTIVATED_BY_REQUIRED');
  if (!deploymentReference || !String(deploymentReference).trim()) throw new Error('STEP17_DEPLOYMENT_REFERENCE_REQUIRED');
  if (!killSwitchReference || !String(killSwitchReference).trim()) throw new Error('STEP17_KILL_SWITCH_REFERENCE_REQUIRED');
  const activatedMs = parseTimestamp('STEP17_ACTIVATED_AT', activatedAt);
  if (activatedMs <= parseTimestamp('STEP17_STEP16_DECIDED_AT', weightGovernanceDecision.decided_at)) {
    throw new Error('STEP17_ACTIVATION_MUST_FOLLOW_STEP16_DECISION');
  }

  const reviewedKeys = [...(evidenceManifest.match_market_selection_key_set ?? [])].sort();
  const payload = {
    activation_version: STAGED_CONTROLLED_PRODUCTION_WEIGHT_VERSION,
    state: 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_ACTIVE_CAPITAL_LOCKED',
    activated_at: activatedAt,
    activated_by: String(activatedBy).trim(),
    source_base_activation_fingerprint: baseActivation.controlled_production_activation_fingerprint,
    source_step16_evidence_manifest_fingerprint: evidenceManifest.step15_production_evidence_cohort_manifest_fingerprint,
    source_step16_evidence_review_fingerprint: evidenceReview.controlled_production_evidence_review_fingerprint,
    source_step16_weight_governance_decision_fingerprint: weightGovernanceDecision.controlled_production_weight_governance_decision_fingerprint,
    production: {
      previous_stage_decision_weight: currentWeight,
      staged_decision_weight: targetDecisionWeight,
      authorized_maximum_staged_decision_weight: ceiling,
      absolute_maximum_staged_decision_weight: STAGED_CONTROLLED_PRODUCTION_MAX_DECISION_WEIGHT,
      maximum_absolute_probability_shift: STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT,
      mutation_method: 'WEIGHTED_CHALLENGER_DELTA_WITH_PREVIOUS_WEIGHT_COUNTERFACTUAL_AND_ABSOLUTE_CAP',
      champion_remains_primary_fallback: true,
      champion_replacement_authorized: false,
      capital_execution_allowed: false
    },
    evidence_firewall: {
      reviewed_step16_match_market_selection_key_set: reviewedKeys,
      reviewed_step16_evidence_may_reappear: false,
      reviewed_evidence_reuse_for_training: false,
      reviewed_evidence_reuse_for_retuning: false,
      new_prospective_evidence_required: true
    },
    deployment: {
      deployment_reference: String(deploymentReference).trim(),
      reversible: true
    },
    emergency_rollback: {
      kill_switch_armed: true,
      kill_switch_reference: String(killSwitchReference).trim(),
      rollback_target: 'CHAMPION_ONLY',
      same_staged_activation_reactivation_allowed_after_rollback: false
    },
    governance: {
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
  return deepFreeze({ ...payload, staged_controlled_production_weight_activation_fingerprint: sha256(payload) });
}

export function verifyStagedControlledProductionWeightActivation(activation) {
  if (!activation || activation.activation_version !== STAGED_CONTROLLED_PRODUCTION_WEIGHT_VERSION) throw new Error('STEP17_ACTIVATION_VERSION_INVALID');
  fingerprintPayload(activation, 'staged_controlled_production_weight_activation_fingerprint', 'STEP17_ACTIVATION_FINGERPRINT_INVALID');
  if (activation.state !== 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_ACTIVE_CAPITAL_LOCKED') throw new Error('STEP17_ACTIVATION_STATE_INVALID');
  const p = activation.production ?? {};
  if (!(p.previous_stage_decision_weight > 0) || !(p.staged_decision_weight > p.previous_stage_decision_weight) ||
      p.staged_decision_weight > p.authorized_maximum_staged_decision_weight ||
      p.authorized_maximum_staged_decision_weight > STAGED_CONTROLLED_PRODUCTION_MAX_DECISION_WEIGHT ||
      p.absolute_maximum_staged_decision_weight !== STAGED_CONTROLLED_PRODUCTION_MAX_DECISION_WEIGHT ||
      p.maximum_absolute_probability_shift !== STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT ||
      p.champion_remains_primary_fallback !== true || p.champion_replacement_authorized !== false || p.capital_execution_allowed !== false) {
    throw new Error('STEP17_ACTIVATION_PRODUCTION_BOUNDARY_INVALID');
  }
  if (activation.evidence_firewall?.reviewed_step16_evidence_may_reappear !== false ||
      activation.evidence_firewall?.reviewed_evidence_reuse_for_training !== false ||
      activation.evidence_firewall?.reviewed_evidence_reuse_for_retuning !== false ||
      activation.evidence_firewall?.new_prospective_evidence_required !== true) {
    throw new Error('STEP17_EVIDENCE_FIREWALL_INVALID');
  }
  if (activation.emergency_rollback?.kill_switch_armed !== true || activation.emergency_rollback?.rollback_target !== 'CHAMPION_ONLY') {
    throw new Error('STEP17_KILL_SWITCH_NOT_ARMED');
  }
  if (activation.governance?.automatic_weight_ramp !== false || activation.governance?.automatic_retuning !== false ||
      activation.governance?.champion_replacement_authorized !== false || activation.governance?.capital_execution_allowed !== false ||
      activation.governance?.gate6_capital_lock_preserved !== true || activation.governance?.real_money !== 'NO') {
    throw new Error('STEP17_ACTIVATION_GOVERNANCE_INVALID');
  }
  return true;
}

export function applyStagedControlledProductionWeight({
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
  verifyStagedControlledProductionWeightActivation(activation);
  if (!matchId || !marketKey || !selection) throw new Error('STEP17_DECISION_IDENTITY_REQUIRED');
  const key = identityKey(String(matchId), String(marketKey), String(selection));
  if ((activation.evidence_firewall.reviewed_step16_match_market_selection_key_set ?? []).includes(key)) {
    throw new Error('STEP17_STEP16_REVIEWED_EVIDENCE_REUSE_FORBIDDEN');
  }
  const generatedMs = parseTimestamp('STEP17_GENERATED_AT', generatedAt);
  const eventStartMs = parseTimestamp('STEP17_EVENT_START_AT', eventStartAt);
  if (generatedMs < parseTimestamp('STEP17_ACTIVATED_AT', activation.activated_at)) throw new Error('STEP17_RETROACTIVE_STAGED_DECISION_FORBIDDEN');
  if (generatedMs >= eventStartMs) throw new Error('STEP17_POST_EVENT_START_MUTATION_FORBIDDEN');
  const champion = probability('STEP17_CHAMPION', championProbability);
  const challenger = probability('STEP17_CHALLENGER', challengerProbability);

  if (rollbackRecord) {
    verifyStagedControlledProductionWeightRollback(rollbackRecord);
    if (rollbackRecord.source_staged_activation_fingerprint !== activation.staged_controlled_production_weight_activation_fingerprint) {
      throw new Error('STEP17_ROLLBACK_ACTIVATION_MISMATCH');
    }
    const payload = {
      decision_version: STAGED_CONTROLLED_PRODUCTION_WEIGHT_VERSION,
      state: 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_ROLLED_BACK_CHAMPION_ONLY',
      match_id: String(matchId), market_key: String(marketKey), selection: String(selection),
      generated_at: generatedAt, event_start_at: eventStartAt,
      source_staged_activation_fingerprint: activation.staged_controlled_production_weight_activation_fingerprint,
      champion_probability: champion, challenger_probability: challenger,
      previous_stage_decision_weight: 0, staged_decision_weight: 0,
      previous_stage_probability: champion, staged_production_probability: champion,
      applied_probability_shift: 0,
      rollback_fingerprint: rollbackRecord.staged_weight_rollback_fingerprint,
      capital_execution_allowed: false, real_money: 'NO'
    };
    return deepFreeze({ ...payload, staged_controlled_production_weight_decision_fingerprint: sha256(payload) });
  }

  const rawDelta = challenger - champion;
  const previousDelta = clamp(rawDelta * activation.production.previous_stage_decision_weight,
    -STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT,
    STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT);
  const stagedDelta = clamp(rawDelta * activation.production.staged_decision_weight,
    -STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT,
    STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT);
  const previousProbability = clamp(champion + previousDelta, 0, 1);
  const stagedProbability = clamp(champion + stagedDelta, 0, 1);
  const payload = {
    decision_version: STAGED_CONTROLLED_PRODUCTION_WEIGHT_VERSION,
    state: 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_INFLUENCE_APPLIED_CAPITAL_LOCKED',
    match_id: String(matchId), market_key: String(marketKey), selection: String(selection),
    generated_at: generatedAt, event_start_at: eventStartAt,
    source_staged_activation_fingerprint: activation.staged_controlled_production_weight_activation_fingerprint,
    champion_probability: champion, challenger_probability: challenger,
    raw_probability_delta: rawDelta,
    previous_stage_decision_weight: activation.production.previous_stage_decision_weight,
    staged_decision_weight: activation.production.staged_decision_weight,
    previous_stage_applied_probability_shift: previousDelta,
    applied_probability_shift: stagedDelta,
    previous_stage_probability: previousProbability,
    staged_production_probability: stagedProbability,
    maximum_absolute_probability_shift: STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT,
    rollback_fingerprint: null,
    capital_execution_allowed: false,
    real_money: 'NO'
  };
  return deepFreeze({ ...payload, staged_controlled_production_weight_decision_fingerprint: sha256(payload) });
}

export function verifyStagedControlledProductionWeightDecision(decision) {
  if (!decision || decision.decision_version !== STAGED_CONTROLLED_PRODUCTION_WEIGHT_VERSION) throw new Error('STEP17_DECISION_VERSION_INVALID');
  fingerprintPayload(decision, 'staged_controlled_production_weight_decision_fingerprint', 'STEP17_DECISION_FINGERPRINT_INVALID');
  probability('STEP17_DECISION_CHAMPION', decision.champion_probability);
  probability('STEP17_DECISION_CHALLENGER', decision.challenger_probability);
  probability('STEP17_DECISION_PREVIOUS', decision.previous_stage_probability);
  probability('STEP17_DECISION_STAGED', decision.staged_production_probability);
  if (decision.capital_execution_allowed !== false || decision.real_money !== 'NO') throw new Error('STEP17_DECISION_CAPITAL_BOUNDARY_INVALID');
  if (Math.abs(decision.applied_probability_shift) > STAGED_CONTROLLED_PRODUCTION_MAX_ABSOLUTE_PROBABILITY_SHIFT + 1e-12) {
    throw new Error('STEP17_DECISION_SHIFT_CAP_EXCEEDED');
  }
  if (decision.state === 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_ROLLED_BACK_CHAMPION_ONLY') {
    if (!decision.rollback_fingerprint || decision.previous_stage_decision_weight !== 0 || decision.staged_decision_weight !== 0 ||
        decision.applied_probability_shift !== 0 ||
        Math.abs(decision.staged_production_probability - decision.champion_probability) > 1e-12) {
      throw new Error('STEP17_ROLLED_BACK_DECISION_INVALID');
    }
  } else if (decision.state === 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_INFLUENCE_APPLIED_CAPITAL_LOCKED') {
    if (decision.rollback_fingerprint !== null || !(decision.staged_decision_weight > decision.previous_stage_decision_weight) ||
        decision.staged_decision_weight > STAGED_CONTROLLED_PRODUCTION_MAX_DECISION_WEIGHT) {
      throw new Error('STEP17_ACTIVE_DECISION_WEIGHT_INVALID');
    }
  } else throw new Error('STEP17_DECISION_STATE_INVALID');
  return true;
}

export function settleStagedControlledProductionWeightDecision({ decision, outcome, settledAt }) {
  verifyStagedControlledProductionWeightDecision(decision);
  if (outcome !== 0 && outcome !== 1) throw new Error('STEP17_BINARY_OUTCOME_REQUIRED');
  if (parseTimestamp('STEP17_SETTLED_AT', settledAt) <= parseTimestamp('STEP17_EVENT_START_AT', decision.event_start_at)) {
    throw new Error('STEP17_SETTLEMENT_MUST_FOLLOW_EVENT_START');
  }
  const payload = {
    settlement_version: STAGED_CONTROLLED_PRODUCTION_WEIGHT_VERSION,
    state: 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_DECISION_SETTLED',
    settled_at: settledAt,
    source_staged_activation_fingerprint: decision.source_staged_activation_fingerprint,
    source_decision_fingerprint: decision.staged_controlled_production_weight_decision_fingerprint,
    match_id: decision.match_id, market_key: decision.market_key, selection: decision.selection,
    champion_probability: decision.champion_probability,
    previous_stage_probability: decision.previous_stage_probability,
    staged_production_probability: decision.staged_production_probability,
    outcome,
    capital_execution_allowed: false,
    real_money: 'NO'
  };
  return deepFreeze({ ...payload, staged_controlled_production_weight_settlement_fingerprint: sha256(payload) });
}

export function verifyStagedControlledProductionWeightSettlement(settlement) {
  if (!settlement || settlement.settlement_version !== STAGED_CONTROLLED_PRODUCTION_WEIGHT_VERSION) throw new Error('STEP17_SETTLEMENT_VERSION_INVALID');
  fingerprintPayload(settlement, 'staged_controlled_production_weight_settlement_fingerprint', 'STEP17_SETTLEMENT_FINGERPRINT_INVALID');
  probability('STEP17_SETTLEMENT_CHAMPION', settlement.champion_probability);
  probability('STEP17_SETTLEMENT_PREVIOUS', settlement.previous_stage_probability);
  probability('STEP17_SETTLEMENT_STAGED', settlement.staged_production_probability);
  if (settlement.outcome !== 0 && settlement.outcome !== 1) throw new Error('STEP17_SETTLEMENT_OUTCOME_INVALID');
  if (settlement.capital_execution_allowed !== false || settlement.real_money !== 'NO') throw new Error('STEP17_SETTLEMENT_CAPITAL_BOUNDARY_INVALID');
  return true;
}

function metrics(rows, field) {
  if (!rows.length) return { n: 0, brier: null, log_loss: null, ece: null };
  let brier = 0;
  let logLoss = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const row of rows) {
    const p = probability('STEP17_METRIC_PROBABILITY', row[field]);
    const y = row.outcome;
    brier += (p - y) ** 2;
    const q = clamp(p, EPS, 1 - EPS);
    logLoss += -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
    const index = Math.min(9, Math.floor(p * 10));
    bins[index].n += 1; bins[index].p += p; bins[index].y += y;
  }
  let ece = 0;
  for (const bin of bins) {
    if (bin.n) ece += (bin.n / rows.length) * Math.abs(bin.p / bin.n - bin.y / bin.n);
  }
  return { n: rows.length, brier: brier / rows.length, log_loss: logLoss / rows.length, ece };
}

export function evaluateStagedControlledProductionWeightHealth({ activation, settlements, evaluatedAt, integritySignals = [] }) {
  verifyStagedControlledProductionWeightActivation(activation);
  parseTimestamp('STEP17_HEALTH_EVALUATED_AT', evaluatedAt);
  if (!Array.isArray(settlements)) throw new Error('STEP17_SETTLEMENT_ARRAY_REQUIRED');
  const seen = new Set();
  for (const settlement of settlements) {
    verifyStagedControlledProductionWeightSettlement(settlement);
    if (settlement.source_staged_activation_fingerprint !== activation.staged_controlled_production_weight_activation_fingerprint) {
      throw new Error('STEP17_HEALTH_SETTLEMENT_ACTIVATION_MISMATCH');
    }
    const key = identityKey(settlement.match_id, settlement.market_key, settlement.selection);
    if (seen.has(key)) throw new Error('STEP17_HEALTH_DUPLICATE_MATCH_MARKET_SELECTION');
    if ((activation.evidence_firewall.reviewed_step16_match_market_selection_key_set ?? []).includes(key)) {
      throw new Error('STEP17_HEALTH_STEP16_EVIDENCE_REUSE_FORBIDDEN');
    }
    seen.add(key);
  }
  const signals = [...new Set(integritySignals)];
  for (const signal of signals) if (!SIGNAL_SET.has(signal)) throw new Error(`STEP17_UNKNOWN_INTEGRITY_SIGNAL:${signal}`);

  const champion = metrics(settlements, 'champion_probability');
  const previousStage = metrics(settlements, 'previous_stage_probability');
  const staged = metrics(settlements, 'staged_production_probability');
  const minN = settlements.length >= STAGED_CONTROLLED_PRODUCTION_HEALTH_MIN_SETTLED_N;
  const brierVsChampion = minN && staged.brier <= champion.brier + 1e-12;
  const logLossVsChampion = minN && staged.log_loss <= champion.log_loss + 1e-12;
  const eceVsChampion = minN && staged.ece <= champion.ece + STAGED_CONTROLLED_PRODUCTION_MAX_ECE_DEGRADATION + 1e-12;
  const brierVsPrevious = minN && staged.brier <= previousStage.brier + 1e-12;
  const logLossVsPrevious = minN && staged.log_loss <= previousStage.log_loss + 1e-12;
  const eceVsPrevious = minN && staged.ece <= previousStage.ece + STAGED_CONTROLLED_PRODUCTION_MAX_ECE_DEGRADATION + 1e-12;
  const performanceRollback = minN && !(brierVsChampion && logLossVsChampion && eceVsChampion && brierVsPrevious && logLossVsPrevious && eceVsPrevious);
  const rollbackRequired = signals.length > 0 || performanceRollback;
  const state = rollbackRequired
    ? 'STAGED_CONTROLLED_WEIGHT_ROLLBACK_TO_CHAMPION_REQUIRED'
    : minN
      ? 'STAGED_CONTROLLED_WEIGHT_HEALTHY_CONTINUE_CAPITAL_LOCKED'
      : 'STAGED_CONTROLLED_WEIGHT_HEALTH_ACCUMULATING_CAPITAL_LOCKED';

  const payload = {
    health_version: STAGED_CONTROLLED_PRODUCTION_WEIGHT_VERSION,
    state,
    evaluated_at: evaluatedAt,
    source_staged_activation_fingerprint: activation.staged_controlled_production_weight_activation_fingerprint,
    settled_n: settlements.length,
    champion,
    previous_stage: previousStage,
    staged,
    integrity_signals: signals.sort(),
    gates: {
      minimum_new_staged_settled_n_passed: minN,
      staged_brier_non_degradation_vs_champion_passed: brierVsChampion,
      staged_log_loss_non_degradation_vs_champion_passed: logLossVsChampion,
      staged_ece_degradation_cap_vs_champion_passed: eceVsChampion,
      staged_brier_non_degradation_vs_previous_weight_passed: brierVsPrevious,
      staged_log_loss_non_degradation_vs_previous_weight_passed: logLossVsPrevious,
      staged_ece_degradation_cap_vs_previous_weight_passed: eceVsPrevious
    },
    rollback_required: rollbackRequired,
    governance: {
      automatic_next_weight_increase: false,
      automatic_retuning: false,
      champion_replacement_authorized: false,
      capital_execution_allowed: false,
      additional_alpha_spent: false,
      gate6_capital_lock_preserved: true,
      real_money: 'NO'
    },
    next_stage: state === 'STAGED_CONTROLLED_WEIGHT_HEALTHY_CONTINUE_CAPITAL_LOCKED'
      ? 'STEP_18_STAGED_CONTROLLED_PRODUCTION_WEIGHT_EVIDENCE_REVIEW_AND_GOVERNANCE'
      : null
  };
  return deepFreeze({ ...payload, staged_controlled_production_weight_health_fingerprint: sha256(payload) });
}

export function verifyStagedControlledProductionWeightHealth(health) {
  if (!health || health.health_version !== STAGED_CONTROLLED_PRODUCTION_WEIGHT_VERSION) throw new Error('STEP17_HEALTH_VERSION_INVALID');
  fingerprintPayload(health, 'staged_controlled_production_weight_health_fingerprint', 'STEP17_HEALTH_FINGERPRINT_INVALID');
  if (![
    'STAGED_CONTROLLED_WEIGHT_HEALTH_ACCUMULATING_CAPITAL_LOCKED',
    'STAGED_CONTROLLED_WEIGHT_HEALTHY_CONTINUE_CAPITAL_LOCKED',
    'STAGED_CONTROLLED_WEIGHT_ROLLBACK_TO_CHAMPION_REQUIRED'
  ].includes(health.state)) throw new Error('STEP17_HEALTH_STATE_INVALID');
  if ((health.state === 'STAGED_CONTROLLED_WEIGHT_ROLLBACK_TO_CHAMPION_REQUIRED') !== (health.rollback_required === true)) {
    throw new Error('STEP17_HEALTH_ROLLBACK_STATE_MISMATCH');
  }
  if (health.governance?.automatic_next_weight_increase !== false || health.governance?.automatic_retuning !== false ||
      health.governance?.champion_replacement_authorized !== false || health.governance?.capital_execution_allowed !== false ||
      health.governance?.gate6_capital_lock_preserved !== true || health.governance?.real_money !== 'NO') {
    throw new Error('STEP17_HEALTH_GOVERNANCE_INVALID');
  }
  return true;
}

export function recordStagedControlledProductionWeightRollback({ activation, reason, actor, rationale, rolledBackAt, healthEvaluation = null }) {
  verifyStagedControlledProductionWeightActivation(activation);
  if (!SIGNAL_SET.has(reason) && reason !== 'PERFORMANCE_DEGRADATION_AFTER_MINIMUM_N') throw new Error('STEP17_ROLLBACK_REASON_INVALID');
  if (!actor || !String(actor).trim()) throw new Error('STEP17_ROLLBACK_ACTOR_REQUIRED');
  if (!rationale || !String(rationale).trim()) throw new Error('STEP17_ROLLBACK_RATIONALE_REQUIRED');
  if (parseTimestamp('STEP17_ROLLED_BACK_AT', rolledBackAt) <= parseTimestamp('STEP17_ACTIVATED_AT', activation.activated_at)) {
    throw new Error('STEP17_ROLLBACK_MUST_FOLLOW_ACTIVATION');
  }
  if (reason === 'PERFORMANCE_DEGRADATION_AFTER_MINIMUM_N') {
    verifyStagedControlledProductionWeightHealth(healthEvaluation);
    if (healthEvaluation.source_staged_activation_fingerprint !== activation.staged_controlled_production_weight_activation_fingerprint ||
        healthEvaluation.state !== 'STAGED_CONTROLLED_WEIGHT_ROLLBACK_TO_CHAMPION_REQUIRED' ||
        healthEvaluation.gates?.minimum_new_staged_settled_n_passed !== true) {
      throw new Error('STEP17_PERFORMANCE_ROLLBACK_REQUIRES_FAILED_MIN_N_HEALTH');
    }
  }
  const payload = {
    rollback_version: STAGED_CONTROLLED_PRODUCTION_WEIGHT_VERSION,
    state: 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_EMERGENCY_ROLLED_BACK_CHAMPION_ONLY',
    rolled_back_at: rolledBackAt,
    actor: String(actor).trim(),
    reason,
    rationale: String(rationale).trim(),
    source_staged_activation_fingerprint: activation.staged_controlled_production_weight_activation_fingerprint,
    source_health_fingerprint: healthEvaluation?.staged_controlled_production_weight_health_fingerprint ?? null,
    enforcement: {
      rollback_target: 'CHAMPION_ONLY',
      production_decision_weight: 0,
      probability_influence: 0,
      same_staged_activation_reactivation_allowed: false,
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
  return deepFreeze({ ...payload, staged_weight_rollback_fingerprint: sha256(payload) });
}

export function verifyStagedControlledProductionWeightRollback(rollback) {
  if (!rollback || rollback.rollback_version !== STAGED_CONTROLLED_PRODUCTION_WEIGHT_VERSION) throw new Error('STEP17_ROLLBACK_VERSION_INVALID');
  fingerprintPayload(rollback, 'staged_weight_rollback_fingerprint', 'STEP17_ROLLBACK_FINGERPRINT_INVALID');
  if (rollback.state !== 'STAGED_CONTROLLED_PRODUCTION_WEIGHT_EMERGENCY_ROLLED_BACK_CHAMPION_ONLY' ||
      rollback.enforcement?.rollback_target !== 'CHAMPION_ONLY' || rollback.enforcement?.production_decision_weight !== 0 ||
      rollback.enforcement?.probability_influence !== 0 || rollback.enforcement?.same_staged_activation_reactivation_allowed !== false ||
      rollback.governance?.capital_execution_allowed !== false || rollback.governance?.gate6_capital_lock_preserved !== true ||
      rollback.governance?.real_money !== 'NO') {
    throw new Error('STEP17_ROLLBACK_BOUNDARY_INVALID');
  }
  return true;
}
