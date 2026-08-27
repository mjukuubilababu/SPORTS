import { createHash, randomUUID } from 'node:crypto';

export const PREDICTION_PERSISTENCE_VERSION='POSTGRES_PREDICTION_PERSISTENCE_V0_1';
export const PREDICTION_PERSISTENCE_MODE='POSTGRES';

function stable(value){
  if(value===null || typeof value!=='object') return value;
  if(Array.isArray(value)) return value.map(stable);
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
}

export function sha256Json(value){
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function persistenceError(message,statusCode=503,cause){
  const error=new Error(message,{cause});
  error.statusCode=statusCode;
  return error;
}

function assertPersistenceInput({requestId,endpoint,input,output}){
  if(!requestId || typeof requestId!=='string') throw persistenceError('PERSISTENCE_REQUEST_ID_REQUIRED',400);
  if(!['/v1/predict','/v1/predict/live'].includes(endpoint)) throw persistenceError('PERSISTENCE_ENDPOINT_INVALID',400);
  if(!input || typeof input!=='object' || Array.isArray(input)) throw persistenceError('PERSISTENCE_INPUT_OBJECT_REQUIRED',400);
  if(!output || typeof output!=='object' || Array.isArray(output)) throw persistenceError('PERSISTENCE_OUTPUT_OBJECT_REQUIRED',400);
  if(!output.eventId) throw persistenceError('PERSISTENCE_EVENT_ID_REQUIRED',400);
  if(output.capitalState!=='LOCKED' || output.realMoney!=='NO') throw persistenceError('PERSISTENCE_CAPITAL_GOVERNANCE_VIOLATION',500);
}

export function createPredictionPersistenceFromPool(pool,{clock=()=>new Date()}={}){
  if(!pool || typeof pool.query!=='function') throw new Error('POSTGRES_POOL_REQUIRED');

  return Object.freeze({
    mode:PREDICTION_PERSISTENCE_MODE,
    version:PREDICTION_PERSISTENCE_VERSION,

    async healthCheck(){
      try{
        const result=await pool.query("SELECT current_database() AS database_name, to_regclass('prediction_snapshots_v01')::text AS table_name");
        if(result.rows?.[0]?.table_name!=='prediction_snapshots_v01') throw new Error('PREDICTION_SNAPSHOT_TABLE_MISSING');
        return Object.freeze({status:'ok',mode:PREDICTION_PERSISTENCE_MODE,database:'REDACTED',table:'prediction_snapshots_v01'});
      }catch(error){
        throw persistenceError('POSTGRES_PERSISTENCE_UNAVAILABLE',503,error);
      }
    },

    async persistPrediction({requestId,endpoint,input,output}){
      assertPersistenceInput({requestId,endpoint,input,output});
      const snapshotId=randomUUID();
      const snapshotType=endpoint==='/v1/predict/live'?'LIVE':'PREMATCH';
      const market=output.market ?? (snapshotType==='LIVE'?'1X2':'UNKNOWN');
      const selection=output.selection ?? null;
      const inputSha256=sha256Json(input);
      const outputSha256=sha256Json(output);
      const persistedAt=clock().toISOString();
      const parentSignalId=output.audit?.parentSignalId ?? null;
      const modelVersion=output.audit?.modelVersion ?? null;
      const featureVersion=output.audit?.featureVersion ?? null;
      const sourceObservedAt=output.audit?.observedAt ?? null;

      try{
        const inserted=await pool.query({
          text:`INSERT INTO prediction_snapshots_v01(
            snapshot_id,request_id,endpoint,snapshot_type,event_id,market,selection,
            input_sha256,output_sha256,input_payload,prediction_payload,parent_signal_id,
            model_version,feature_version,source_observed_at,persisted_at,capital_state,real_money
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18)
          ON CONFLICT (request_id,endpoint) DO NOTHING
          RETURNING snapshot_id::text,input_sha256,output_sha256`,
          values:[
            snapshotId,requestId,endpoint,snapshotType,String(output.eventId),String(market),selection===null?null:String(selection),
            inputSha256,outputSha256,JSON.stringify(input),JSON.stringify(output),parentSignalId,modelVersion,featureVersion,
            sourceObservedAt,persistedAt,'LOCKED','NO'
          ]
        });
        if(inserted.rowCount===1){
          return Object.freeze({status:'PERSISTED',duplicate:false,snapshotId,inputSha256,outputSha256});
        }

        const existing=await pool.query({
          text:'SELECT snapshot_id::text,input_sha256,output_sha256 FROM prediction_snapshots_v01 WHERE request_id=$1 AND endpoint=$2',
          values:[requestId,endpoint]
        });
        const row=existing.rows?.[0];
        if(!row) throw persistenceError('POSTGRES_PERSISTENCE_CONFLICT_WITHOUT_ROW',503);
        if(row.input_sha256!==inputSha256 || row.output_sha256!==outputSha256){
          throw persistenceError('PERSISTENCE_IDEMPOTENCY_CONFLICT',409);
        }
        return Object.freeze({status:'ALREADY_PERSISTED',duplicate:true,snapshotId:row.snapshot_id,inputSha256,outputSha256});
      }catch(error){
        if(error?.statusCode) throw error;
        throw persistenceError('POSTGRES_PERSISTENCE_WRITE_FAILED',503,error);
      }
    },

    async getByRequest({requestId,endpoint}){
      try{
        const result=await pool.query({
          text:`SELECT snapshot_id::text,request_id,endpoint,snapshot_type,event_id,market,selection,
                       input_sha256,output_sha256,input_payload,prediction_payload,parent_signal_id,
                       model_version,feature_version,source_observed_at,persisted_at,capital_state,real_money
                FROM prediction_snapshots_v01 WHERE request_id=$1 AND endpoint=$2`,
          values:[requestId,endpoint]
        });
        return result.rows?.[0] ?? null;
      }catch(error){
        throw persistenceError('POSTGRES_PERSISTENCE_READ_FAILED',503,error);
      }
    },

    async close(){
      if(typeof pool.end==='function') await pool.end();
    }
  });
}

export async function createPostgresPredictionPersistence({
  connectionString=process.env.DATABASE_URL,
  max=Number(process.env.PREDICTION_DB_POOL_MAX || 10),
  connectionTimeoutMillis=Number(process.env.PREDICTION_DB_CONNECT_TIMEOUT_MS || 5000),
  idleTimeoutMillis=Number(process.env.PREDICTION_DB_IDLE_TIMEOUT_MS || 30000)
}={}){
  if(!connectionString) throw persistenceError('DATABASE_URL_REQUIRED_FOR_POSTGRES_PERSISTENCE',500);
  if(!Number.isInteger(max) || max<1 || max>50) throw persistenceError('PREDICTION_DB_POOL_MAX_INVALID',500);
  const {Pool}=await import('pg');
  const pool=new Pool({connectionString,max,connectionTimeoutMillis,idleTimeoutMillis,application_name:'sports_prediction_api_v0_1'});
  return createPredictionPersistenceFromPool(pool);
}
