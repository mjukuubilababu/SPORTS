import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { discoverPatternCandidates } from '../src/pattern-discovery-candidates.mjs';
import { freezePatternCandidateBatch } from '../src/pattern-candidate-confirmatory-freeze.mjs';
import { evaluatePatternConfirmatoryOutOfSample } from '../src/pattern-confirmatory-out-of-sample-evaluation.mjs';
import { evaluatePatternTemporalContextStability } from '../src/pattern-temporal-context-stability.mjs';
import {
  PATTERN_PROMOTION_SHADOW_VERSION,
  SHADOW_MIN_SETTLED_N,
  SHADOW_MAX_ABS_PROBABILITY_SHIFT,
  createPatternShadowPlan,
  createPatternShadowPrediction,
  settlePatternShadowPrediction,
  evaluatePatternShadow,
  verifyPatternShadowEvaluation
} from '../src/pattern-promotion-shadow-integration.mjs';

function stableStringify(value){if(Array.isArray(value))return`[${value.map(stableStringify).join(',')}]`;if(value&&typeof value==='object')return`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;return JSON.stringify(value);}
function sha256(value){return createHash('sha256').update(stableStringify(value)).digest('hex');}

function observation({matchId,date,subject,opponent,venue,leadSurrender=false,led=true}){
  const payload={feature_version:'BEHAVIORAL_STATE_FEATURES_V0_1',canonical_match_id:matchId,canonical_match_date:date,season:2026,league:'TEST_LEAGUE',subject_team:subject,opponent_team:opponent,venue_side:venue,final_result:'WIN',final_score_for:2,final_score_against:leadSurrender?1:0,led_at_any_time:led,first_lead_minute:led?10:null,lead_surrendered:leadSurrender,uninterrupted_lead_win:led&&!leadSurrender,lead_surrendered_then_recovered_win:led&&leadSurrender,points_dropped_after_leading:false,trailed_at_any_time:!led,first_trailing_minute:led?null:20,equalized_after_trailing:false,comeback_go_ahead:false,recovered_nonloss_after_trailing:false,recovered_win_after_trailing:false,opening_goal_scored:led,opening_goal_conceded:!led,opening_goal_observed:true,late_goal_scored_n:0,late_goal_conceded_n:0,dismissal_for_n:0,dismissal_against_n:0,first_own_dismissal_minute:null,goals_scored_after_own_first_dismissal_n:0,goals_conceded_after_own_first_dismissal_n:0,substitution_n:3,first_substitution_minute:60,goals_scored_by_period:{'0_15':1,'16_30':0,'31_45_PLUS':0,'46_60':0,'61_75':0,'76_90_PLUS':0},goals_conceded_by_period:{'0_15':0,'16_30':0,'31_45_PLUS':0,'46_60':0,'61_75':0,'76_90_PLUS':0},source_timeline_id:`TL-${matchId}`,source_timeline_fingerprint:`TLF-${matchId}`,source_memory_id:`MM-${matchId}`,source_memory_fingerprint:`MMF-${matchId}`,descriptive_only:true,predictive_weight:0};
  return {...payload,observation_fingerprint:sha256(payload)};
}
function pair({matchId,date,home,away,homeLead=false,awayLead=false,homeLed=true,awayLed=true}){return[observation({matchId,date,subject:home,opponent:away,venue:'HOME',leadSurrender:homeLead,led:homeLed}),observation({matchId,date,subject:away,opponent:home,venue:'AWAY',leadSurrender:awayLead,led:awayLed})];}
function corpus(observations,materializedAt){const n=observations.length/2;const payload={corpus_version:'BEHAVIORAL_STATE_FEATURES_V0_1',materialized_at:materializedAt,input_match_pair_n:n,accepted_match_n:n,retained_ineligible_match_n:0,team_observation_n:observations.length,team_profile_n:0,observations,retained_ineligible_inputs:[],profiles:[],governance:{each_eligible_match_creates_both_team_sides:true,outcome_based_deletion_forbidden:true,ineligible_structurally_valid_input_retained:true,tampered_or_cross_match_input_fails_closed:true,feature_layer_is_descriptive_only:true,pattern_discovery_performed_here:false,predictive_weight_assigned:false,automatic_retuning:false,automatic_pattern_promotion:false,market_data_used:false,p002_discovery_min_n:30,p002_changed:false,gate1_to_gate6_ownership_changed:false,capital_effect:'NONE',real_money:'NO'}};return{...payload,corpus_fingerprint:sha256(payload)};}

function buildStep7(){
  const d=[];
  for(let i=0;i<30;i+=1){const date=`2026-01-${String((i%28)+1).padStart(2,'0')}`;const alphaHome=i%2===0;const a={leadSurrender:i%10<8,led:true};const o={leadSurrender:false,led:false};d.push(...pair({matchId:`DS-${i}`,date,home:alphaHome?'ALPHA':`DO-${i}`,away:alphaHome?`DO-${i}`:'ALPHA',homeLead:alphaHome?a.leadSurrender:o.leadSurrender,awayLead:alphaHome?o.leadSurrender:a.leadSurrender,homeLed:alphaHome?a.led:o.led,awayLed:alphaHome?o.led:a.led}));}
  for(let i=0;i<30;i+=1){const date=`2026-02-${String((i%28)+1).padStart(2,'0')}`;const s=i%10<1;d.push(...pair({matchId:`DR-${i}`,date,home:`RH-${i}`,away:`RA-${i}`,homeLead:s,awayLead:s}));}
  const discoveryCorpus=corpus(d,'2026-07-01T12:00:00Z');
  const batch=discoverPatternCandidates({corpus:discoveryCorpus,discoveredAt:'2026-07-02T00:00:00Z',trainingCutoff:'2026-06-30'});
  const freeze=freezePatternCandidateBatch({discoveryBatch:batch,frozenAt:'2026-07-03T12:00:00Z'});
  const o=[];
  for(let i=0;i<30;i+=1){const date=`2026-08-${String(i+1).padStart(2,'0')}`;const alphaHome=i%2===0;const s=i%10<8;o.push(...pair({matchId:`OS-${i}`,date,home:alphaHome?'ALPHA':`OO-${i}`,away:alphaHome?`OO-${i}`:'ALPHA',homeLead:alphaHome?s:false,awayLead:alphaHome?false:s,homeLed:alphaHome?true:false,awayLed:alphaHome?false:true}));}
  for(let i=0;i<30;i+=1){const date=`2026-08-${String(i+1).padStart(2,'0')}`;const s=i%10<1;o.push(...pair({matchId:`OR-${i}`,date,home:`ORH-${i}`,away:`ORA-${i}`,homeLead:s,awayLead:s}));}
  const c=corpus(o,'2026-08-31T12:00:00Z');
  const step6=evaluatePatternConfirmatoryOutOfSample({freeze,discoveryBatch:batch,corpus:c,evaluatedAt:'2026-09-01T00:00:00Z'});
  const step7=evaluatePatternTemporalContextStability({freeze,discoveryBatch:batch,step6Evaluation:step6,corpus:c,evaluatedAt:'2026-09-01T01:00:00Z'});
  assert.ok(step7.pattern_results.some(r=>r.state==='VALIDATED_PATTERN_EVIDENCE_ZERO_WEIGHT'));
  return step7;
}

function calibration(step7,{bookmaker=false}={}){const ids=step7.pattern_results.filter(r=>r.pattern_validated).map(r=>r.pattern_id);return{version:'PATTERN-CAL-V0-TEST',provenance:'SYNTHETIC_TEST_ONLY',verified:true,independent:true,sample_n:60,trained_through:'2026-09-15T00:00:00Z',uses_bookmaker_odds:bookmaker,max_abs_logit_shift:0.35,max_abs_probability_shift:0.10,pattern_coefficients:Object.fromEntries(ids.map(id=>[id,{logit_beta:0.35}]))};}
function readyPlan(){const s=buildStep7();return{step7:s,plan:createPatternShadowPlan({step7Evaluation:s,calibration:calibration(s),createdAt:'2026-10-01T00:00:00Z'})};}
function prediction(plan,i,{baseline=0.55,activate=true}={}){const pid=plan.validated_pattern_ids[0];return createPatternShadowPrediction({plan,baselinePrediction:{match_id:`M-${i}`,market_key:'BINARY_TEST',selection:'YES',probability:baseline,model_version:'CHAMPION-V1',generated_at:'2026-10-01T10:00:00Z'},activations:activate?[{pattern_id:pid,active:true,provenance:'PREMATCH-SYNTHETIC',observed_at:'2026-10-01T09:00:00Z'}]:[],generatedAt:'2026-10-01T10:01:00Z',kickoffAt:'2026-10-01T12:00:00Z'});}
function settled(plan,n,{shadowShouldHelp=true}={}){const rows=[];for(let i=0;i<n;i+=1){const p=prediction(plan,i,{baseline:shadowShouldHelp?0.55:0.75});const outcome=shadowShouldHelp?(i%10<7?1:0):(i%10<5?1:0);rows.push(settlePatternShadowPrediction({shadowPrediction:p,outcome,settledAt:'2026-10-01T14:00:00Z',verifiedMarketClv:shadowShouldHelp?0.01:-0.01}));}return rows;}

test('Step 8 waits when pattern-to-prediction calibration does not exist',()=>{const s=buildStep7();const plan=createPatternShadowPlan({step7Evaluation:s,createdAt:'2026-10-01T00:00:00Z'});assert.equal(PATTERN_PROMOTION_SHADOW_VERSION,'PATTERN_PROMOTION_GOVERNANCE_SHADOW_INTEGRATION_V0_1');assert.equal(plan.state,'SHADOW_PLAN_WAITING_FOR_VALIDATED_PATTERN_OR_CALIBRATION');assert.equal(plan.governance.decision_weight,0);assert.ok(plan.blockers.includes('PATTERN_TO_PREDICTION_CALIBRATION_REQUIRED'));});

test('bookmaker odds cannot be used to create pattern-to-prediction calibration',()=>{const s=buildStep7();const plan=createPatternShadowPlan({step7Evaluation:s,calibration:calibration(s,{bookmaker:true}),createdAt:'2026-10-01T00:00:00Z'});assert.equal(plan.state,'SHADOW_PLAN_WAITING_FOR_VALIDATED_PATTERN_OR_CALIBRATION');assert.ok(plan.blockers.includes('BOOKMAKER_ODDS_FORBIDDEN_FROM_PATTERN_CALIBRATION'));});

test('ready shadow plan keeps champion authoritative and prediction shift capped',()=>{const {plan}=readyPlan();assert.equal(plan.state,'SHADOW_PLAN_READY_ZERO_WEIGHT');const p=prediction(plan,1);assert.equal(p.governance.shadow_only,true);assert.equal(p.governance.production_decision_affected,false);assert.equal(p.baseline.probability,0.55);assert.ok(Math.abs(p.shadow.probability_delta)<=SHADOW_MAX_ABS_PROBABILITY_SHIFT+1e-12);assert.notEqual(p.shadow.probability,p.baseline.probability);});

test('unvalidated or post-kickoff pattern activation fails closed',()=>{const {plan}=readyPlan();assert.throws(()=>createPatternShadowPrediction({plan,baselinePrediction:{match_id:'X',market_key:'B',selection:'Y',probability:0.5,model_version:'V'},activations:[{pattern_id:'NOT-VALIDATED',active:true,provenance:'X',observed_at:'2026-10-01T09:00:00Z'}],generatedAt:'2026-10-01T10:00:00Z',kickoffAt:'2026-10-01T12:00:00Z'}),/STEP8_UNVALIDATED_PATTERN_ACTIVATION_FORBIDDEN/);const pid=plan.validated_pattern_ids[0];assert.throws(()=>createPatternShadowPrediction({plan,baselinePrediction:{match_id:'X2',market_key:'B',selection:'Y',probability:0.5,model_version:'V'},activations:[{pattern_id:pid,active:true,provenance:'X',observed_at:'2026-10-01T12:00:00Z'}],generatedAt:'2026-10-01T10:00:00Z',kickoffAt:'2026-10-01T12:00:00Z'}),/STEP8_POST_KICKOFF_PATTERN_ACTIVATION_FORBIDDEN/);});

test('settlement is separate and must occur after kickoff',()=>{const {plan}=readyPlan();const p=prediction(plan,2);assert.throws(()=>settlePatternShadowPrediction({shadowPrediction:p,outcome:1,settledAt:'2026-10-01T11:00:00Z'}),/STEP8_SETTLEMENT_MUST_FOLLOW_KICKOFF/);const s=settlePatternShadowPrediction({shadowPrediction:p,outcome:1,settledAt:'2026-10-01T14:00:00Z',verifiedMarketClv:0.01});assert.equal(s.governance.settlement_rewrites_prediction,false);assert.equal(s.source_shadow_prediction_fingerprint,p.shadow_prediction_fingerprint);});

test('N=99 remains accumulating and cannot request governed weight change',()=>{const {plan}=readyPlan();const e=evaluatePatternShadow({settlements:settled(plan,99),evaluatedAt:'2026-10-02T00:00:00Z'});assert.equal(SHADOW_MIN_SETTLED_N,100);assert.equal(e.state,'SHADOW_EVIDENCE_ACCUMULATING');assert.equal(e.gates.minimum_n,false);assert.notEqual(e.governed_learning_bridge.decisionWeightChange,'REVIEW_REQUIRED');assert.equal(e.governance.manual_review_required,false);});

test('N=100 shadow that beats champion may become manual-review eligible but remains zero weight',()=>{const {plan}=readyPlan();const e=evaluatePatternShadow({settlements:settled(plan,100),evaluatedAt:'2026-10-02T00:00:00Z'});assert.equal(e.state,'ELIGIBLE_FOR_MANUAL_GOVERNANCE_REVIEW_ZERO_WEIGHT');assert.equal(e.gates.minimum_n,true);assert.equal(e.gates.brier_better,true);assert.equal(e.gates.log_loss_better,true);assert.equal(e.gates.ece_non_degradation,true);assert.equal(e.gates.existing_champion_challenger_gate.decision,'ELIGIBLE_FOR_GOVERNANCE_REVIEW');assert.equal(e.governed_learning_bridge.autoApply,false);assert.equal(e.governed_learning_bridge.productionMutationAllowed,false);assert.equal(e.governance.decision_weight,0);assert.equal(e.governance.automatic_promotion,false);assert.equal(verifyPatternShadowEvaluation(e),true);});

test('worse shadow retains champion even after N=100',()=>{const {plan}=readyPlan();const e=evaluatePatternShadow({settlements:settled(plan,100,{shadowShouldHelp:false}),evaluatedAt:'2026-10-02T00:00:00Z'});assert.equal(e.state,'RETAIN_CHAMPION_SHADOW_NOT_PROVEN');assert.equal(e.governance.champion_remains_authoritative,true);assert.equal(e.governance.decision_weight,0);});

test('tampered shadow evaluation fails closed',()=>{const {plan}=readyPlan();const e=evaluatePatternShadow({settlements:settled(plan,100),evaluatedAt:'2026-10-02T00:00:00Z'});const b=structuredClone(e);b.governance.decision_weight=1;assert.throws(()=>verifyPatternShadowEvaluation(b),/STEP8_EVALUATION_FINGERPRINT_INVALID|STEP8_EVALUATION_PRODUCTION_INFLUENCE_FORBIDDEN/);});
