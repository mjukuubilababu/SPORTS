import { createHash } from 'node:crypto';
import { compareChallenger } from './champion-challenger.mjs';
import { proposeLearningChange } from './governed-learning-loop.mjs';
import { verifyPatternTemporalContextStability } from './pattern-temporal-context-stability.mjs';

export const PATTERN_PROMOTION_SHADOW_VERSION = 'PATTERN_PROMOTION_GOVERNANCE_SHADOW_INTEGRATION_V0_1';
export const SHADOW_MIN_SETTLED_N = 100;
export const SHADOW_MIN_CALIBRATION_N = 30;
export const SHADOW_MAX_ABS_LOGIT_SHIFT = 0.35;
export const SHADOW_MAX_ABS_PROBABILITY_SHIFT = 0.10;
export const SHADOW_MAX_ECE_DEGRADATION = 0.01;

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

function logit(p) {
  if (!(p > 0 && p < 1)) throw new Error('STEP8_PROBABILITY_MUST_BE_OPEN_INTERVAL');
  return Math.log(p / (1 - p));
}

function logistic(x) {
  return 1 / (1 + Math.exp(-x));
}

function validatePatternCalibration(calibration, validatedPatternIds) {
  if (!calibration) return { ready:false, reasons:['PATTERN_TO_PREDICTION_CALIBRATION_REQUIRED'] };
  const reasons=[];
  if (calibration.verified !== true) reasons.push('CALIBRATION_NOT_VERIFIED');
  if (calibration.independent !== true) reasons.push('CALIBRATION_NOT_INDEPENDENT');
  if (calibration.uses_bookmaker_odds === true) reasons.push('BOOKMAKER_ODDS_FORBIDDEN_FROM_PATTERN_CALIBRATION');
  if (!calibration.version) reasons.push('CALIBRATION_VERSION_REQUIRED');
  if (!calibration.provenance) reasons.push('CALIBRATION_PROVENANCE_REQUIRED');
  if (!Number.isInteger(calibration.sample_n) || calibration.sample_n < SHADOW_MIN_CALIBRATION_N) reasons.push('CALIBRATION_MIN_N_NOT_MET');
  if (!calibration.trained_through) reasons.push('CALIBRATION_TRAINED_THROUGH_REQUIRED');
  if (!calibration.pattern_coefficients || typeof calibration.pattern_coefficients !== 'object') reasons.push('PATTERN_COEFFICIENTS_REQUIRED');
  if (Number.isFinite(calibration.max_abs_logit_shift) && calibration.max_abs_logit_shift > SHADOW_MAX_ABS_LOGIT_SHIFT) reasons.push('CALIBRATION_LOGIT_CAP_TOO_WIDE');
  if (Number.isFinite(calibration.max_abs_probability_shift) && calibration.max_abs_probability_shift > SHADOW_MAX_ABS_PROBABILITY_SHIFT) reasons.push('CALIBRATION_PROBABILITY_CAP_TOO_WIDE');
  for (const patternId of validatedPatternIds) {
    const beta=calibration.pattern_coefficients?.[patternId]?.logit_beta;
    if (!Number.isFinite(beta)) reasons.push(`MISSING_PATTERN_COEFFICIENT:${patternId}`);
    else if (Math.abs(beta) > SHADOW_MAX_ABS_LOGIT_SHIFT) reasons.push(`PATTERN_COEFFICIENT_OUT_OF_BOUNDS:${patternId}`);
  }
  return { ready:reasons.length===0, reasons };
}

