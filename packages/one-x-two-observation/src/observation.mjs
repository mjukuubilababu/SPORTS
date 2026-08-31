import crypto from 'node:crypto';

export const DATASET_TYPE='1X2_REAL_WORLD_OBSERVATION';
export const STATUS='OBSERVATIONAL_ONLY';
const SOURCES=new Set(['REAL_MONEY_USER_SLIP','PAPER_DECISION','SYSTEM_FROZEN_1X2_SIGNAL','EXTERNAL_BENCHMARK']);
const ORIGINS=new Set(['USER_DECISION','SYSTEM_DECISION','BENCHMARK_DECISION']);
const SELECTIONS=new Set(['HOME','DRAW','AWAY']);
const CLASSIFICATIONS=new Set(['DRAW_FAILURE_HIGH_SCORING','DRAW_FAILURE_LOW_EVENT','FAVORITE_WIN_SUCCESS','OUTRIGHT_FAVORITE_UPSET','UNDERDOG_WIN_SUCCESS','DRAW_SUCCESS','UNCLASSIFIED']);
const STATES=new Set(['OBSERVED','ENTRY_VERIFIED','STARTED','SETTLED','CLOSE_VERIFIED','EVALUATED']);

function canonical(value){
  if(Array.isArray(value)) return value.map(canonical);
  if(value&&typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export function fingerprint(value){return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
function iso(value,name){if(value===null)return null;if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw new Error('INVALID_'+name.toUpperCase());return value;}
function nullableString(value,name){if(value===null)return null;if(typeof value!=='string'||value.trim()==='')throw new Error('INVALID_'+name.toUpperCase());return value;}
function outcomeFor(selection,h,a){const result=h===a?'DRAW':h>a?'HOME':'AWAY';return result===selection?'WIN':'LOSS';}

export function normalizeObservation(batch,row){
  if(batch.dataset_type!==DATASET_TYPE||batch.pattern_id!==null)throw new Error('P002_ISOLATION_VIOLATION');
  if(batch.status!==STATUS)throw new Error('OBSERVATIONAL_STATUS_REQUIRED');
  if(!SOURCES.has(batch.observation_source)||!ORIGINS.has(batch.origin_decision))throw new Error('INVALID_ORIGIN');
  if(batch.observation_source==='SYSTEM_FROZEN_1X2_SIGNAL'&&batch.origin_decision==='USER_DECISION')throw new Error('SETTLED_USER_OBSERVATION_CANNOT_BECOME_FROZEN_SIGNAL');
  if(batch.provider!=='BetPawa')throw new Error('INITIAL_PROVIDER_MUST_BE_BETPAWA');
  if(!SELECTIONS.has(row.selection)||!CLASSIFICATIONS.has(row.failure_classification))throw new Error('INVALID_OBSERVATION_ENUM');
  if(typeof row.entry_odds!=='number'||row.entry_odds<=1)throw new Error('INVALID_ENTRY_ODDS');
  const kickoff=iso(row.kickoff_at,'kickoff_at'), entryAt=iso(row.entry_observed_at,'entry_observed_at');
  if(batch.ingestion_timing==='PRE_KICKOFF_VERIFIED'&&(!kickoff||!entryAt||Date.parse(entryAt)>=Date.parse(kickoff)))throw new Error('PREMATCH_ENTRY_NOT_VERIFIED');
  if(batch.ingestion_timing==='POST_EVENT_ARCHIVAL'&&entryAt!==null)throw new Error('ARCHIVE_CANNOT_CLAIM_ENTRY_TIMESTAMP');
  const closingAt=iso(row.closing_observed_at,'closing_observed_at');
  let clv=null;
  const hasClose=row.closing_odds!==null||row.closing_provider!==null||closingAt!==null||row.closing_verified===true;
  if(hasClose){
    if(!row.closing_verified||typeof row.closing_odds!=='number'||row.closing_odds<=1)throw new Error('CLOSE_NOT_VERIFIED');
    if(row.closing_provider!==row.entry_provider)throw new Error('CROSS_PROVIDER_CLV_REJECTED');
    if(!kickoff||!closingAt||Date.parse(closingAt)>=Date.parse(kickoff))throw new Error('POST_KICKOFF_CLOSE_REJECTED');
    clv=(row.entry_odds/row.closing_odds)-1;
  }
  if(!Number.isInteger(row.home_score)||row.home_score<0||!Number.isInteger(row.away_score)||row.away_score<0)throw new Error('INVALID_SETTLEMENT');
  if(outcomeFor(row.selection,row.home_score,row.away_score)!==row.outcome)throw new Error('OUTCOME_MISMATCH');
  const immutable={
    observation_id:row.observation_id,batch_id:batch.batch_id,dataset_type:DATASET_TYPE,status:STATUS,
    observation_source:batch.observation_source,origin_decision:batch.origin_decision,ingestion_timing:batch.ingestion_timing,
    provider:batch.provider,event_id:nullableString(row.event_id,'event_id'),competition:nullableString(row.competition,'competition'),
    season:nullableString(row.season,'season'),home_team:row.home_team,away_team:row.away_team,selection:row.selection,
    entry_odds:row.entry_odds,entry_provider:row.entry_provider,entry_observed_at:entryAt,kickoff_at:kickoff,
    system_probability:null,confidence:null,prematch_signal_id:null
  };
  const normalized={...immutable,implied_entry_probability:1/row.entry_odds,closing_odds:row.closing_odds,
    closing_provider:row.closing_provider,closing_observed_at:closingAt,closing_verified:row.closing_verified,
    clv,home_score:row.home_score,away_score:row.away_score,outcome:row.outcome,
    failure_classification:row.failure_classification,state:hasClose?'EVALUATED':'SETTLED',
    favorite_rank:null,trap_flag:null,market_context:null,created_at:batch.created_at};
  if(!STATES.has(normalized.state))throw new Error('INVALID_STATE');
  return Object.freeze({...normalized,identity_fingerprint:fingerprint(immutable),payload_fingerprint:fingerprint(normalized)});
}

export function verifyClose(observation,close){
  if(observation.state!=='SETTLED'&&observation.state!=='STARTED')throw new Error('INVALID_CLOSE_TRANSITION');
  if(close.provider!==observation.entry_provider)throw new Error('CROSS_PROVIDER_CLV_REJECTED');
  if(!observation.kickoff_at||!close.observed_at||Date.parse(close.observed_at)>=Date.parse(observation.kickoff_at))throw new Error('POST_KICKOFF_CLOSE_REJECTED');
  if(typeof close.odds!=='number'||close.odds<=1)throw new Error('CLOSE_NOT_VERIFIED');
  return Object.freeze({...observation,closing_odds:close.odds,closing_provider:close.provider,closing_observed_at:close.observed_at,closing_verified:true,clv:(observation.entry_odds/close.odds)-1,state:'EVALUATED'});
}

export function createCounterfactualReplay(observation,input){
  if(!observation.event_id||!observation.kickoff_at)throw new Error('REPLAY_REQUIRES_VERIFIED_EVENT');
  if(input.event_id!==observation.event_id)throw new Error('CROSS_EVENT_REPLAY_REJECTED');
  if(!input.cutoff_at||Date.parse(input.cutoff_at)>Date.parse(observation.kickoff_at))throw new Error('REPLAY_CUTOFF_AFTER_KICKOFF');
  if(['final_score','settlement','post_kickoff','future_articles'].some(k=>input.inputs?.[k]!=null))throw new Error('COUNTERFACTUAL_LEAKAGE_REJECTED');
  if(!new Set(['HOME','DRAW','AWAY','ABSTAIN']).has(input.decision))throw new Error('INVALID_REPLAY_DECISION');
  const ps=input.probabilities;if(!ps||!['home','draw','away'].every(k=>typeof ps[k]==='number'&&ps[k]>=0&&ps[k]<=1)||Math.abs(ps.home+ps.draw+ps.away-1)>1e-9)throw new Error('INVALID_REPLAY_PROBABILITIES');
  return Object.freeze({replay_id:input.replay_id,observation_id:observation.observation_id,event_id:observation.event_id,cutoff_at:input.cutoff_at,decision:input.decision,probabilities:ps,confidence:input.confidence??null,flags:input.flags??[],input_fingerprint:fingerprint(input.inputs??{}),created_at:input.created_at});
}

export function evaluateBatch(batch){
  const observations=batch.observations.map(row=>normalizeObservation(batch,row));
  const wins=observations.filter(x=>x.outcome==='WIN').length,losses=observations.length-wins;
  const odds=observations.map(x=>x.entry_odds).sort((a,b)=>a-b);
  const implied=observations.map(x=>x.implied_entry_probability);
  return Object.freeze({batch_id:batch.batch_id,dataset_type:DATASET_TYPE,status:STATUS,n:observations.length,wins,losses,hit_rate:wins/observations.length,
    average_entry_odds:odds.reduce((a,b)=>a+b,0)/odds.length,median_entry_odds:odds[Math.floor(odds.length/2)],
    bookmaker_implied_probability_benchmark_mean:implied.reduce((a,b)=>a+b,0)/implied.length,
    brier:null,log_loss:null,metric_note:'Brier/log-loss unavailable: no verified pre-match system probabilities.',clv_n:observations.filter(x=>x.clv!==null).length,observations});
}
