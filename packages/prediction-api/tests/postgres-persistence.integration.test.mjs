import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createPredictionApiServer } from '../src/server.mjs';
import { createPostgresPredictionPersistence } from '../src/postgres-persistence.mjs';
import { createPreMatchOutcomeSnapshot } from '../../intelligence-engine/src/outcome-1x2.mjs';
import { archiveIngestionProvenanceBundle, prepareIngestionObservation, prepareFeatureProvenanceLineage } from '../../reference-e2e/src/postgres-ingestion-provenance.mjs';
import { archiveFeatureModelSignalBundle, prepareModelSnapshot, prepareFrozenSignal } from '../../reference-e2e/src/postgres-feature-model-signal-lineage.mjs';

const databaseUrl=process.env.TEST_DATABASE_URL || '';

async function listen(server){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return `http://127.0.0.1:${server.address().port}`;
}


function lineageFixture(eventId,prefix,kickoffAt){
  const observation={provenanceId:'API-PROV-'+prefix,observationId:'API-OBS-'+prefix,eventId,entityType:'MATCH',entityId:eventId,evidenceKind:'MODEL_INPUT',source:'API_TEST_SOURCE',sourceType:'TEST',observedAt:'2026-08-26T14:00:00.000Z',availableAt:'2026-08-26T14:00:01.000Z',capturedAt:'2026-08-26T14:00:02.000Z',predictionCutoff:'2026-08-26T18:00:00.000Z',isVerified:true,payload:{event_id:eventId,value:1}};
  const source=prepareIngestionObservation(observation);
  const featureInput={lineageId:'API-FEATURE-LINEAGE-'+prefix,featureId:'API-FEATURE-'+prefix,eventId,featureName:'api_model_input',featureVersion:'FEATURE_V1',featurePayload:{value:1},sourceProvenanceId:source.provenanceId,sourceEvidenceFingerprint:source.evidenceFingerprint,createdAt:'2026-08-26T14:05:00.000Z'};
  const feature=prepareFeatureProvenanceLineage(featureInput);
  const modelSnapshotId='API-MODEL-'+prefix;
  const modelPayload=prefix==='PREMATCH'?((({snapshotSha256,...payload})=>payload)(model({snapshotId:modelSnapshotId}))):{lambda:2.4};
  const modelInput={modelSnapshotId,eventId,modelVersion:'POISSON_V1',payload:modelPayload,kickoffAt,frozenAt:'2026-08-26T15:00:00.000Z',features:[{featureLineageId:feature.lineageId,featureFingerprint:feature.featureFingerprint}]};
  const preparedModel=prepareModelSnapshot(modelInput);
  const signalPayload=prefix==='LIVE'?createPreMatchOutcomeSnapshot({signalId:'PG-LIVE-SIGNAL-1',eventId,modelVersion:preparedModel.modelVersion,featureVersion:'FEATURE_V1',homeLambda:1.6,awayLambda:1.0,createdAt:'2026-08-26T17:55:00Z',frozenAt:'2026-08-26T18:00:00Z'}):{eventId,market:'LINEAGE_SOURCE'};
  const signalInput={signalSnapshotId:prefix==='LIVE'?'PG-LIVE-SIGNAL-1':'API-SIGNAL-'+prefix,eventId,signalKind:'FROZEN_PREDICTION',modelSnapshotId:preparedModel.modelSnapshotId,modelFingerprint:preparedModel.modelFingerprint,payload:signalPayload,kickoffAt,frozenAt:prefix==='LIVE'?'2026-08-26T18:00:00.000Z':'2026-08-26T15:05:00.000Z'};
  const signal=prepareFrozenSignal(signalInput);
  return{observation,featureInput,modelInput,modelSnapshot:preparedModel,signalInput,persistenceLineage:{frozenSignalSnapshotId:signal.signalSnapshotId,frozenSignalFingerprint:signal.signalFingerprint}};
}
const PREMATCH_LINEAGE=lineageFixture('PG-E1','PREMATCH','2026-08-26T19:00:00.000Z');
const LIVE_LINEAGE=lineageFixture('PG-LIVE-E1','LIVE','2026-08-26T19:00:00.000Z');
const LIVE_ALT_LINEAGE=lineageFixture('PG-LIVE-E1','LIVE_ALT','2026-08-26T19:00:00.000Z');
async function seedLineage(pool,item){
  await archiveIngestionProvenanceBundle({client:pool,observations:[item.observation],featureLineage:[item.featureInput]});
  await archiveFeatureModelSignalBundle({client:pool,models:[item.modelInput],signals:[item.signalInput]});
}

