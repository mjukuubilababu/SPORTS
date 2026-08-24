import test from 'node:test';
import assert from 'node:assert/strict';
import { createPredictionApiServer } from '../src/server.mjs';

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

test('health endpoint exposes locked capital state',async()=>withServer(async base=>{
  const r=await fetch(`${base}/health`);const j=await r.json();
  assert.equal(r.status,200);assert.equal(j.status,'ok');assert.equal(j.capitalState,'LOCKED');assert.equal(j.realMoney,'NO');
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

test('invalid JSON returns 400 and unknown path returns 404',async()=>withServer(async base=>{
  const bad=await fetch(`${base}/v1/predict`,{method:'POST',body:'{' });assert.equal(bad.status,400);
  const missing=await fetch(`${base}/nope`);assert.equal(missing.status,404);
}));
