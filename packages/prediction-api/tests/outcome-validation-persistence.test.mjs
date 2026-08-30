import test from 'node:test';
import assert from 'node:assert/strict';
import { createPredictionOutcomeValidationPersistence, preparePredictionOutcome, preparePredictionValidation } from '../src/postgres-outcome-validation-persistence.mjs';

const outcomeInput={outcomeId:'OUT-1',predictionSnapshotId:'abcdefab-cdef-4abc-8def-abcdefabcdef',eventId:'E1',outcomeKind:'official_result',homeGoals:2,awayGoals:1,officialSource:'OFFICIAL',sourcePayload:{home:2,away:1},occurredAt:'2026-08-30T20:00:00Z',observedAt:'2026-08-30T20:00:05Z'};
const validationInput={validationId:'VAL-1',validationPayload:{market:'1X2',selection:'HOME',correct:true},validatedAt:'2026-08-30T20:00:06Z'};

test('preparation binds exact payload fingerprints and keeps validation separate from execution',()=>{
  const outcome=preparePredictionOutcome(outcomeInput);
  const validation=preparePredictionValidation(validationInput,outcome);
  assert.match(outcome.outcomeFingerprint,/^[0-9a-f]{64}$/);
  assert.match(validation.validationFingerprint,/^[0-9a-f]{64}$/);
  assert.equal(validation.outcomeFingerprint,outcome.outcomeFingerprint);
  assert.equal(validation.authorizesExecution,false);
  assert.equal(validation.capitalState,'LOCKED');
  assert.equal(validation.realMoney,'NO');
});

test('preparation snapshots mutable payload references exactly once',()=>{
  const sourcePayload={score:{home:2,away:1}};
  const validationPayload={correct:true};
  const outcome=preparePredictionOutcome({...outcomeInput,sourcePayload});
  const validation=preparePredictionValidation({...validationInput,validationPayload},outcome);
  sourcePayload.score.home=9;validationPayload.correct=false;
  assert.equal(outcome.sourcePayload.score.home,2);
  assert.equal(validation.validationPayload.correct,true);
});

test('invalid chronology and changed payload identity reject',()=>{
  assert.throws(()=>preparePredictionOutcome({...outcomeInput,observedAt:'2026-08-30T19:59:59Z'}),/OUTCOME_OBSERVATION_PREDATES_OCCURRENCE/);
  const outcome=preparePredictionOutcome(outcomeInput);
  assert.throws(()=>preparePredictionValidation({...validationInput,validatedAt:'2026-08-30T20:00:04Z'},outcome),/VALIDATION_PREDATES_OUTCOME_OBSERVATION/);
  assert.notEqual(preparePredictionOutcome({...outcomeInput,sourcePayload:{home:9,away:1}}).outcomeFingerprint,outcome.outcomeFingerprint);
});

function fakePool({failValidation=false,duplicate=false,conflict=false}={}){
  const calls=[];let released=false;
  const client={async query(query,values){
    const text=typeof query==='string'?query:query.text;calls.push(text);
    if(text==='BEGIN'||text==='COMMIT'||text==='ROLLBACK')return {rowCount:0,rows:[]};
    if(text.includes('SELECT p.event_id'))return {rowCount:1,rows:[{event_id:'E1',kickoff_at:'2026-08-30T18:00:00Z'}]};
    if(text.includes('INSERT INTO prediction_outcomes'))return {rowCount:duplicate?0:1,rows:duplicate?[]:[{outcome_id:'OUT-1'}]};
    if(text.includes('FROM prediction_outcomes'))return {rowCount:1,rows:[{outcome_id:'OUT-1',prediction_snapshot_id:outcomeInput.predictionSnapshotId,event_id:'E1',outcome_fingerprint:conflict?'f'.repeat(64):preparePredictionOutcome(outcomeInput).outcomeFingerprint}]};
    if(text.includes('INSERT INTO prediction_validations')){if(failValidation)throw new Error('partial failure');return {rowCount:duplicate?0:1,rows:duplicate?[]:[{validation_id:'VAL-1'}]};}
    if(text.includes('FROM prediction_validations')){const o=preparePredictionOutcome(outcomeInput),v=preparePredictionValidation(validationInput,o);return {rowCount:1,rows:[{validation_id:'VAL-1',prediction_snapshot_id:o.predictionSnapshotId,outcome_id:o.outcomeId,outcome_fingerprint:o.outcomeFingerprint,event_id:o.eventId,validation_fingerprint:v.validationFingerprint}]};}
    throw new Error('unexpected query '+text);
  },release(){released=true;}};
  return {calls,get released(){return released;},async connect(){return client;}};
}

test('Pool transaction uses one dedicated client and exact replay is idempotent',async()=>{
  const pool=fakePool();
  const persisted=await createPredictionOutcomeValidationPersistence(pool).persist({outcome:outcomeInput,validation:validationInput});
  assert.equal(persisted.status,'PERSISTED');
  assert.deepEqual(pool.calls.filter(x=>['BEGIN','COMMIT','ROLLBACK'].includes(x)),['BEGIN','COMMIT']);
  assert.equal(pool.released,true);
  const replay=await createPredictionOutcomeValidationPersistence(fakePool({duplicate:true})).persist({outcome:outcomeInput,validation:validationInput});
  assert.equal(replay.status,'ALREADY_PERSISTED');
});

test('partial validation failure fully rolls back and changed same identity rejects',async()=>{
  const pool=fakePool({failValidation:true});
  await assert.rejects(createPredictionOutcomeValidationPersistence(pool).persist({outcome:outcomeInput,validation:validationInput}),/OUTCOME_VALIDATION_PERSISTENCE_FAILED/);
  assert.equal(pool.calls.at(-1),'ROLLBACK');
  await assert.rejects(createPredictionOutcomeValidationPersistence(fakePool({duplicate:true,conflict:true})).persist({outcome:outcomeInput,validation:validationInput}),/OUTCOME_IDEMPOTENCY_CONFLICT/);

  await assert.rejects(createPredictionOutcomeValidationPersistence(fakePool({duplicate:true})).persist({outcome:{...outcomeInput,outcomeId:'OUT-2'},validation:validationInput}),/OUTCOME_IDEMPOTENCY_CONFLICT/);
  await assert.rejects(createPredictionOutcomeValidationPersistence(fakePool({duplicate:true})).persist({outcome:outcomeInput,validation:{...validationInput,validationId:'VAL-2'}}),/VALIDATION_IDEMPOTENCY_CONFLICT/);
});