export function createPatternShadowPlan({ step7Evaluation, calibration=null, createdAt }) {
  verifyPatternTemporalContextStability(step7Evaluation);
  parseTimestamp('STEP8_CREATED_AT',createdAt);
  const validated=(step7Evaluation.pattern_results ?? []).filter(row => row.state==='VALIDATED_PATTERN_EVIDENCE_ZERO_WEIGHT' && row.pattern_validated===true && row.decision_weight===0);
  const validatedPatternIds=validated.map(row=>row.pattern_id).sort();
  const calibrationCheck=validatePatternCalibration(calibration,validatedPatternIds);
  const ready=validatedPatternIds.length>0 && calibrationCheck.ready;
  if (ready && parseTimestamp('STEP8_CALIBRATION_TRAINED_THROUGH',calibration.trained_through) >= parseTimestamp('STEP8_PLAN_CREATED_AT',createdAt)) {
    throw new Error('STEP8_CALIBRATION_MUST_PREDATE_SHADOW_PLAN');
  }
  const payload={
    plan_version:PATTERN_PROMOTION_SHADOW_VERSION,
    state:ready?'SHADOW_PLAN_READY_ZERO_WEIGHT':'SHADOW_PLAN_WAITING_FOR_VALIDATED_PATTERN_OR_CALIBRATION',
    created_at:createdAt,
    source_step7_fingerprint:step7Evaluation.stability_fingerprint,
    validated_pattern_ids:validatedPatternIds,
    validated_pattern_result_fingerprints:validated.map(row=>row.result_fingerprint).sort(),
    calibration:ready?{
      version:calibration.version,
      provenance:calibration.provenance,
      verified:true,
      independent:true,
      sample_n:calibration.sample_n,
      trained_through:calibration.trained_through,
      uses_bookmaker_odds:false,
      pattern_coefficients:Object.fromEntries(validatedPatternIds.map(id=>[id,{logit_beta:calibration.pattern_coefficients[id].logit_beta}])),
      max_abs_logit_shift:Math.min(calibration.max_abs_logit_shift ?? SHADOW_MAX_ABS_LOGIT_SHIFT,SHADOW_MAX_ABS_LOGIT_SHIFT),
      max_abs_probability_shift:Math.min(calibration.max_abs_probability_shift ?? SHADOW_MAX_ABS_PROBABILITY_SHIFT,SHADOW_MAX_ABS_PROBABILITY_SHIFT)
    }:null,
    blockers:ready?[]:[...(validatedPatternIds.length?[]:['NO_STEP7_VALIDATED_PATTERN']),...calibrationCheck.reasons],
    integration:{
      mode:'SHADOW_ONLY',
      champion_path_authoritative:true,
      champion_challenger_owner:'packages/intelligence-engine/src/champion-challenger.mjs',
      governed_learning_owner:'packages/intelligence-engine/src/governed-learning-loop.mjs',
      calibrated_team_intelligence_owner_unchanged:true,
      baseline_prediction_mutation_allowed:false,
      shadow_prediction_may_reach_decision_path:false
    },
    governance:{decision_weight:0,automatic_promotion:false,automatic_retuning:false,production_mutation_allowed:false,p002_changed:false,gate1_to_gate6_ownership_changed:false,capital_effect:'NONE',real_money:'NO'}
  };
  return deepFreeze({...payload,shadow_plan_fingerprint:sha256(payload)});
}

export function verifyPatternShadowPlan(plan) {
  if (!plan || plan.plan_version!==PATTERN_PROMOTION_SHADOW_VERSION) throw new Error('STEP8_SHADOW_PLAN_VERSION_INVALID');
  const {shadow_plan_fingerprint,...payload}=plan;
  if (!shadow_plan_fingerprint || sha256(payload)!==shadow_plan_fingerprint) throw new Error('STEP8_SHADOW_PLAN_FINGERPRINT_INVALID');
  if (plan.governance?.decision_weight!==0 || plan.governance?.production_mutation_allowed!==false) throw new Error('STEP8_SHADOW_PLAN_PRODUCTION_INFLUENCE_FORBIDDEN');
  if (plan.integration?.champion_path_authoritative!==true || plan.integration?.shadow_prediction_may_reach_decision_path!==false) throw new Error('STEP8_CHAMPION_PATH_AUTHORITY_DRIFT');
  return true;
}

