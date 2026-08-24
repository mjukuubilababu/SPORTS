import test from 'node:test';
import assert from 'node:assert/strict';
import { createPredictionApiServer } from '../src/server.mjs';
import { createPreMatchOutcomeSnapshot } from '../../intelligence-engine/src/outcome-1x2.mjs';

async function withServer(fn){
  const server=createPredictionApiServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {port}=server.address();
  try{return await fn(`http://127.0.0.1:${port}`);}finally{await new Promise(resolve=>server.close(resolve));}
}

function model(overrides={}){
  return {
    modelVersion:'POISSON_V1',eventId:'E1',market:'TOTAL_3_5',selection:'UNDER',probability:0.6,
    usesMarketOdds:false,frozenAt:'2026-08-24T18:00:00Z',source:'MODEL_SNAPSHOT',snapshotId:'S1',snapshotSha256:'a'.repeat(64),
    correlationFamily:'POISSON_FAMILY',baseWeight:1,validation:1,calibration:1,freshness:1,drift:1,availability:1,...overrides
  };
}
function payload(){return {eventId:'E1',market:'TOTAL_3_5',selection:'UNDER',kickoffAt:'2026-08-24T19:00:00Z',models:[model()],offeredOdds:1.9,confidence:{score:0.9,criticalBlocks:[]}};}

function preMatchSnapshot(){
  return createPreMatchOutcomeSnapshot({
    signalId:'LIVE-SIGNAL-1',eventId:'E-LIVE-1',modelVersion:'POISSON_V1',featureVersion:'FEATURE_V1',
    homeLambda:1.8,awayLambda:1.1,createdAt:'2026-08-24T17:55:00Z',frozenAt:'2026-08-24T18:00:00Z'
  });
}

function livePayload(overrides={}){
  return {
    preMatchSnapshot:preMatchSnapshot(),
    live:{
      eventId:'E-LIVE-1',minute:62,homeScore:1,awayScore:0,observedAt:'2026-08-24T19:22:00Z',
      evidence:[{type:'LIVE_SCORE_TIME_PROVIDER_SNAPSHOT',provider:'API_FOOTBALL',providerFixtureId:1001,verified:true,sourceFixtureSha256:'b'.repeat(64)}],
      ...overrides
    }
  };
}

test('health endpoint exposes locked capital state and live API version',async()=>withServer(async base=>{
  const r=await fetch(`${base}/health`);const j=await r.json();
  assert.equal(r.status,200);assert.equal(j.status,'ok');assert.equal(j.capitalState,'LOCKED');assert.equal(j.realMoney,'NO');
  assert.equal(j.liveApiVersion,'PREDICTION_LIVE_HTTP_API_V0_1');
}));

test('POST /v1/predict returns probability and EV from intelligence orchestrator',async()=>withServer(async base=>{
  const r=await fetch(`${base}/v1/predict`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload())});
  const j=await r.json();assert.equal(r.status,200);assert.equal(j.eventId,'E1');assert.equal(j.probability,0.6);assert.ok(Number.isFinite(j.ev));assert.equal(j.modelFamilyCount,1);assert.equal(j.capitalState,'LOCKED');
}));

test('offered odds do not alter model probability',async()=>withServer(async base=>{
  const a=payload();const b=payload();b.offeredOdds=2.2;
  const ra=await fetch(`${base}/v1/predict`,{method:'POST',body:JSON.stringify(a)});const rb=await fetch(`${base}/v1/predict`,{method:'POST',body:JSON.stringify(b)});
  const ja=await ra.json();const jb=await rb.json();assert.equal(ja.probability,jb.probability);assert.notEqual(ja.ev,jb.ev);
}));

test('market-derived model is rejected',async()=>withServer(async base=>{
  const p=payload();p.models=[model({usesMarketOdds:true})];
  const r=await fetch(`${base}/v1/predict`,{method:'POST',body:JSON.stringify(p)});const j=await r.json();
  assert.equal(r.status,400);assert.match(j.error,/MARKET_CIRCULARITY_FORBIDDEN/);
}));

test('POST /v1/predict/live returns governed live 1X2 probabilities from frozen prematch snapshot',async()=>withServer(async base=>{
  const p=livePayload();const frozenBefore=JSON.stringify(p.preMatchSnapshot);
  const r=await fetch(`${base}/v1/predict/live`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)});
  const j=await r.json();
  assert.equal(r.status,200);assert.equal(j.apiVersion,'PREDICTION_LIVE_HTTP_API_V0_1');assert.equal(j.eventId,'E-LIVE-1');
  assert.equal(j.minute,62);assert.deepEqual(j.score,{home:1,away:0});
  const mass=j.probabilities.homeWin+j.probabilities.draw+j.probabilities.awayWin;
  assert.ok(Math.abs(mass-1)<1e-12);assert.equal(j.capitalState,'LOCKED');assert.equal(j.realMoney,'NO');
  assert.deepEqual(j.audit.rateMultipliers,{home:1,away:1});assert.equal(j.audit.governance.arbitraryRateMultiplierOverrideAllowed,false);
  assert.equal(j.audit.preMatchSnapshotPreserved,true);
  assert.equal(JSON.stringify(p.preMatchSnapshot),frozenBefore);
}));

test('live endpoint rejects event identity mismatch and unverified evidence',async()=>withServer(async base=>{
  const mismatch=livePayload({eventId:'OTHER'});
  const a=await fetch(`${base}/v1/predict/live`,{method:'POST',body:JSON.stringify(mismatch)});const ja=await a.json();
  assert.equal(a.status,400);assert.match(ja.error,/LIVE_EVENT_ID_MISMATCH/);

  const unverified=livePayload({evidence:[{provider:'API_FOOTBALL',verified:false}]});
  const b=await fetch(`${base}/v1/predict/live`,{method:'POST',body:JSON.stringify(unverified)});const jb=await b.json();
  assert.equal(b.status,400);assert.match(jb.error,/LIVE_VERIFIED_EVIDENCE_REQUIRED/);
}));

test('live endpoint blocks arbitrary rate multiplier overrides',async()=>withServer(async base=>{
  const p=livePayload();p.homeRateMultiplier=1.2;
  const r=await fetch(`${base}/v1/predict/live`,{method:'POST',body:JSON.stringify(p)});const j=await r.json();
  assert.equal(r.status,400);assert.match(j.error,/REQUIRES_SEPARATE_VERIFIED_IMPACT_PIPELINE/);
}));

test('invalid JSON returns 400 and unknown path returns 404',async()=>withServer(async base=>{
  const bad=await fetch(`${base}/v1/predict`,{method:'POST',body:'{' });assert.equal(bad.status,400);
  const missing=await fetch(`${base}/nope`);assert.equal(missing.status,404);
}));
