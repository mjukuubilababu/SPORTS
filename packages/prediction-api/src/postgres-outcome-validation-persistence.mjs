import { sha256Json, sha256ReferencePayload, canonicalInputTimestamp } from './postgres-persistence.mjs';

function fail(message,statusCode=409,cause){const error=new Error(message,{cause});error.statusCode=statusCode;return error;}
function req(value,code){if(typeof value!=='string'||value.trim()==='')throw fail(code,400);return value.trim();}
function uuid(value,code){const normalized=req(value,code).toLowerCase();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized))throw fail(code,400);return normalized;}
function timestamp(value,code){const normalized=value instanceof Date?(Number.isFinite(value.getTime())?value.toISOString():null):canonicalInputTimestamp(value);if(normalized===null)throw fail(code,400);return normalized;}
function integer(value,code){if(!Number.isInteger(value)||value<0||value>2147483647)throw fail(code,400);return value;}
function epoch(value){return value instanceof Date?value.getTime():Date.parse(value);}
function snapshotPayload(value,code){try{return JSON.parse(JSON.stringify(value));}catch(cause){throw fail(code,400,cause);}}

export function preparePredictionOutcome(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('OUTCOME_OBJECT_REQUIRED',400);
  const outcomeKind=req(input.outcomeKind,'OUTCOME_KIND_REQUIRED').toUpperCase();
  if(!['OFFICIAL_RESULT','VOID'].includes(outcomeKind))throw fail('OUTCOME_KIND_INVALID',400);
  if(input.sourcePayload===undefined||input.sourcePayload===null)throw fail('OUTCOME_SOURCE_PAYLOAD_REQUIRED',400);
  const sourcePayload=snapshotPayload(input.sourcePayload,'OUTCOME_SOURCE_PAYLOAD_INVALID');
  if(!sourcePayload||typeof sourcePayload!=='object'||Array.isArray(sourcePayload))throw fail('OUTCOME_SOURCE_PAYLOAD_REQUIRED',400);
  const core={
    outcomeId:req(input.outcomeId,'OUTCOME_ID_REQUIRED'),
    predictionSnapshotId:uuid(input.predictionSnapshotId,'OUTCOME_PREDICTION_ID_INVALID'),
    eventId:req(String(input.eventId??''),'OUTCOME_EVENT_ID_REQUIRED'),
    outcomeKind,
    homeGoals:outcomeKind==='VOID'?null:integer(input.homeGoals,'OUTCOME_HOME_GOALS_INVALID'),
    awayGoals:outcomeKind==='VOID'?null:integer(input.awayGoals,'OUTCOME_AWAY_GOALS_INVALID'),
    officialSource:req(input.officialSource,'OUTCOME_OFFICIAL_SOURCE_REQUIRED'),
    sourcePayloadFingerprint:sha256ReferencePayload(sourcePayload),
    occurredAt:timestamp(input.occurredAt,'OUTCOME_OCCURRED_AT_INVALID'),
    observedAt:timestamp(input.observedAt,'OUTCOME_OBSERVED_AT_INVALID')
  };
  if(Date.parse(core.observedAt)<Date.parse(core.occurredAt))throw fail('OUTCOME_OBSERVATION_PREDATES_OCCURRENCE',409);
  return Object.freeze({...core,sourcePayload,outcomeFingerprint:sha256Json(core),capitalState:'LOCKED',realMoney:'NO'});
}

export function preparePredictionValidation(input,outcome){
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('VALIDATION_OBJECT_REQUIRED',400);
  const validationPayload=snapshotPayload(input.validationPayload,'VALIDATION_PAYLOAD_INVALID');
  if(!validationPayload||typeof validationPayload!=='object'||Array.isArray(validationPayload))throw fail('VALIDATION_PAYLOAD_REQUIRED',400);
  const core={
    validationId:req(input.validationId,'VALIDATION_ID_REQUIRED'),
    predictionSnapshotId:outcome.predictionSnapshotId,
    outcomeId:outcome.outcomeId,
    outcomeFingerprint:outcome.outcomeFingerprint,
    eventId:outcome.eventId,
    validationPayloadFingerprint:sha256ReferencePayload(validationPayload),
    validatedAt:timestamp(input.validatedAt,'VALIDATION_TIMESTAMP_INVALID')
  };
  if(Date.parse(core.validatedAt)<Date.parse(outcome.observedAt))throw fail('VALIDATION_PREDATES_OUTCOME_OBSERVATION',409);
  return Object.freeze({...core,validationPayload,validationFingerprint:sha256Json(core),capitalState:'LOCKED',realMoney:'NO',authorizesExecution:false});
}