export function createPatternShadowPrediction({ plan, baselinePrediction, activations=[], generatedAt, kickoffAt }) {
  verifyPatternShadowPlan(plan);
  if (plan.state!=='SHADOW_PLAN_READY_ZERO_WEIGHT') throw new Error('STEP8_SHADOW_PLAN_NOT_READY');
  const generatedMs=parseTimestamp('STEP8_SHADOW_GENERATED_AT',generatedAt);
  const kickoffMs=parseTimestamp('STEP8_KICKOFF_AT',kickoffAt);
  if (generatedMs>=kickoffMs) throw new Error('STEP8_POST_KICKOFF_SHADOW_PREDICTION_FORBIDDEN');
  if (!baselinePrediction?.match_id || !baselinePrediction?.market_key || !baselinePrediction?.selection || !baselinePrediction?.model_version) throw new Error('STEP8_BASELINE_PREDICTION_FIELDS_REQUIRED');
  if (!(baselinePrediction.probability>0 && baselinePrediction.probability<1)) throw new Error('STEP8_BASELINE_PROBABILITY_INVALID');
  if (baselinePrediction.generated_at && parseTimestamp('STEP8_BASELINE_GENERATED_AT',baselinePrediction.generated_at)>=kickoffMs) throw new Error('STEP8_POST_KICKOFF_BASELINE_FORBIDDEN');
  const seen=new Set();
  const active=[];
  let rawShift=0;
  for (const row of activations) {
    if (!row?.pattern_id || row.active!==true) continue;
    if (seen.has(row.pattern_id)) throw new Error('STEP8_DUPLICATE_PATTERN_ACTIVATION');
    seen.add(row.pattern_id);
    if (!plan.validated_pattern_ids.includes(row.pattern_id)) throw new Error('STEP8_UNVALIDATED_PATTERN_ACTIVATION_FORBIDDEN');
    if (!row.provenance || !row.observed_at) throw new Error('STEP8_ACTIVATION_PROVENANCE_REQUIRED');
    if (parseTimestamp('STEP8_ACTIVATION_OBSERVED_AT',row.observed_at)>=kickoffMs) throw new Error('STEP8_POST_KICKOFF_PATTERN_ACTIVATION_FORBIDDEN');
    const beta=plan.calibration.pattern_coefficients[row.pattern_id].logit_beta;
    rawShift+=beta;
    active.push({pattern_id:row.pattern_id,logit_beta:beta,provenance:row.provenance,observed_at:row.observed_at});
  }
  const cappedLogitShift=clamp(rawShift,-plan.calibration.max_abs_logit_shift,plan.calibration.max_abs_logit_shift);
  const unconstrained=logistic(logit(baselinePrediction.probability)+cappedLogitShift);
  const probabilityDelta=clamp(unconstrained-baselinePrediction.probability,-plan.calibration.max_abs_probability_shift,plan.calibration.max_abs_probability_shift);
  const shadowProbability=clamp(baselinePrediction.probability+probabilityDelta,1e-9,1-1e-9);
  const payload={
    shadow_version:PATTERN_PROMOTION_SHADOW_VERSION,
    match_id:baselinePrediction.match_id,
    market_key:baselinePrediction.market_key,
    selection:baselinePrediction.selection,
    kickoff_at:kickoffAt,
    generated_at:generatedAt,
    baseline:{model_version:baselinePrediction.model_version,probability:baselinePrediction.probability,generated_at:baselinePrediction.generated_at ?? generatedAt},
    shadow:{probability:shadowProbability,raw_logit_shift:rawShift,capped_logit_shift:cappedLogitShift,probability_delta:shadowProbability-baselinePrediction.probability,activations:active},
    source_shadow_plan_fingerprint:plan.shadow_plan_fingerprint,
    governance:{shadow_only:true,decision_weight:0,baseline_mutated:false,production_decision_affected:false,market_data_used_as_prediction_input:false}
  };
  return deepFreeze({...payload,shadow_prediction_fingerprint:sha256(payload)});
}

