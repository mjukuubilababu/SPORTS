import crypto from 'node:crypto';
import { buildBidirectionalMatchReasoning, buildScoreDistribution } from './bidirectional-match-reasoning.mjs';
import { mapReasoningToMarketSelection } from './market-mapping.mjs';

const QUALITY_FIELDS=['playerQuality','teamQuality','teamCohesion','tacticalQuality'];
const MATCHUP_CONCEPTS=['POSSESSION_QUALITY','SET_PIECE_MISMATCH','LOW_BLOCK_RESISTANCE','TACTICAL_AMPLIFICATION','TRANSITION_VULNERABILITY','AERIAL_DUEL_DIFFERENTIAL','CHANCE_QUALITY_VS_VOLUME','COHESION_UNDER_PRESSURE'];

function clamp(x,min=0,max=1){return Math.max(min,Math.min(max,x));}
function deepFreeze(x){if(x&&typeof x==='object'){for(const v of Object.values(x))deepFreeze(v);Object.freeze(x);}return x;}
function stable(x){if(Array.isArray(x))return x.map(stable);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])]));return x;}
function hash(x){return crypto.createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');}
function timestamp(x,name){const ms=Date.parse(x);if(!Number.isFinite(ms))throw new Error(name+'_INVALID');return ms;}
function finite01(x){return Number.isFinite(x)&&x>=0&&x<=1;}
function weighted(prior,current,pw,cw){if(!Number.isFinite(prior)&&!Number.isFinite(current))return null;if(!Number.isFinite(prior))return current;if(!Number.isFinite(current))return prior;return prior*pw+current*cw;}

export function buildIndependentTeamState({
 teamId,asOf,currentSeasonSample=0,previousSeason={},currentSeason={},transfers=0,managerSystemChange=0,
 preseason={},xiConfidence=null,evidence=[]
}){
 if(!teamId||!asOf)throw new Error('TEAM_STATE_IDENTITY_REQUIRED');
 if(!Number.isInteger(currentSeasonSample)||currentSeasonSample<0)throw new Error('CURRENT_SEASON_SAMPLE_INVALID');
 if(xiConfidence!==null&&!finite01(xiConfidence))throw new Error('XI_CONFIDENCE_INVALID');
 const evidenceRows=evidence.map(row=>{
  if(!row?.source||!row?.observedAt||row.verified!==true)throw new Error('TEAM_STATE_PROVENANCE_REQUIRED');
  if(timestamp(row.observedAt,'TEAM_EVIDENCE_OBSERVED_AT')>timestamp(asOf,'TEAM_STATE_AS_OF'))throw new Error('TEAM_STATE_FUTURE_EVIDENCE');
  if(/psycholog|momentum|morale|panic/i.test(row.type??'')&&row.observableProxy!==true)throw new Error('UNOBSERVABLE_PSYCHOLOGY_FORBIDDEN');
  return {...row};
 });
 const maturity=clamp(currentSeasonSample/10),currentSeasonWeight=maturity,priorWeight=1-maturity;
 const preseasonWeight=currentSeasonSample<5?0.1*(1-maturity):0;
 const keys=new Set([...Object.keys(previousSeason),...Object.keys(currentSeason),...Object.keys(preseason),...QUALITY_FIELDS]);
 const metrics={};
 for(const key of keys){
  let value=weighted(previousSeason[key],currentSeason[key],priorWeight,currentSeasonWeight);
  if(Number.isFinite(preseason[key])&&preseasonWeight>0)value=Number.isFinite(value)?value*(1-preseasonWeight)+preseason[key]*preseasonWeight:preseason[key];
  metrics[key]=Number.isFinite(value)?value:null;
 }
 for(const field of QUALITY_FIELDS)if(!(field in metrics))metrics[field]=null;
 const present=Object.values(metrics).filter(Number.isFinite).length;
 const dataCompleteness=keys.size?present/Math.max(keys.size,1):0;
 const earlySeasonPenalty=clamp((1-maturity)*0.5+(xiConfidence===null?0.15:(1-xiConfidence)*0.2));
 const stateUncertainty=clamp(1-(0.55*maturity+0.25*dataCompleteness+0.2*(xiConfidence??0)));
 return deepFreeze({teamId,asOf,sample_size:currentSeasonSample,prior_weight:priorWeight,current_season_weight:currentSeasonWeight,
  preseason_weight:preseasonWeight,early_season_penalty:earlySeasonPenalty,state_uncertainty:stateUncertainty,
  xi_confidence:xiConfidence,data_completeness:dataCompleteness,transfer_adjustment:Number.isFinite(transfers)?transfers:null,
  manager_system_adjustment:Number.isFinite(managerSystemChange)?managerSystemChange:null,metrics,evidence:evidenceRows,
  quality_separation:{PLAYER_QUALITY:metrics.playerQuality,TEAM_QUALITY:metrics.teamQuality,TEAM_COHESION:metrics.teamCohesion,TACTICAL_QUALITY:metrics.tacticalQuality}});
}

export function buildMatchupAudit(teamAState,teamBState,conceptEvidence={},asOf=null){
 const concepts={};
 for(const concept of MATCHUP_CONCEPTS){
  const row=conceptEvidence[concept]??null;
  if(row?.observedAt&&asOf&&timestamp(row.observedAt,'MATCHUP_EVIDENCE_OBSERVED_AT')>timestamp(asOf,'MATCHUP_AUDIT_AS_OF'))throw new Error('MATCHUP_EVIDENCE_AFTER_FREEZE');
  concepts[concept]=row&&finite01(row.confidence)&&Number.isFinite(row.differential)&&row.source&&row.observedAt
    ? {status:'OBSERVED',differential:clamp(row.differential,-1,1),confidence:row.confidence,source:row.source,observedAt:row.observedAt}
    : {status:'UNKNOWN',differential:null,confidence:0,source:null,observedAt:null};
 }
 return deepFreeze({team_a:teamAState.teamId,team_b:teamBState.teamId,concepts,
  possession_quality_not_control:true,player_quality_not_team_quality:true,team_quality_not_cohesion:true,cohesion_not_tactical_quality:true});
}

function worldPartition(row){
 if(row.homeGoals>row.awayGoals&&row.homeGoals>=2&&row.homeGoals-row.awayGoals>=2)return'HOME_DOMINANCE';
 if(row.awayGoals>row.homeGoals&&row.awayGoals>=2&&row.awayGoals-row.homeGoals>=2)return'AWAY_UPSET';
 if(row.homeGoals>=1&&row.awayGoals>=1&&row.totalGoals>=3)return'COMPETITIVE_SCORING';
 if(row.totalGoals<=2)return'LOW_EVENT_RESISTANCE';
 return'RESIDUAL_BALANCED';
}
export function buildMatchWorlds(distribution){
 const map=new Map();
 for(const row of distribution.rows){const key=worldPartition(row);const list=map.get(key)??[];list.push(row);map.set(key,list);}
 const worlds=[...map.entries()].map(([world,rows])=>({world,probability:rows.reduce((s,r)=>s+r.probability,0),score_family:[...rows].sort((a,b)=>b.probability-a.probability).slice(0,5).map(r=>`${r.homeGoals}-${r.awayGoals}`)})).sort((a,b)=>b.probability-a.probability||a.world.localeCompare(b.world));
 const sum=worlds.reduce((s,w)=>s+w.probability,0);if(Math.abs(sum-1)>1e-9)throw new Error('WORLD_MASS_INCOHERENT');
 return deepFreeze(worlds);
}

function selectionOutcome(component,row){
 const line=component.line;
 const allowedSelections={
  '1X2_FULL_TIME':['HOME','DRAW','AWAY'],'DOUBLE_CHANCE_FULL_TIME':['1X','X2','12'],'DRAW_NO_BET_FULL_TIME':['HOME','AWAY'],
  'TOTAL_GOALS_OVER_UNDER_FULL_TIME':['OVER','UNDER'],'HOME_TEAM_OVER_UNDER_FULL_TIME':['OVER','UNDER'],'AWAY_TEAM_OVER_UNDER_FULL_TIME':['OVER','UNDER'],
  'BTTS_FULL_TIME':['YES','NO'],'CLEAN_SHEET_HOME':['YES','NO'],'CLEAN_SHEET_AWAY':['YES','NO'],'ODD_EVEN_FULL_TIME':['ODD','EVEN'],
  'TEAM_TO_SCORE_4WAY_FULL_TIME':['BOTH','HOME_ONLY','AWAY_ONLY','NEITHER']
 };
 if(allowedSelections[component.marketFamily]&&!allowedSelections[component.marketFamily].includes(component.selection))return'UNSUPPORTED';
 if(['TOTAL_GOALS_OVER_UNDER_FULL_TIME','HOME_TEAM_OVER_UNDER_FULL_TIME','AWAY_TEAM_OVER_UNDER_FULL_TIME'].includes(component.marketFamily)&&(!Number.isFinite(line)||line<0||!Number.isInteger(line*2)))return'UNSUPPORTED';
 if(component.marketFamily==='CORRECT_SCORE_FULL_TIME'&&!/^\d+-\d+$/.test(String(component.selection)))return'UNSUPPORTED';
 if(component.marketFamily==='TOTAL_GOALS_EXACT_FULL_TIME'&&(!Number.isInteger(Number(component.selection))||Number(component.selection)<0))return'UNSUPPORTED';
 switch(component.marketFamily){
  case'1X2_FULL_TIME':return ({HOME:row.homeGoals>row.awayGoals,DRAW:row.homeGoals===row.awayGoals,AWAY:row.homeGoals<row.awayGoals})[component.selection]?'WIN':'LOSS';
  case'DOUBLE_CHANCE_FULL_TIME':return ({'1X':row.homeGoals>=row.awayGoals,'X2':row.awayGoals>=row.homeGoals,'12':row.homeGoals!==row.awayGoals})[component.selection]?'WIN':'LOSS';
  case'DRAW_NO_BET_FULL_TIME':if(row.homeGoals===row.awayGoals)return'PUSH';return component.selection==='HOME'?(row.homeGoals>row.awayGoals?'WIN':'LOSS'):(row.awayGoals>row.homeGoals?'WIN':'LOSS');
  case'TOTAL_GOALS_OVER_UNDER_FULL_TIME':if(Number.isInteger(line)&&row.totalGoals===line)return'PUSH';return component.selection==='OVER'?(row.totalGoals>line?'WIN':'LOSS'):(row.totalGoals<line?'WIN':'LOSS');
  case'HOME_TEAM_OVER_UNDER_FULL_TIME':if(Number.isInteger(line)&&row.homeGoals===line)return'PUSH';return component.selection==='OVER'?(row.homeGoals>line?'WIN':'LOSS'):(row.homeGoals<line?'WIN':'LOSS');
  case'AWAY_TEAM_OVER_UNDER_FULL_TIME':if(Number.isInteger(line)&&row.awayGoals===line)return'PUSH';return component.selection==='OVER'?(row.awayGoals>line?'WIN':'LOSS'):(row.awayGoals<line?'WIN':'LOSS');
  case'BTTS_FULL_TIME':return (component.selection==='YES'?(row.homeGoals>0&&row.awayGoals>0):(row.homeGoals===0||row.awayGoals===0))?'WIN':'LOSS';
  case'CLEAN_SHEET_HOME':return (component.selection==='YES'?row.awayGoals===0:row.awayGoals>0)?'WIN':'LOSS';
  case'CLEAN_SHEET_AWAY':return (component.selection==='YES'?row.homeGoals===0:row.homeGoals>0)?'WIN':'LOSS';
  case'CORRECT_SCORE_FULL_TIME':{const [h,a]=String(component.selection).split('-').map(Number);return row.homeGoals===h&&row.awayGoals===a?'WIN':'LOSS';}
  case'TOTAL_GOALS_EXACT_FULL_TIME':return row.totalGoals===Number(component.selection)?'WIN':'LOSS';
  case'ODD_EVEN_FULL_TIME':return ((row.totalGoals%2===1?'ODD':'EVEN')===component.selection)?'WIN':'LOSS';
  case'TEAM_TO_SCORE_4WAY_FULL_TIME':{const result=row.homeGoals>0&&row.awayGoals>0?'BOTH':row.homeGoals>0?'HOME_ONLY':row.awayGoals>0?'AWAY_ONLY':'NEITHER';return result===component.selection?'WIN':'LOSS';}
  case'MULTIGOALS_FULL_TIME':{const bounds=String(component.selection??'').match(/^(\d+)-(\d+)$/);const min=component.minGoals??(bounds?Number(bounds[1]):null),max=component.maxGoals??(bounds?Number(bounds[2]):null);return Number.isInteger(min)&&min>=0&&Number.isInteger(max)&&max>=min?(row.totalGoals>=min&&row.totalGoals<=max?'WIN':'LOSS'):'UNSUPPORTED';}
  default:return'UNSUPPORTED';
 }
}
function selectionPredicate(component){return selectionOutcome(component,{homeGoals:0,awayGoals:0,totalGoals:0})==='UNSUPPORTED'?null:(row=>selectionOutcome(component,row)==='WIN');}
function distributionMass(distribution,component,outcome){return distribution.rows.reduce((s,row)=>s+(selectionOutcome(component,row)===outcome?row.probability:0),0);}
function componentWithinDistributionSupport(distribution,component){const maxHome=Math.max(...distribution.rows.map(row=>row.homeGoals)),maxAway=Math.max(...distribution.rows.map(row=>row.awayGoals)),maxTotal=maxHome+maxAway;if(component.marketFamily==='CORRECT_SCORE_FULL_TIME'){const [home,away]=String(component.selection).split('-').map(Number);return home<=maxHome&&away<=maxAway;}if(component.marketFamily==='TOTAL_GOALS_EXACT_FULL_TIME')return Number(component.selection)<=maxTotal;if(component.marketFamily==='MULTIGOALS_FULL_TIME'){const bounds=String(component.selection??'').match(/^(\d+)-(\d+)$/);const max=component.maxGoals??(bounds?Number(bounds[2]):null);return Number.isInteger(max)&&max<=maxTotal;}return true;}
function distributionProbability(distribution,component){if(!componentWithinDistributionSupport(distribution,component))return null;const probe=selectionOutcome(component,distribution.rows[0]);if(probe==='UNSUPPORTED')return null;const win=distributionMass(distribution,component,'WIN'),loss=distributionMass(distribution,component,'LOSS'),push=distributionMass(distribution,component,'PUSH');return push>0&&win+loss>0?win/(win+loss):win;}

export function recomputeJointSelection(distribution,components,{jointOdds=null,jointMarketProbability=null}={}){
 if(!Array.isArray(components)||components.length<2)throw new Error('JOINT_COMPONENTS_REQUIRED');
 const predicates=components.map(selectionPredicate);if(predicates.some(x=>x===null))return deepFreeze({status:'UNSUPPORTED',component_probabilities:components.map(()=>null),dependency:'UNKNOWN',joint_probability:null,joint_push_probability:null,joint_market_probability:null,joint_edge:null,confidence:0});
 const componentProbabilities=components.map(c=>distributionProbability(distribution,c));
 const jointUnconditionalWinProbability=distribution.rows.reduce((s,r)=>s+(components.every(component=>selectionOutcome(component,r)==='WIN')?r.probability:0),0);
 const jointPushProbability=distribution.rows.reduce((s,r)=>{const states=components.map(component=>selectionOutcome(component,r));return s+(states.includes('PUSH')&&!states.includes('LOSS')?r.probability:0);},0);
 const jointProbability=jointPushProbability<1?jointUnconditionalWinProbability/(1-jointPushProbability):null;
 const activeMass=1-jointPushProbability;
 const jointConditionedComponentProbabilities=activeMass>0?components.map(component=>distribution.rows.reduce((s,row)=>{const states=components.map(item=>selectionOutcome(item,row));const jointPush=states.includes('PUSH')&&!states.includes('LOSS');return s+(!jointPush&&selectionOutcome(component,row)==='WIN'?row.probability:0);},0)/activeMass):components.map(()=>null);
 const independentProduct=jointConditionedComponentProbabilities.every(Number.isFinite)?jointConditionedComponentProbabilities.reduce((p,x)=>p*x,1):null;
 const dependency=jointProbability===null||independentProduct===null?null:jointProbability-independentProduct;
 const rawJoint=jointMarketProbability??(jointOdds>1?1/jointOdds:null);
 return deepFreeze({status:'MODELLED',component_probabilities:componentProbabilities,joint_conditioned_component_probabilities:jointConditionedComponentProbabilities,dependency,joint_probability:jointProbability,joint_unconditional_win_probability:jointUnconditionalWinProbability,joint_push_probability:jointPushProbability,
  joint_market_probability:rawJoint,joint_edge:rawJoint===null||jointProbability===null?null:jointProbability-rawJoint,confidence:dependency===null?0:clamp(1-Math.abs(dependency))});
}

export function devigMarketObservations(observations,frozenAt,kickoffAt){
 const freeze=timestamp(frozenAt,'FROZEN_AT'),kickoff=timestamp(kickoffAt,'KICKOFF_AT');if(freeze>=kickoff)throw new Error('SIGNAL_NOT_PREMATCH');
 const copied=observations.map((o,index)=>{
  const provenanceReady=Boolean(o.provider&&o.source&&o.observedAt&&o.marketSnapshotId);
  if(provenanceReady&&timestamp(o.observedAt,'MARKET_OBSERVED_AT')>freeze)throw new Error('MARKET_OBSERVATION_AFTER_FREEZE');
  return {...o,observationIndex:index,market_raw_probability:o.odds>1?1/o.odds:null,provenance_ready:provenanceReady};
 });
 const groups=new Map();for(const o of copied){const key=o.marketGroupId&&o.provider&&o.marketSnapshotId&&o.observedAt?`${o.marketGroupId}|${o.provider}|${o.marketSnapshotId}|${o.observedAt}`:null;if(key){const rows=groups.get(key)??[];rows.push(o);groups.set(key,rows);}}
 for(const rows of groups.values()){if(rows.every(x=>x.completeMarket===true&&x.market_raw_probability!==null)){const z=rows.reduce((s,x)=>s+x.market_raw_probability,0);for(const row of rows)row.market_fair_probability=row.market_raw_probability/z;}}
 return deepFreeze(copied.map(o=>({...o,market_fair_probability:Number.isFinite(o.market_fair_probability)?o.market_fair_probability:null})));
}

export function appendMarketObservation(history,observation){
 const next=[...history.map(x=>stable(x)),stable(observation)];
 const ids=next.map(x=>x.observationId);if(ids.some(x=>!x)||new Set(ids).size!==ids.length)throw new Error('MARKET_OBSERVATION_IDENTITY_CONFLICT');
 return deepFreeze(next);
}

export function buildMarketConsistencyGraph(observations){
 const find=(family,selection,line=null)=>observations.find(o=>o.marketFamily===family&&o.selection===selection&&(line===null||Number(o.line)===line));
 const contradictions=[];
 const over25=find('TOTAL_GOALS_OVER_UNDER_FULL_TIME','OVER',2.5),btts=find('BTTS_FULL_TIME','YES');
 if((over25?.market_fair_probability??0)>=0.65&&(btts?.market_fair_probability??1)<=0.50)contradictions.push({contradiction_type:'TOTAL_HIGH_BTTS_LOW',severity:clamp((over25.market_fair_probability-btts.market_fair_probability)*2),supporting_evidence:[over25.observationId,btts.observationId],possible_explanations:['ASYMMETRIC_SCORING_EXPECTATION','CLEAN_SHEET_FAVOURITE_WORLD'],confidence:Math.min(over25.provenance_ready?1:0,btts.provenance_ready?1:0)});
 const home=find('1X2_FULL_TIME','HOME'),home15=find('HOME_TEAM_OVER_UNDER_FULL_TIME','OVER',1.5);
 if((home?.market_fair_probability??0)>=0.70&&(home15?.market_fair_probability??1)<=0.50)contradictions.push({contradiction_type:'HOME_WIN_VS_HOME_SCORING',severity:clamp((home.market_fair_probability-home15.market_fair_probability)*2),supporting_evidence:[home.observationId,home15.observationId],possible_explanations:['LOW_MARGIN_HOME_WIN','PRICE_OR_LIQUIDITY_DIFFERENCE','LINEUP_UNCERTAINTY'],confidence:Math.min(home.provenance_ready?1:0,home15.provenance_ready?1:0)});
 return deepFreeze({nodes:observations.map(o=>o.observationId),edges:contradictions,trap_claim_made:false});
}

function candidateKey(x){return `${x.marketFamily}|${x.selection}|${x.line??''}`;}
export function rankFullMarketCandidates({reasoning,distribution,selections,observations,teamAState,teamBState,modelConfidence=1,worlds,contradictions}){
 const obsByKey=new Map();for(const observation of observations){const key=candidateKey(observation);if(obsByKey.has(key))throw new Error('AMBIGUOUS_MARKET_SELECTION_OBSERVATION');obsByKey.set(key,observation);}
 const completeness=(teamAState.data_completeness+teamBState.data_completeness)/2;
 const earlyPenalty=(teamAState.early_season_penalty+teamBState.early_season_penalty)/2;
 const xi=Math.min(teamAState.xi_confidence??0.5,teamBState.xi_confidence??0.5);
 const maxContradiction=contradictions.reduce((m,x)=>Math.max(m,x.severity),0);
 const rows=selections.map(selection=>{
  const mapped=mapReasoningToMarketSelection(reasoning,selection);const fallbackProbability=distributionProbability(distribution,selection);const modelProbability=mapped.status==='MODELLED'?mapped.modelProbability:fallbackProbability;const obs=obsByKey.get(candidateKey(selection));
  if(!Number.isFinite(modelProbability))return {...selection,classification:'UNSUPPORTED',model_probability:null,fair_market_probability:null,edge:null,confidence:0,tier:'UNSUPPORTED',supporting_worlds:[],supporting_evidence:[],contradicting_evidence:[]};
  const fair=obs?.market_fair_probability??null,edge=fair===null?null:modelProbability-fair;
  const provenance=obs?.provenance_ready===true;
  const confidence=clamp(modelConfidence*completeness*(1-earlyPenalty)*xi*(1-0.5*maxContradiction));
  const eligible=provenance&&edge!==null&&edge>0&&confidence>=0.20;
  const score=eligible?(0.30*modelProbability+0.40*clamp(edge*5)+0.30*confidence):-Infinity;
  return {...selection,classification:eligible?'CANDIDATE':(provenance?'ABSTAIN':'ABSTAIN_MISSING_PROVENANCE'),model_probability:modelProbability,
   market_raw_probability:obs?.market_raw_probability??null,fair_market_probability:fair,edge,uncertainty_adjusted_edge:edge===null?null:edge*confidence,
   confidence,score,tier:eligible?'PENDING_RANK':'ABSTAIN',supporting_worlds:worlds.filter(w=>w.probability>=0.10).slice(0,3).map(w=>w.world),
   supporting_evidence:obs?[obs.observationId]:[],contradicting_evidence:contradictions.flatMap(x=>x.supporting_evidence)};
 }).sort((a,b)=>(b.score-a.score)||candidateKey(a).localeCompare(candidateKey(b)));
 let n=0;for(const row of rows){if(row.classification==='CANDIDATE'){n++;row.tier=n===1?'PRIMARY':n===2?'SECONDARY':n===3?'THIRD':'ALTERNATIVE';}}
 return deepFreeze(rows);
}

export function buildFullMarketInference({
 eventId,analysisTimestamp,kickoffAt,homeTeam,awayTeam,homeLambda,awayLambda,teamAState,teamBState,matchupConceptEvidence={},
 marketObservations=[],marketSelections=[],modelVersion,featureVersion,marketSnapshotId,frozenAt,modelConfidence=1
}){
 if(!eventId||!modelVersion||!featureVersion||!marketSnapshotId)throw new Error('INFERENCE_IDENTITY_REQUIRED');
 if(timestamp(analysisTimestamp,'ANALYSIS_TIMESTAMP')>timestamp(frozenAt,'FROZEN_AT'))throw new Error('ANALYSIS_AFTER_FREEZE');
 const freezeMs=timestamp(frozenAt,'FROZEN_AT');if(timestamp(teamAState?.asOf,'TEAM_A_STATE_AS_OF')>freezeMs||timestamp(teamBState?.asOf,'TEAM_B_STATE_AS_OF')>freezeMs)throw new Error('TEAM_STATE_AFTER_FREEZE');
 const reasoning=buildBidirectionalMatchReasoning({eventId,homeTeam,awayTeam,homeLambda,awayLambda});
 const distribution=buildScoreDistribution({homeLambda,awayLambda});
 const selectedObservations=devigMarketObservations(marketObservations.filter(observation=>observation.marketSnapshotId===marketSnapshotId),frozenAt,kickoffAt);
 const observations=selectedObservations;
 const graph=buildMarketConsistencyGraph(selectedObservations),worlds=buildMatchWorlds(distribution);
 const candidates=rankFullMarketCandidates({reasoning,distribution,selections:marketSelections,observations:selectedObservations,teamAState,teamBState,modelConfidence,worlds,contradictions:graph.edges});
 const eligible=candidates.filter(x=>x.classification==='CANDIDATE');
 const abstainReasons=[];if(!eligible.length)abstainReasons.push('NO_EVIDENCE_GATED_VALUE_CANDIDATE');
 if(teamAState.xi_confidence===null||teamBState.xi_confidence===null)abstainReasons.push('XI_UNCERTAIN');
 if(observations.some(x=>!x.provenance_ready))abstainReasons.push('MARKET_PROVENANCE_MISSING');
 const core={event_id:eventId,analysis_timestamp:analysisTimestamp,team_a_state:teamAState,team_b_state:teamBState,
  matchup_audit:buildMatchupAudit(teamAState,teamBState,matchupConceptEvidence,frozenAt),data_completeness:(teamAState.data_completeness+teamBState.data_completeness)/2,
  sample_size:{team_a:teamAState.sample_size,team_b:teamBState.sample_size},early_season_penalty:(teamAState.early_season_penalty+teamBState.early_season_penalty)/2,
  expected_home_goals:homeLambda,expected_away_goals:awayLambda,expected_total_goals:homeLambda+awayLambda,
  home_probability:reasoning.matchReality.homeWin,draw_probability:reasoning.matchReality.draw,away_probability:reasoning.matchReality.awayWin,
  match_worlds:worlds,market_probabilities:candidates.map(x=>({market:x.marketFamily,selection:x.selection,line:x.line??null,probability:x.model_probability,status:x.classification==='UNSUPPORTED'?'UNSUPPORTED':'MODELLED'})),
  market_observations:observations,market_contradictions:graph.edges,candidate_outcomes:candidates,primary_candidate:eligible[0]??null,
  secondary_candidates:eligible.slice(1),abstain_reasons:abstainReasons,model_version:modelVersion,feature_version:featureVersion,market_snapshot_id:marketSnapshotId,frozen_at:frozenAt,
  governance:{bookmaker_price_is_not_prediction:true,existing_gates_required:true,prediction_weight:0,capital_effect:'NONE',real_money:'NO'}};
 const signalId='fmi_'+hash(core).slice(0,24);return deepFreeze({...core,signal_id:signalId,immutable:true,fingerprint:hash({...core,signal_id:signalId})});
}

export function settleSystemSignalAndUserExecution({systemSignal,userExecution,homeScore,awayScore,settledAt}){
 if(!systemSignal?.immutable)throw new Error('IMMUTABLE_SYSTEM_SIGNAL_REQUIRED');
 if(!Number.isInteger(homeScore)||homeScore<0||!Number.isInteger(awayScore)||awayScore<0)throw new Error('FINAL_SCORE_INVALID');
 const row={homeGoals:homeScore,awayGoals:awayScore,totalGoals:homeScore+awayScore};
 const settleComponent=c=>({component:c,status:selectionOutcome(c,row)});
 const systemComponents=systemSignal.components??[systemSignal];
 const userComponents=userExecution?.components??[];
 const systemSettlement=systemComponents.map(settleComponent),userSettlement=userComponents.map(settleComponent);const aggregate=rows=>rows.some(x=>x.status==='LOSS')?'LOSS':rows.some(x=>x.status==='PUSH')?'PUSH':rows.every(x=>x.status==='WIN')?'WIN':'UNSUPPORTED';
 return deepFreeze({signal_id:systemSignal.signal_id,system_signal:{components:systemSettlement,result:aggregate(systemSettlement)},
  user_execution:userExecution?{execution_id:userExecution.execution_id,components:userSettlement,result:aggregate(userSettlement)}:null,
  attribution:userExecution?'COMPONENT_LEVEL_SYSTEM_SIGNAL_SEPARATE_FROM_USER_EXECUTION':'SYSTEM_ONLY',final_score:{home:homeScore,away:awayScore},settled_at:settledAt,no_hindsight:true});
}
