import { createHash, randomUUID } from 'node:crypto';

export const PREDICTION_PERSISTENCE_VERSION='POSTGRES_PREDICTION_PERSISTENCE_V0_2';
export const PREDICTION_PERSISTENCE_MODE='POSTGRES';

function stable(value){if(value===null||typeof value!=='object')return value;if(Array.isArray(value))return value.map(stable);return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));}
export function sha256Json(value){return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');}
function persistenceError(message,statusCode=503,cause){const error=new Error(message,{cause});error.statusCode=statusCode;return error;}
function exactHash(value){return typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);}

function assertPersistenceInput({requestId,endpoint,input,output}){
  if(!requestId||typeof requestId!=='string')throw persistenceError('PERSISTENCE_REQUEST_ID_REQUIRED',400);
  if(!['/v1/predict','/v1/predict/live'].includes(endpoint))throw persistenceError('PERSISTENCE_ENDPOINT_INVALID',400);
  if(!input||typeof input!=='object'||Array.isArray(input))throw persistenceError('PERSISTENCE_INPUT_OBJECT_REQUIRED',400);
  if(!output||typeof output!=='object'||Array.isArray(output))throw persistenceError('PERSISTENCE_OUTPUT_OBJECT_REQUIRED',400);
  if(!output.eventId)throw persistenceError('PERSISTENCE_EVENT_ID_REQUIRED',400);
  if(output.capitalState!=='LOCKED'||output.realMoney!=='NO')throw persistenceError('PERSISTENCE_CAPITAL_GOVERNANCE_VIOLATION',500);
  const lineage=input.persistenceLineage;
  if(!lineage||typeof lineage!=='object'||Array.isArray(lineage))throw persistenceError('PERSISTENCE_FROZEN_SIGNAL_LINEAGE_REQUIRED',409);
  if(typeof lineage.frozenSignalSnapshotId!=='string'||lineage.frozenSignalSnapshotId.trim()==='')throw persistenceError('PERSISTENCE_FROZEN_SIGNAL_ID_REQUIRED',409);
  if(!exactHash(lineage.frozenSignalFingerprint))throw persistenceError('PERSISTENCE_FROZEN_SIGNAL_FINGERPRINT_INVALID',409);
  return{frozenSignalSnapshotId:lineage.frozenSignalSnapshotId,frozenSignalFingerprint:lineage.frozenSignalFingerprint};
}

