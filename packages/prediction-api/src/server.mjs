import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { orchestrateModelProbabilities } from '../../intelligence-engine/src/model-probability-orchestrator.mjs';
import { predictLive1X2 } from '../../intelligence-engine/src/live-outcome.mjs';
import { createPostgresPredictionPersistence } from './postgres-persistence.mjs';

const API_VERSION='PREDICTION_HTTP_API_V0_1';
const LIVE_API_VERSION='PREDICTION_LIVE_HTTP_API_V0_1';
const MAX_BODY_BYTES=1024*1024;

function json(res,status,payload){
  const body=JSON.stringify(payload);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'cache-control':'no-store'});
  res.end(body);
}

async function readJson(req){
  let size=0;const chunks=[];
  for await(const chunk of req){
    size+=chunk.length;
    if(size>MAX_BODY_BYTES)throw Object.assign(new Error('REQUEST_BODY_TOO_LARGE'),{statusCode:413});
    chunks.push(chunk);
  }
  if(!chunks.length)throw Object.assign(new Error('JSON_BODY_REQUIRED'),{statusCode:400});
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{throw Object.assign(new Error('INVALID_JSON'),{statusCode:400});}
}

function deepFreeze(value){
  if(!value || typeof value!=='object' || Object.isFrozen(value))return value;
  for(const child of Object.values(value))deepFreeze(child);
  return Object.freeze(value);
}

function publicPrediction(result){
  return {
    apiVersion:API_VERSION,
    state:result.status,
    eventId:result.eventId,
    market:result.market,
    selection:result.selection,
    probability:result.probability ?? null,
    breakEvenProbability:result.breakEvenProbability ?? null,
    ev:result.ev ?? null,
    evidenceMaturity:result.evidenceMaturity ?? null,
    criticalBlocks:result.criticalBlocks ?? [],
    modelFamilyCount:result.familyCount ?? 0,
    inputModelCount:result.inputModelCount ?? 0,
    audit:{
      orchestratorVersion:result.version,
      kickoffAt:result.kickoffAt ?? null,
      families:result.families ?? [],
      modelSnapshots:result.modelSnapshots ?? [],
      governance:result.governance ?? null
    },
    capitalState:'LOCKED',
    realMoney:'NO'
  };
}

function assertLiveApiInput(body){
  if(!body || typeof body!=='object' || Array.isArray(body))throw new Error('LIVE_REQUEST_OBJECT_REQUIRED');
  const {preMatchSnapshot,live}=body;
  if(!preMatchSnapshot || typeof preMatchSnapshot!=='object' || Array.isArray(preMatchSnapshot))throw new Error('PREMATCH_SNAPSHOT_REQUIRED');
  if(!live || typeof live!=='object' || Array.isArray(live))throw new Error('LIVE_STATE_REQUIRED');
  if(!live.eventId)throw new Error('LIVE_EVENT_ID_REQUIRED');
  if(live.eventId!==preMatchSnapshot.eventId)throw new Error('LIVE_EVENT_ID_MISMATCH');
  if(!Array.isArray(live.evidence) || live.evidence.length===0)throw new Error('LIVE_VERIFIED_EVIDENCE_REQUIRED');
  if(!live.evidence.some(item=>item && typeof item==='object' && item.verified===true))throw new Error('LIVE_VERIFIED_EVIDENCE_REQUIRED');
  for(const [name,value] of [
    ['HOME_RATE_MULTIPLIER',body.homeRateMultiplier],
    ['AWAY_RATE_MULTIPLIER',body.awayRateMultiplier],
    ['LIVE_HOME_RATE_MULTIPLIER',live.homeRateMultiplier],
    ['LIVE_AWAY_RATE_MULTIPLIER',live.awayRateMultiplier]
  ]){
    if(value!==undefined && value!==1)throw new Error(`${name}_REQUIRES_SEPARATE_VERIFIED_IMPACT_PIPELINE`);
  }
  return {preMatchSnapshot:deepFreeze(preMatchSnapshot),live};
}

function publicLivePrediction(result){
  return {
    apiVersion:LIVE_API_VERSION,
    state:'LIVE',
    snapshotType:result.snapshotType,
    eventId:result.eventId,
    minute:result.minute,
    score:result.score,
    probabilities:result.probabilities,
    predictedOutcome:result.predictedOutcome,
    confidence:result.confidence,
    mostLikelyFinalScore:result.mostLikelyFinalScore,
    remainingFraction:result.remainingFraction,
    remainingLambdas:{home:result.remainingHomeLambda,away:result.remainingAwayLambda},
    audit:{
      parentSignalId:result.parentSignalId,
      modelVersion:result.modelVersion,
      featureVersion:result.featureVersion,
      observedAt:result.observedAt,
      rateMultipliers:result.rateMultipliers,
      evidence:result.evidence,
      preMatchSnapshotPreserved:result.preMatchSnapshotPreserved,
      governance:{
        preMatchSnapshotImmutable:true,
        arbitraryRateMultiplierOverrideAllowed:false,
        providerPredictionUsed:false,
        bookmakerOddsUsedAsLiveModelInput:false
      }
    },
    capitalState:'LOCKED',
    realMoney:'NO'
  };
}