function model(overrides={}){
  return {
    modelVersion:'POISSON_V1',eventId:'PG-E1',market:'TOTAL_3_5',selection:'UNDER',probability:0.6,
    usesMarketOdds:false,frozenAt:'2026-08-26T15:00:00Z',source:'MODEL_SNAPSHOT',snapshotId:'PG-S1',snapshotSha256:'a'.repeat(64),
    correlationFamily:'POISSON_FAMILY',baseWeight:1,validation:1,calibration:1,freshness:1,drift:1,availability:1,...overrides
  };
}

function prematchPayload(){
  return {persistenceLineage:PREMATCH_LINEAGE.persistenceLineage,eventId:'PG-E1',market:'TOTAL_3_5',selection:'UNDER',kickoffAt:'2026-08-26T19:00:00Z',models:[model({snapshotId:PREMATCH_LINEAGE.modelSnapshot.modelSnapshotId,snapshotSha256:PREMATCH_LINEAGE.modelSnapshot.modelFingerprint})],offeredOdds:1.9,confidence:{score:0.9,criticalBlocks:[]}};
}

function livePayload(){
  const preMatchSnapshot=LIVE_LINEAGE.signalInput.payload;
  return {
    persistenceLineage:LIVE_LINEAGE.persistenceLineage,
    preMatchSnapshot,
    live:{
      eventId:'PG-LIVE-E1',minute:61,homeScore:1,awayScore:0,observedAt:'2026-08-26T19:21:00Z',
      evidence:[{type:'LIVE_SCORE_TIME_PROVIDER_SNAPSHOT',provider:'API_FOOTBALL',providerFixtureId:2001,verified:true,sourceFixtureSha256:'b'.repeat(64)}]
    }
  };
}

