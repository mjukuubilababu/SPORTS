import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPredictionApiServer } from '../src/server.mjs';
import { createPredictionOutcomeValidationPersistence, preparePredictionOutcome, preparePredictionValidation } from '../src/postgres-outcome-validation-persistence.mjs';

const token='0123456789abcdef0123456789abcdef';
const snapshotId='01890f3e-7b1c-7cc2-98c4-dc0c0c0c0c0c';
const outcome={outcomeId:'OUT-API-1',predictionSnapshotId:snapshotId,eventId:'E-API-1',outcomeKind:'OFFICIAL_RESULT',homeGoals:2,awayGoals:1,officialSource:'LEAGUE',sourcePayload:{home:2,away:1},occurredAt:'2026-08-30T20:00:00.500Z',observedAt:'2026-08-30T20:00:01.000Z'};
const validation={validationId:'VAL-API-1',validationPayload:{market:'1X2',selection:'HOME',correct:true},validatedAt:'2026-08-30T20:00:02.000Z'};

async function withServer(options,run){
  const server=createPredictionApiServer(options);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{await run(`http://127.0.0.1:${server.address().port}`);}
  finally{server.close();await once(server,'close');}
}

test('operational API requires configured constant-time bearer authorization and exact route identity',async()=>{
  const calls=[];
  const persistence={mode:'POSTGRES',async persist(value){calls.push(value);return {status:'PERSISTED',outcomeId:'OUT-API-1',outcomeFingerprint:'a'.repeat(64),validationId:'VAL-API-1',validationFingerprint:'b'.repeat(64),capitalState:'LOCKED',realMoney:'NO',authorizesExecution:false};},async attest(){throw new Error('unexpected');}};
  await withServer({outcomeValidationPersistence:persistence,outcomeIngestionToken:token},async base=>{
    const url=`${base}/v1/predictions/${snapshotId}/outcome-validation`,body=JSON.stringify({outcome,validation});
    let response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body});
    assert.equal(response.status,401);assert.equal((await response.json()).error,'OUTCOME_VALIDATION_AUTH_REQUIRED');
    response=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+token.slice(1)+'x','content-type':'application/json'},body});
    assert.equal(response.status,403);assert.equal((await response.json()).error,'OUTCOME_VALIDATION_AUTH_FORBIDDEN');
    response=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({outcome:{...outcome,predictionSnapshotId:'00000000-0000-0000-0000-000000000000'},validation})});
    assert.equal(response.status,409);assert.equal((await response.json()).error,'OUTCOME_ROUTE_PREDICTION_ID_MISMATCH');
    assert.equal(calls.length,0);
    response=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-request-id':'api-test'},body});
    assert.equal(response.status,201);const payload=await response.json();
    assert.equal(payload.outcomeValidation.status,'PERSISTED');assert.equal(payload.validationIsExecution,false);assert.equal(payload.authorizesExecution,false);assert.equal(payload.capitalState,'LOCKED');assert.equal(payload.realMoney,'NO');
    assert.equal(calls.length,1);assert.equal(calls[0].outcome.predictionSnapshotId,snapshotId);
  });
});

test('audit endpoint returns attestation metadata without raw evidence and never authorizes execution',async()=>{
  const attestation={status:'ATTESTED',predictionSnapshotId:snapshotId,eventId:'E-API-1',outcomeId:'OUT-API-1',outcomeFingerprint:'a'.repeat(64),validationId:'VAL-API-1',validationFingerprint:'b'.repeat(64),allFingerprintsRecomputed:true,exactEventBound:true,authorizesExecution:false,capitalState:'LOCKED',realMoney:'NO'};
  await withServer({outcomeValidationPersistence:{mode:'POSTGRES',async attest({predictionSnapshotId}){assert.equal(predictionSnapshotId,snapshotId);return attestation;}},outcomeIngestionToken:token},async base=>{
    const response=await fetch(`${base}/v1/predictions/${snapshotId.toUpperCase()}/outcome-validation`,{headers:{authorization:'Bearer '+token}});
    assert.equal(response.status,200);const payload=await response.json();
    assert.deepEqual(payload.outcomeValidationAttestation,attestation);assert.equal(payload.truthOwner,'GATE1');assert.equal(payload.capitalOwner,'GATE6');assert.equal(payload.predictionIsValidation,false);assert.equal(payload.validationIsExecution,false);assert.equal(JSON.stringify(payload).includes('sourcePayload'),false);assert.equal(JSON.stringify(payload).includes('validationPayload'),false);
  });
});

test('database attestation recomputes exact outcome and validation fingerprints and rejects tampering',async()=>{
  const preparedOutcome=preparePredictionOutcome(outcome),preparedValidation=preparePredictionValidation(validation,preparedOutcome);
  const row={snapshot_id:snapshotId,event_id:outcome.eventId,prediction_capital:'LOCKED',prediction_money:'NO',outcome_id:outcome.outcomeId,outcome_kind:'OFFICIAL_RESULT',home_goals:2,away_goals:1,official_source:'LEAGUE',source_payload:outcome.sourcePayload,source_payload_fingerprint:preparedOutcome.sourcePayloadFingerprint,outcome_fingerprint:preparedOutcome.outcomeFingerprint,occurred_at:new Date(outcome.occurredAt),observed_at:new Date(outcome.observedAt),outcome_capital:'LOCKED',outcome_money:'NO',validation_id:validation.validationId,validation_payload:validation.validationPayload,validation_payload_fingerprint:preparedValidation.validationPayloadFingerprint,validation_fingerprint:preparedValidation.validationFingerprint,validated_at:new Date(validation.validatedAt),validation_capital:'LOCKED',validation_money:'NO'};
  const poolFor=activeRow=>({async connect(){throw new Error('not used');},async query(text){if(String(text).includes('FROM prediction_snapshots_v01 p'))return {rowCount:1,rows:[activeRow]};throw new Error('unexpected query');}});
  const attested=await createPredictionOutcomeValidationPersistence(poolFor(row)).attest({predictionSnapshotId:snapshotId});
  assert.equal(attested.status,'ATTESTED');assert.equal(attested.allFingerprintsRecomputed,true);assert.equal(attested.authorizesExecution,false);
  await assert.rejects(createPredictionOutcomeValidationPersistence(poolFor({...row,source_payload:{home:9,away:1}})).attest({predictionSnapshotId:snapshotId}),/OUTCOME_VALIDATION_ATTESTATION_FAILED/);
});