export function createPredictionOutcomeValidationPersistence(pool){
  if(!pool||typeof pool.connect!=='function')throw new Error('POSTGRES_POOL_REQUIRED');
  return Object.freeze({
    async persist({outcome:outcomeInput,validation:validationInput}){
      const outcome=preparePredictionOutcome(outcomeInput);
      const validation=preparePredictionValidation(validationInput,outcome);
      let client;
      try{
        client=await pool.connect();
        await client.query('BEGIN');
        const lineage=await client.query(`SELECT p.event_id,s.kickoff_at
          FROM prediction_snapshots_v01 p
          JOIN prediction_snapshot_frozen_signal_lineage_v01 l ON l.prediction_snapshot_id=p.snapshot_id AND l.event_id=p.event_id
          JOIN reference_frozen_signal_snapshots_v01 s ON s.signal_snapshot_id=l.frozen_signal_snapshot_id AND s.signal_fingerprint=l.frozen_signal_fingerprint AND s.event_id=l.event_id
          WHERE p.snapshot_id=$1 AND p.event_id=$2`,[outcome.predictionSnapshotId,outcome.eventId]);
        if(lineage.rowCount!==1)throw fail('OUTCOME_EXACT_PREDICTION_LINEAGE_REQUIRED');
        if(epoch(outcome.occurredAt)<=epoch(lineage.rows[0].kickoff_at))throw fail('OUTCOME_MUST_FOLLOW_KICKOFF');

        const insertedOutcome=await client.query({text:`INSERT INTO prediction_outcomes_v01(outcome_id,prediction_snapshot_id,event_id,outcome_kind,home_goals,away_goals,official_source,source_payload,source_payload_fingerprint,outcome_fingerprint,occurred_at,observed_at,capital_state,real_money)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,'LOCKED','NO') ON CONFLICT DO NOTHING RETURNING outcome_id`,values:[outcome.outcomeId,outcome.predictionSnapshotId,outcome.eventId,outcome.outcomeKind,outcome.homeGoals,outcome.awayGoals,outcome.officialSource,JSON.stringify(outcome.sourcePayload),outcome.sourcePayloadFingerprint,outcome.outcomeFingerprint,outcome.occurredAt,outcome.observedAt]});
        if(insertedOutcome.rowCount!==1){
          const existing=await client.query('SELECT outcome_id,prediction_snapshot_id::text,event_id,outcome_fingerprint FROM prediction_outcomes_v01 WHERE outcome_id=$1 OR prediction_snapshot_id=$2',[outcome.outcomeId,outcome.predictionSnapshotId]);
          const row=existing.rows?.[0];
          if(!row||row.outcome_id!==outcome.outcomeId||row.prediction_snapshot_id!==outcome.predictionSnapshotId||row.event_id!==outcome.eventId||row.outcome_fingerprint!==outcome.outcomeFingerprint)throw fail('OUTCOME_IDEMPOTENCY_CONFLICT');
        }

        const insertedValidation=await client.query({text:`INSERT INTO prediction_validations_v01(validation_id,prediction_snapshot_id,outcome_id,outcome_fingerprint,event_id,validation_payload,validation_payload_fingerprint,validation_fingerprint,validated_at,capital_state,real_money)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,'LOCKED','NO') ON CONFLICT DO NOTHING RETURNING validation_id`,values:[validation.validationId,validation.predictionSnapshotId,validation.outcomeId,validation.outcomeFingerprint,validation.eventId,JSON.stringify(validation.validationPayload),validation.validationPayloadFingerprint,validation.validationFingerprint,validation.validatedAt]});
        if(insertedValidation.rowCount!==1){
          const existing=await client.query('SELECT validation_id,prediction_snapshot_id::text,outcome_id,outcome_fingerprint,event_id,validation_fingerprint FROM prediction_validations_v01 WHERE validation_id=$1 OR (prediction_snapshot_id=$2 AND outcome_id=$3)',[validation.validationId,validation.predictionSnapshotId,validation.outcomeId]);
          const row=existing.rows?.[0];
          if(!row||row.validation_id!==validation.validationId||row.prediction_snapshot_id!==validation.predictionSnapshotId||row.outcome_id!==validation.outcomeId||row.outcome_fingerprint!==validation.outcomeFingerprint||row.event_id!==validation.eventId||row.validation_fingerprint!==validation.validationFingerprint)throw fail('VALIDATION_IDEMPOTENCY_CONFLICT');
        }
        await client.query('COMMIT');
        return Object.freeze({status:insertedOutcome.rowCount===1&&insertedValidation.rowCount===1?'PERSISTED':'ALREADY_PERSISTED',outcomeId:outcome.outcomeId,outcomeFingerprint:outcome.outcomeFingerprint,validationId:validation.validationId,validationFingerprint:validation.validationFingerprint,capitalState:'LOCKED',realMoney:'NO',authorizesExecution:false});
      }catch(error){
        if(client)await client.query('ROLLBACK').catch(()=>{});
        if(error?.statusCode)throw error;
        throw fail('OUTCOME_VALIDATION_PERSISTENCE_FAILED',503,error);
      }finally{client?.release();}
    }
  });
}