test('Prediction API persists prematch and live snapshots in PostgreSQL with idempotency', {skip:!databaseUrl}, async t=>{
  const seedPool=new Pool({connectionString:databaseUrl});
  await seedLineage(seedPool,PREMATCH_LINEAGE);
  await seedLineage(seedPool,LIVE_LINEAGE);
  await seedLineage(seedPool,LIVE_ALT_LINEAGE);
  await seedPool.end();
  const persistence=await createPostgresPredictionPersistence({connectionString:databaseUrl,max:2});
  t.after(async()=>{await persistence.close();});
  const health=await persistence.healthCheck();
  assert.equal(health.status,'ok');
  assert.equal(health.table,'prediction_snapshots_v01');

  const server=createPredictionApiServer({persistence});
  const base=await listen(server);
  t.after(async()=>{if(server.listening)await new Promise(resolve=>server.close(resolve));});

  const requestId=`pg-prematch-${randomUUID()}`;
  const input=prematchPayload();
  const first=await fetch(`${base}/v1/predict`,{method:'POST',headers:{'content-type':'application/json','x-request-id':requestId},body:JSON.stringify(input)});
  const firstBody=await first.json();
  assert.equal(first.status,200);
  assert.equal(first.headers.get('x-persistence-mode'),'POSTGRES');
  assert.equal(firstBody.eventId,'PG-E1');

  const stored=await persistence.getByRequest({requestId,endpoint:'/v1/predict'});
  assert.equal(stored.event_id,'PG-E1');
  assert.equal(stored.snapshot_type,'PREMATCH');
  assert.equal(stored.capital_state,'LOCKED');
  assert.equal(stored.real_money,'NO');
  assert.equal(stored.prediction_payload.eventId,'PG-E1');
  assert.equal(stored.input_payload.offeredOdds,1.9);
  assert.equal(stored.frozen_signal_snapshot_id,PREMATCH_LINEAGE.persistenceLineage.frozenSignalSnapshotId);
  assert.equal(stored.frozen_signal_fingerprint,PREMATCH_LINEAGE.persistenceLineage.frozenSignalFingerprint);

  const prematchAttestation=await persistence.attestPredictionLineage({snapshotId:stored.snapshot_id});
  assert.equal(prematchAttestation.status,'ATTESTED');
  assert.equal(prematchAttestation.eventId,'PG-E1');
  assert.equal(prematchAttestation.exactEventBound,true);
  assert.equal(prematchAttestation.prematchEvidenceOnly,true);
  assert.equal(prematchAttestation.settlementSeparate,true);
  assert.equal(prematchAttestation.features.length,1);
  assert.equal(prematchAttestation.authorizesValidation,false);
  assert.equal(prematchAttestation.authorizesExecution,false);
  assert.equal(prematchAttestation.capitalState,'LOCKED');
  assert.equal(prematchAttestation.realMoney,'NO');
  const attestationResponse=await fetch(`${base}/v1/predictions/${stored.snapshot_id}/lineage`);
  assert.equal(attestationResponse.status,200);
  const attestationBody=await attestationResponse.json();
  assert.equal(attestationBody.lineageAttestation.snapshotId,stored.snapshot_id);
  assert.equal(attestationBody.truthOwner,'GATE1');
  assert.equal(attestationBody.capitalOwner,'GATE6');
  assert.equal(attestationBody.predictionIsValidation,false);
  assert.equal(attestationBody.predictionIsExecution,false);

  const duplicate=await fetch(`${base}/v1/predict`,{method:'POST',headers:{'content-type':'application/json','x-request-id':requestId},body:JSON.stringify(input)});
  assert.equal(duplicate.status,200);
  const sameRow=await persistence.getByRequest({requestId,endpoint:'/v1/predict'});
  assert.equal(sameRow.snapshot_id,stored.snapshot_id);

  const changed=structuredClone(input);changed.offeredOdds=2.2;
  const conflict=await fetch(`${base}/v1/predict`,{method:'POST',headers:{'content-type':'application/json','x-request-id':requestId},body:JSON.stringify(changed)});
  const conflictBody=await conflict.json();
  assert.equal(conflict.status,409);
  assert.equal(conflictBody.error,'PERSISTENCE_IDEMPOTENCY_CONFLICT');

  const mismatchedLive=livePayload();
  mismatchedLive.persistenceLineage=LIVE_ALT_LINEAGE.persistenceLineage;
  const mismatchResponse=await fetch(`${base}/v1/predict/live`,{method:'POST',headers:{'content-type':'application/json','x-request-id':`pg-live-mismatch-${randomUUID()}`},body:JSON.stringify(mismatchedLive)});
  assert.equal(mismatchResponse.status,409);
  assert.equal((await mismatchResponse.json()).error,'PERSISTENCE_LIVE_PARENT_SIGNAL_LINEAGE_NOT_EXACT');

  const liveRequestId=`pg-live-${randomUUID()}`;
  const live=await fetch(`${base}/v1/predict/live`,{method:'POST',headers:{'content-type':'application/json','x-request-id':liveRequestId},body:JSON.stringify(livePayload())});
  assert.equal(live.status,200);
  const liveStored=await persistence.getByRequest({requestId:liveRequestId,endpoint:'/v1/predict/live'});
  assert.equal(liveStored.snapshot_type,'LIVE');
  assert.equal(liveStored.market,'1X2');
  assert.equal(liveStored.parent_signal_id,'PG-LIVE-SIGNAL-1');
  assert.equal(liveStored.model_version,'POISSON_V1');
  assert.equal(liveStored.feature_version,'FEATURE_V1');
  assert.equal(liveStored.frozen_signal_snapshot_id,LIVE_LINEAGE.persistenceLineage.frozenSignalSnapshotId);
  const liveAttestation=await persistence.attestPredictionLineage({snapshotId:liveStored.snapshot_id});
  assert.equal(liveAttestation.status,'ATTESTED');
  assert.equal(liveAttestation.frozenSignalSnapshotId,'PG-LIVE-SIGNAL-1');

  const badRequestId='pg-cross-event-'+randomUUID();
  const badInput=prematchPayload();
  badInput.persistenceLineage=LIVE_LINEAGE.persistenceLineage;
  const rejected=await fetch(base+'/v1/predict',{method:'POST',headers:{'content-type':'application/json','x-request-id':badRequestId},body:JSON.stringify(badInput)});
  assert.equal(rejected.status,409);
  const verifyPool=new Pool({connectionString:databaseUrl});
  const rolledBack=await verifyPool.query('SELECT count(*)::int count FROM prediction_snapshots_v01 WHERE request_id=$1',[badRequestId]);
  assert.equal(rolledBack.rows[0].count,0);

  const unlinkedSnapshotId=randomUUID();
  await verifyPool.query("INSERT INTO prediction_snapshots_v01(snapshot_id,request_id,endpoint,snapshot_type,event_id,market,input_sha256,output_sha256,input_payload,prediction_payload,capital_state,real_money) VALUES($1,$2,'/v1/predict','PREMATCH','PG-E1','TOTAL_3_5',$3,$3,'{}'::jsonb,'{}'::jsonb,'LOCKED','NO')",[unlinkedSnapshotId,'direct-cross-event-'+randomUUID(),'c'.repeat(64)]);
  await assert.rejects(
    verifyPool.query("INSERT INTO prediction_snapshot_frozen_signal_lineage_v01(prediction_snapshot_id,event_id,frozen_signal_snapshot_id,frozen_signal_fingerprint,link_fingerprint,capital_state,real_money) VALUES($1,'PG-LIVE-E1',$2,$3,$4,'LOCKED','NO')",[unlinkedSnapshotId,LIVE_LINEAGE.persistenceLineage.frozenSignalSnapshotId,LIVE_LINEAGE.persistenceLineage.frozenSignalFingerprint,'d'.repeat(64)]),
    error=>error?.code==='23503'
  );
  await assert.rejects(verifyPool.query('UPDATE prediction_snapshot_frozen_signal_lineage_v01 SET capital_state=capital_state WHERE prediction_snapshot_id=$1',[stored.snapshot_id]),/prediction frozen signal lineage is immutable/i);
  await assert.rejects(verifyPool.query('DELETE FROM prediction_snapshot_frozen_signal_lineage_v01 WHERE prediction_snapshot_id=$1',[stored.snapshot_id]),/prediction frozen signal lineage is immutable/i);
  const legacySnapshotId=randomUUID();
  const legacyRequestId='legacy-'+randomUUID();
  await verifyPool.query("INSERT INTO prediction_snapshots_v01(snapshot_id,request_id,endpoint,snapshot_type,event_id,market,input_sha256,output_sha256,input_payload,prediction_payload,capital_state,real_money) VALUES($1,$2,'/v1/predict','PREMATCH','PG-E1','TOTAL_3_5',$3,$3,'{}'::jsonb,'{}'::jsonb,'LOCKED','NO')",[legacySnapshotId,legacyRequestId,'e'.repeat(64)]);
  const legacy=await persistence.getByRequest({requestId:legacyRequestId,endpoint:'/v1/predict'});
  assert.equal(legacy.snapshot_id,legacySnapshotId);
  assert.equal(legacy.frozen_signal_snapshot_id,null);
  assert.equal(legacy.frozen_signal_fingerprint,null);
  assert.equal(legacy.link_fingerprint,null);
  await assert.rejects(persistence.attestPredictionLineage({snapshotId:legacySnapshotId}),error=>error?.message==='PREDICTION_LINEAGE_NOT_ATTESTABLE'&&error?.statusCode===409);
  const legacyResponse=await fetch(`${base}/v1/predictions/${legacySnapshotId}/lineage`);
  assert.equal(legacyResponse.status,409);
  assert.equal((await legacyResponse.json()).error,'PREDICTION_LINEAGE_NOT_ATTESTABLE');
  const missingId=randomUUID();
  await assert.rejects(persistence.attestPredictionLineage({snapshotId:missingId}),error=>error?.message==='PREDICTION_SNAPSHOT_NOT_FOUND'&&error?.statusCode===404);
  await verifyPool.end();
});