export function createPredictionPersistenceFromPool(pool,{clock=()=>new Date()}={}){
  if(!pool||typeof pool.query!=='function'||typeof pool.connect!=='function')throw new Error('POSTGRES_POOL_REQUIRED');
  return Object.freeze({
    mode:PREDICTION_PERSISTENCE_MODE,version:PREDICTION_PERSISTENCE_VERSION,
    async healthCheck(){
      try{
        const result=await pool.query("SELECT current_database() AS database_name,to_regclass('prediction_snapshots_v01')::text AS table_name,to_regclass('prediction_snapshot_frozen_signal_lineage_v01')::text AS lineage_table");
        const row=result.rows?.[0];
        if(row?.table_name!=='prediction_snapshots_v01'||row?.lineage_table!=='prediction_snapshot_frozen_signal_lineage_v01')throw new Error('PREDICTION_LINEAGE_TABLE_MISSING');
        return Object.freeze({status:'ok',mode:PREDICTION_PERSISTENCE_MODE,database:'REDACTED',table:'prediction_snapshots_v01',lineageTable:'prediction_snapshot_frozen_signal_lineage_v01'});
      }catch(error){throw persistenceError('POSTGRES_PERSISTENCE_UNAVAILABLE',503,error);}
    },
    async persistPrediction({requestId,endpoint,input,output}){
      const lineage=assertPersistenceInput({requestId,endpoint,input,output});
      const snapshotId=randomUUID(),snapshotType=endpoint==='/v1/predict/live'?'LIVE':'PREMATCH';
      const market=output.market??(snapshotType==='LIVE'?'1X2':'UNKNOWN'),selection=output.selection??null;
      const inputSha256=sha256Json(input),outputSha256=sha256Json(output),persistedAt=clock().toISOString();
      const parentSignalId=output.audit?.parentSignalId??null,modelVersion=output.audit?.modelVersion??null;
      const featureVersion=output.audit?.featureVersion??null,sourceObservedAt=output.audit?.observedAt??null;
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const source=await client.query("SELECT signal_kind FROM reference_frozen_signal_snapshots_v01 WHERE signal_snapshot_id=$1 AND signal_fingerprint=$2 AND event_id=$3",[lineage.frozenSignalSnapshotId,lineage.frozenSignalFingerprint,String(output.eventId)]);
        if(source.rowCount!==1||!['FROZEN_SIGNAL','FROZEN_PREDICTION'].includes(source.rows[0].signal_kind))throw persistenceError('PERSISTENCE_FROZEN_SIGNAL_LINEAGE_NOT_EXACT',409);
        const inserted=await client.query({text:"INSERT INTO prediction_snapshots_v01(snapshot_id,request_id,endpoint,snapshot_type,event_id,market,selection,input_sha256,output_sha256,input_payload,prediction_payload,parent_signal_id,model_version,feature_version,source_observed_at,persisted_at,capital_state,real_money) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,'LOCKED','NO') ON CONFLICT(request_id,endpoint) DO NOTHING RETURNING snapshot_id::text,input_sha256,output_sha256",values:[snapshotId,requestId,endpoint,snapshotType,String(output.eventId),String(market),selection===null?null:String(selection),inputSha256,outputSha256,JSON.stringify(input),JSON.stringify(output),parentSignalId,modelVersion,featureVersion,sourceObservedAt,persistedAt]});
        let activeSnapshotId=snapshotId,duplicate=false;
        if(inserted.rowCount!==1){
          const existing=await client.query("SELECT snapshot_id::text,input_sha256,output_sha256 FROM prediction_snapshots_v01 WHERE request_id=$1 AND endpoint=$2",[requestId,endpoint]);
          const row=existing.rows?.[0];
          if(!row)throw persistenceError('POSTGRES_PERSISTENCE_CONFLICT_WITHOUT_ROW',503);
          if(row.input_sha256!==inputSha256||row.output_sha256!==outputSha256)throw persistenceError('PERSISTENCE_IDEMPOTENCY_CONFLICT',409);
          activeSnapshotId=row.snapshot_id;duplicate=true;
        }
        const linkFingerprint=sha256Json({predictionSnapshotId:activeSnapshotId,eventId:String(output.eventId),frozenSignalSnapshotId:lineage.frozenSignalSnapshotId,frozenSignalFingerprint:lineage.frozenSignalFingerprint});
        await client.query("INSERT INTO prediction_snapshot_frozen_signal_lineage_v01(prediction_snapshot_id,event_id,frozen_signal_snapshot_id,frozen_signal_fingerprint,link_fingerprint,capital_state,real_money) VALUES($1,$2,$3,$4,$5,'LOCKED','NO') ON CONFLICT(prediction_snapshot_id) DO NOTHING",[activeSnapshotId,String(output.eventId),lineage.frozenSignalSnapshotId,lineage.frozenSignalFingerprint,linkFingerprint]);
        const check=await client.query("SELECT event_id,frozen_signal_snapshot_id,frozen_signal_fingerprint,link_fingerprint,capital_state,real_money FROM prediction_snapshot_frozen_signal_lineage_v01 WHERE prediction_snapshot_id=$1",[activeSnapshotId]);
        const linked=check.rows?.[0];
        if(check.rowCount!==1||linked.event_id!==String(output.eventId)||linked.frozen_signal_snapshot_id!==lineage.frozenSignalSnapshotId||linked.frozen_signal_fingerprint!==lineage.frozenSignalFingerprint||linked.link_fingerprint!==linkFingerprint||linked.capital_state!=='LOCKED'||linked.real_money!=='NO')throw persistenceError('PERSISTENCE_FROZEN_SIGNAL_LINEAGE_CONFLICT',409);
        await client.query('COMMIT');
        return Object.freeze({status:duplicate?'ALREADY_PERSISTED':'PERSISTED',duplicate,snapshotId:activeSnapshotId,inputSha256,outputSha256,frozenSignalSnapshotId:lineage.frozenSignalSnapshotId,frozenSignalFingerprint:lineage.frozenSignalFingerprint});
      }catch(error){
        await client.query('ROLLBACK').catch(()=>{});
        if(error?.statusCode)throw error;
        throw persistenceError('POSTGRES_PERSISTENCE_WRITE_FAILED',503,error);
      }finally{client.release();}
    },
    async getByRequest({requestId,endpoint}){
      try{
        const result=await pool.query("SELECT p.snapshot_id::text,p.request_id,p.endpoint,p.snapshot_type,p.event_id,p.market,p.selection,p.input_sha256,p.output_sha256,p.input_payload,p.prediction_payload,p.parent_signal_id,p.model_version,p.feature_version,p.source_observed_at,p.persisted_at,p.capital_state,p.real_money,l.frozen_signal_snapshot_id,l.frozen_signal_fingerprint,l.link_fingerprint FROM prediction_snapshots_v01 p JOIN prediction_snapshot_frozen_signal_lineage_v01 l ON l.prediction_snapshot_id=p.snapshot_id AND l.event_id=p.event_id WHERE p.request_id=$1 AND p.endpoint=$2",[requestId,endpoint]);
        return result.rows?.[0]??null;
      }catch(error){throw persistenceError('POSTGRES_PERSISTENCE_READ_FAILED',503,error);}
    },
    async close(){if(typeof pool.end==='function')await pool.end();}
  });
}
export async function createPostgresPredictionPersistence({connectionString=process.env.DATABASE_URL,max=Number(process.env.PREDICTION_DB_POOL_MAX||10),connectionTimeoutMillis=Number(process.env.PREDICTION_DB_CONNECT_TIMEOUT_MS||5000),idleTimeoutMillis=Number(process.env.PREDICTION_DB_IDLE_TIMEOUT_MS||30000)}={}){
  if(!connectionString)throw persistenceError('DATABASE_URL_REQUIRED_FOR_POSTGRES_PERSISTENCE',500);
  if(!Number.isInteger(max)||max<1||max>50)throw persistenceError('PREDICTION_DB_POOL_MAX_INVALID',500);
  const {Pool}=await import('pg');const pool=new Pool({connectionString,max,connectionTimeoutMillis,idleTimeoutMillis,application_name:'sports_prediction_api_v0_2'});
  return createPredictionPersistenceFromPool(pool);
}