export function settlePatternShadowPrediction({ shadowPrediction, outcome, settledAt, verifiedMarketClv=null }) {
  const {shadow_prediction_fingerprint,...payload}=shadowPrediction ?? {};
  if (!shadow_prediction_fingerprint || sha256(payload)!==shadow_prediction_fingerprint) throw new Error('STEP8_SHADOW_PREDICTION_FINGERPRINT_INVALID');
  if (![0,1].includes(outcome)) throw new Error('STEP8_BINARY_OUTCOME_REQUIRED');
  const settledMs=parseTimestamp('STEP8_SETTLED_AT',settledAt);
  if (settledMs<=parseTimestamp('STEP8_KICKOFF_AT',shadowPrediction.kickoff_at)) throw new Error('STEP8_SETTLEMENT_MUST_FOLLOW_KICKOFF');
  if (verifiedMarketClv!==null && !Number.isFinite(verifiedMarketClv)) throw new Error('STEP8_MARKET_CLV_INVALID');
  const eps=1e-15;
  const loss=(p)=>({brier:(p-outcome)**2,log_loss:-(outcome*Math.log(Math.max(eps,p))+(1-outcome)*Math.log(Math.max(eps,1-p)))});
  const baselineLoss=loss(shadowPrediction.baseline.probability);
  const shadowLoss=loss(shadowPrediction.shadow.probability);
  const settlement={
    settlement_version:PATTERN_PROMOTION_SHADOW_VERSION,
    match_id:shadowPrediction.match_id,
    market_key:shadowPrediction.market_key,
    selection:shadowPrediction.selection,
    outcome,
    settled_at:settledAt,
    source_shadow_prediction_fingerprint:shadow_prediction_fingerprint,
    baseline_probability:shadowPrediction.baseline.probability,
    shadow_probability:shadowPrediction.shadow.probability,
    baseline_loss:baselineLoss,
    shadow_loss:shadowLoss,
    verified_market_clv:verifiedMarketClv,
    governance:{shadow_only:true,decision_weight:0,settlement_rewrites_prediction:false}
  };
  return deepFreeze({...settlement,settlement_fingerprint:sha256(settlement)});
}

function mean(values) { return values.reduce((s,v)=>s+v,0)/values.length; }

function ece(rows,key,bins=10) {
  let total=0;
  for (let b=0;b<bins;b+=1) {
    const lo=b/bins, hi=(b+1)/bins;
    const bucket=rows.filter(r=>r[key]>=lo && (b===bins-1?r[key]<=hi:r[key]<hi));
    if (!bucket.length) continue;
    const avgP=mean(bucket.map(r=>r[key]));
    const avgY=mean(bucket.map(r=>r.outcome));
    total+=(bucket.length/rows.length)*Math.abs(avgP-avgY);
  }
  return total;
}

