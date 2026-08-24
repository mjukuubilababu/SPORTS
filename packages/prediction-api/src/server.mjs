import http from 'node:http';
import { orchestrateModelProbabilities } from '../../intelligence-engine/src/model-probability-orchestrator.mjs';

const API_VERSION='PREDICTION_HTTP_API_V0_1';
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

export function createPredictionApiServer(){
  return http.createServer(async(req,res)=>{
    const requestId=req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('x-request-id',requestId);
    try{
      if(req.method==='GET' && req.url==='/health'){
        return json(res,200,{status:'ok',apiVersion:API_VERSION,capitalState:'LOCKED',realMoney:'NO'});
      }
      if(req.method==='POST' && req.url==='/v1/predict'){
        const body=await readJson(req);
        const result=orchestrateModelProbabilities(body);
        return json(res,200,publicPrediction(result));
      }
      return json(res,404,{error:'NOT_FOUND',requestId});
    }catch(error){
      const status=error.statusCode || (/REQUIRED|INVALID|MISMATCH|FORBIDDEN|DUPLICATE|MUST_BE/.test(error.message)?400:500);
      return json(res,status,{error:error.message || 'INTERNAL_ERROR',requestId,capitalState:'LOCKED',realMoney:'NO'});
    }
  });
}

export function startPredictionApi({port=Number(process.env.PORT || 8080),host=process.env.HOST || '0.0.0.0'}={}){
  const server=createPredictionApiServer();
  server.listen(port,host,()=>console.log(JSON.stringify({apiVersion:API_VERSION,host,port,capitalState:'LOCKED',realMoney:'NO'})));
  return server;
}

if(import.meta.url===`file://${process.argv[1]}`) startPredictionApi();