async function persistIfConfigured(persistence,{requestId,endpoint,input,output}){
  if(!persistence)return null;
  return persistence.persistPrediction({requestId,endpoint,input,output});
}

export function createPredictionApiServer({persistence=null}={}){
  return http.createServer(async(req,res)=>{
    const requestId=String(req.headers['x-request-id'] || randomUUID());
    res.setHeader('x-request-id',requestId);
    res.setHeader('x-persistence-mode',persistence?.mode || 'DISABLED');
    try{
      if(req.method==='GET' && req.url==='/health'){
        if(!persistence){
          return json(res,200,{status:'ok',apiVersion:API_VERSION,liveApiVersion:LIVE_API_VERSION,persistence:{mode:'DISABLED',status:'disabled'},capitalState:'LOCKED',realMoney:'NO'});
        }
        const health=await persistence.healthCheck();
        return json(res,200,{status:'ok',apiVersion:API_VERSION,liveApiVersion:LIVE_API_VERSION,persistence:health,capitalState:'LOCKED',realMoney:'NO'});
      }
      if(req.method==='POST' && req.url==='/v1/predict'){
        const body=await readJson(req);
        const result=orchestrateModelProbabilities(body);
        const output=publicPrediction(result);
        await persistIfConfigured(persistence,{requestId,endpoint:'/v1/predict',input:body,output});
        return json(res,200,output);
      }
      if(req.method==='POST' && req.url==='/v1/predict/live'){
        const body=await readJson(req);
        const {preMatchSnapshot,live}=assertLiveApiInput(body);
        const result=predictLive1X2({
          preMatchSnapshot,
          minute:live.minute,
          homeScore:live.homeScore,
          awayScore:live.awayScore,
          observedAt:live.observedAt,
          regulationMinutes:live.regulationMinutes ?? 90,
          homeRateMultiplier:1,
          awayRateMultiplier:1,
          maxAdditionalGoals:live.maxAdditionalGoals ?? 8,
          evidence:live.evidence
        });
        const output=publicLivePrediction(result);
        await persistIfConfigured(persistence,{requestId,endpoint:'/v1/predict/live',input:body,output});
        return json(res,200,output);
      }
      return json(res,404,{error:'NOT_FOUND',requestId});
    }catch(error){
      const status=error.statusCode || (/REQUIRED|INVALID|MISMATCH|FORBIDDEN|DUPLICATE|MUST_BE|REQUIRES_SEPARATE/.test(error.message)?400:500);
      return json(res,status,{error:error.message || 'INTERNAL_ERROR',requestId,capitalState:'LOCKED',realMoney:'NO'});
    }
  });
}

function resolvePersistenceMode(){
  const explicit=String(process.env.PREDICTION_PERSISTENCE_MODE || '').trim().toLowerCase();
  if(explicit){
    if(!['postgres','disabled'].includes(explicit))throw Object.assign(new Error('PREDICTION_PERSISTENCE_MODE_INVALID'),{statusCode:500});
    return explicit;
  }
  return process.env.DATABASE_URL?'postgres':'disabled';
}

export async function startPredictionApi({port=Number(process.env.PORT || 8080),host=process.env.HOST || '0.0.0.0',persistence=null}={}){
  const mode=persistence?.mode?'postgres':resolvePersistenceMode();
  const activePersistence=persistence || (mode==='postgres'?await createPostgresPredictionPersistence():null);
  if(activePersistence)await activePersistence.healthCheck();
  const server=createPredictionApiServer({persistence:activePersistence});
  server.listen(port,host,()=>console.log(JSON.stringify({apiVersion:API_VERSION,liveApiVersion:LIVE_API_VERSION,host,port,persistenceMode:activePersistence?.mode || 'DISABLED',capitalState:'LOCKED',realMoney:'NO'})));
  if(activePersistence?.close){
    server.once('close',()=>{Promise.resolve(activePersistence.close()).catch(error=>console.error(JSON.stringify({error:'POSTGRES_PERSISTENCE_CLOSE_FAILED',message:error.message})));});
  }
  return server;
}

if(import.meta.url===`file://${process.argv[1]}`){
  startPredictionApi().catch(error=>{
    console.error(JSON.stringify({error:error.message || 'STARTUP_FAILED',capitalState:'LOCKED',realMoney:'NO'}));
    process.exitCode=1;
  });
}