export function evaluatePatternShadow({ settlements, evaluatedAt, minSettledN=SHADOW_MIN_SETTLED_N }) {
  parseTimestamp('STEP8_SHADOW_EVALUATED_AT',evaluatedAt);
  if (!Array.isArray(settlements)) throw new Error('STEP8_SETTLEMENT_ARRAY_REQUIRED');
  const byMatchMarket=new Set();
  for (const row of settlements) {
    const {settlement_fingerprint,...payload}=row ?? {};
    if (!settlement_fingerprint || sha256(payload)!==settlement_fingerprint) throw new Error('STEP8_SETTLEMENT_FINGERPRINT_INVALID');
    const key=`${row.match_id}|${row.market_key}|${row.selection}`;
    if (byMatchMarket.has(key)) throw new Error('STEP8_DUPLICATE_SHADOW_SETTLEMENT');
    byMatchMarket.add(key);
  }
  const n=settlements.length;
  const baseline={n,brier:n?mean(settlements.map(r=>r.baseline_loss.brier)):null,logLoss:n?mean(settlements.map(r=>r.baseline_loss.log_loss)):null,ece:n?ece(settlements,'baseline_probability'):null,clv:0};
  const verifiedClv=settlements.map(r=>r.verified_market_clv).filter(Number.isFinite);
  const shadow={n,brier:n?mean(settlements.map(r=>r.shadow_loss.brier)):null,logLoss:n?mean(settlements.map(r=>r.shadow_loss.log_loss)):null,ece:n?ece(settlements,'shadow_probability'):null,clv:verifiedClv.length===n&&n?mean(verifiedClv):0};
  const enoughN=n>=minSettledN;
  const calibrationNonDegraded=enoughN && shadow.ece<=baseline.ece+SHADOW_MAX_ECE_DEGRADATION;
  const legacyComparison=enoughN?compareChallenger({champion:baseline,challenger:shadow,minN:minSettledN}):{decision:'RETAIN_CHAMPION',reason:'INSUFFICIENT_N'};
  const eligible=enoughN && calibrationNonDegraded && legacyComparison.decision==='ELIGIBLE_FOR_GOVERNANCE_REVIEW';
  const learningProposal=proposeLearningChange({
    errorEvidence:{shadow_n:n,baseline_brier:baseline.brier,shadow_brier:shadow.brier,baseline_log_loss:baseline.logLoss,shadow_log_loss:shadow.logLoss,baseline_ece:baseline.ece,shadow_ece:shadow.ece},
    challengerScore:shadow,
    championScore:baseline,
    modelId:'PATTERN_SHADOW_CHALLENGER'
  });
  const result={
    evaluation_version:PATTERN_PROMOTION_SHADOW_VERSION,
    state:!enoughN?'SHADOW_EVIDENCE_ACCUMULATING':eligible?'ELIGIBLE_FOR_MANUAL_GOVERNANCE_REVIEW_ZERO_WEIGHT':'RETAIN_CHAMPION_SHADOW_NOT_PROVEN',
    evaluated_at:evaluatedAt,
    settled_n:n,
    minimum_settled_n:minSettledN,
    champion:baseline,
    shadow_challenger:shadow,
    gates:{minimum_n:enoughN,brier_better:enoughN&&shadow.brier<baseline.brier,log_loss_better:enoughN&&shadow.logLoss<baseline.logLoss,ece_non_degradation:calibrationNonDegraded,verified_market_benchmark_complete:verifiedClv.length===n&&n>0,existing_champion_challenger_gate:legacyComparison},
    governed_learning_bridge:learningProposal,
    governance:{manual_review_required:eligible,decision_weight:0,automatic_promotion:false,automatic_retuning:false,production_mutation_allowed:false,champion_remains_authoritative:true,p002_changed:false,gate1_to_gate6_ownership_changed:false,capital_effect:'NONE',real_money:'NO'},
    next_stage:eligible?'STEP_9_PATTERN_SHADOW_FORWARD_MONITORING_AND_PROMOTION_APPROVAL':'CONTINUE_SHADOW_OR_RETAIN_CHAMPION'
  };
  return deepFreeze({...result,shadow_evaluation_fingerprint:sha256(result)});
}

export function verifyPatternShadowEvaluation(evaluation) {
  if (!evaluation || evaluation.evaluation_version!==PATTERN_PROMOTION_SHADOW_VERSION) throw new Error('STEP8_EVALUATION_VERSION_INVALID');
  const {shadow_evaluation_fingerprint,...payload}=evaluation;
  if (!shadow_evaluation_fingerprint || sha256(payload)!==shadow_evaluation_fingerprint) throw new Error('STEP8_EVALUATION_FINGERPRINT_INVALID');
  if (evaluation.governance?.decision_weight!==0 || evaluation.governance?.automatic_promotion!==false || evaluation.governance?.production_mutation_allowed!==false) throw new Error('STEP8_EVALUATION_PRODUCTION_INFLUENCE_FORBIDDEN');
  if (evaluation.governed_learning_bridge?.autoApply!==false || evaluation.governed_learning_bridge?.productionMutationAllowed!==false) throw new Error('STEP8_GOVERNED_LEARNING_AUTO_APPLY_FORBIDDEN');
  return true;
}
