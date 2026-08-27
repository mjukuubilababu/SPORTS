import { sha256 } from './utils.mjs';

export const POSTGRES_FEATURE_MODEL_SIGNAL_LINEAGE_VERSION = 'v0.1';
function fail(code,cause){const e=new Error(code);if(cause)e.cause=cause;return e;}
function req(name,v){if(typeof v!=='string'||v.trim()==='')throw fail(name+'_REQUIRED');return v.trim();}
function hash(name,v){if(typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v))throw fail(name+'_INVALID');return v;}
function iso(name,v){req(name,v);const n=Date.parse(v);if(!Number.isFinite(n))throw fail(name+'_INVALID');return new Date(n).toISOString();}
function dbIso(v){return new Date(v).toISOString();}

export function prepareModelSnapshot(input){
  if(!input||typeof input!=='object')throw fail('POSTGRES_MODEL_SNAPSHOT_REQUIRED');
  if(input.payload==null)throw fail('POSTGRES_MODEL_PAYLOAD_REQUIRED');
  if(!Array.isArray(input.features)||input.features.length===0)throw fail('POSTGRES_MODEL_FEATURES_REQUIRED');
  const eventId=req('POSTGRES_MODEL_EVENT_ID',input.eventId);
  const kickoffAt=iso('POSTGRES_MODEL_KICKOFF_AT',input.kickoffAt);
  const frozenAt=iso('POSTGRES_MODEL_FROZEN_AT',input.frozenAt);
  if(Date.parse(frozenAt)>=Date.parse(kickoffAt))throw fail('POSTGRES_MODEL_POST_KICKOFF_FORBIDDEN');
  const features=input.features.map((r,i)=>({featureSequence:i,featureLineageId:req('POSTGRES_MODEL_FEATURE_LINEAGE_ID',r.featureLineageId),featureFingerprint:hash('POSTGRES_MODEL_FEATURE_FINGERPRINT',r.featureFingerprint)}));
  const keys=new Set(features.map(r=>r.featureLineageId+':'+r.featureFingerprint));
  if(keys.size!==features.length)throw fail('POSTGRES_MODEL_DUPLICATE_FEATURE_REFERENCE');
  const modelPayloadFingerprint=sha256(input.payload);
  const core={modelSnapshotId:req('POSTGRES_MODEL_SNAPSHOT_ID',input.modelSnapshotId),eventId,modelVersion:req('POSTGRES_MODEL_VERSION',input.modelVersion),modelPayloadFingerprint,kickoffAt,frozenAt,features};
  return Object.freeze({...core,modelFingerprint:sha256(core),payload:structuredClone(input.payload),capitalState:'LOCKED',realMoney:'NO'});
}

export function prepareFrozenSignal(input){
  if(!input||typeof input!=='object')throw fail('POSTGRES_FROZEN_SIGNAL_REQUIRED');
  if(input.payload==null)throw fail('POSTGRES_FROZEN_SIGNAL_PAYLOAD_REQUIRED');
  const signalKind=req('POSTGRES_FROZEN_SIGNAL_KIND',input.signalKind).toUpperCase();
  if(!['FROZEN_SIGNAL','FROZEN_PREDICTION'].includes(signalKind))throw fail('POSTGRES_FROZEN_SIGNAL_SETTLEMENT_OR_KIND_FORBIDDEN');
  const kickoffAt=iso('POSTGRES_FROZEN_SIGNAL_KICKOFF_AT',input.kickoffAt);
  const frozenAt=iso('POSTGRES_FROZEN_SIGNAL_FROZEN_AT',input.frozenAt);
  if(Date.parse(frozenAt)>=Date.parse(kickoffAt))throw fail('POSTGRES_FROZEN_SIGNAL_POST_KICKOFF_FORBIDDEN');
  const signalPayloadFingerprint=sha256(input.payload);
  const core={signalSnapshotId:req('POSTGRES_FROZEN_SIGNAL_SNAPSHOT_ID',input.signalSnapshotId),eventId:req('POSTGRES_FROZEN_SIGNAL_EVENT_ID',input.eventId),signalKind,modelSnapshotId:req('POSTGRES_FROZEN_SIGNAL_MODEL_SNAPSHOT_ID',input.modelSnapshotId),modelFingerprint:hash('POSTGRES_FROZEN_SIGNAL_MODEL_FINGERPRINT',input.modelFingerprint),signalPayloadFingerprint,kickoffAt,frozenAt};
  return Object.freeze({...core,signalFingerprint:sha256(core),payload:structuredClone(input.payload),capitalState:'LOCKED',realMoney:'NO'});
}

async function assertFeature(client,model,ref){
  const q=await client.query("SELECT f.event_id,o.captured_at,o.pre_match_eligible FROM reference_feature_provenance_lineage_v01 f JOIN reference_ingestion_observations_v01 o ON o.provenance_id=f.source_provenance_id AND o.evidence_fingerprint=f.source_evidence_fingerprint AND o.event_id=f.event_id WHERE f.lineage_id=$1 AND f.feature_fingerprint=$2",[ref.featureLineageId,ref.featureFingerprint]);
  const r=q.rows[0];
  if(q.rowCount!==1||r.event_id!==model.eventId)throw fail('POSTGRES_MODEL_FEATURE_CROSS_EVENT_OR_MISSING');
  if(r.pre_match_eligible!==true||Date.parse(dbIso(r.captured_at))>=Date.parse(model.kickoffAt))throw fail('POSTGRES_MODEL_FEATURE_POST_KICKOFF_OR_INELIGIBLE');
}

async function insertModel(client,m){
  for(const ref of m.features)await assertFeature(client,m,ref);
  await client.query("INSERT INTO reference_model_snapshots_v01(model_snapshot_id,event_id,model_version,model_fingerprint,model_payload_fingerprint,model_payload,kickoff_at,frozen_at,capital_state,real_money) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'LOCKED','NO') ON CONFLICT(model_snapshot_id) DO NOTHING",[m.modelSnapshotId,m.eventId,m.modelVersion,m.modelFingerprint,m.modelPayloadFingerprint,JSON.stringify(m.payload),m.kickoffAt,m.frozenAt]);
  const q=await client.query("SELECT event_id,model_version,model_fingerprint,model_payload_fingerprint,model_payload,kickoff_at,frozen_at,capital_state,real_money FROM reference_model_snapshots_v01 WHERE model_snapshot_id=$1",[m.modelSnapshotId]);
  const r=q.rows[0];
  if(q.rowCount!==1||r.event_id!==m.eventId||r.model_version!==m.modelVersion||r.model_fingerprint!==m.modelFingerprint||r.model_payload_fingerprint!==m.modelPayloadFingerprint||sha256(r.model_payload)!==m.modelPayloadFingerprint||dbIso(r.kickoff_at)!==m.kickoffAt||dbIso(r.frozen_at)!==m.frozenAt||r.capital_state!=='LOCKED'||r.real_money!=='NO')throw fail('POSTGRES_MODEL_SNAPSHOT_IMMUTABILITY_CONFLICT:'+m.modelSnapshotId);
  for(const ref of m.features){
    const linkFingerprint=sha256({modelSnapshotId:m.modelSnapshotId,featureSequence:ref.featureSequence,eventId:m.eventId,featureLineageId:ref.featureLineageId,featureFingerprint:ref.featureFingerprint});
    await client.query("INSERT INTO reference_model_feature_lineage_v01(model_snapshot_id,feature_sequence,event_id,feature_lineage_id,feature_fingerprint,link_fingerprint,capital_state,real_money) VALUES($1,$2,$3,$4,$5,$6,'LOCKED','NO') ON CONFLICT(model_snapshot_id,feature_sequence) DO NOTHING",[m.modelSnapshotId,ref.featureSequence,m.eventId,ref.featureLineageId,ref.featureFingerprint,linkFingerprint]);
    const q2=await client.query("SELECT event_id,feature_lineage_id,feature_fingerprint,link_fingerprint,capital_state,real_money FROM reference_model_feature_lineage_v01 WHERE model_snapshot_id=$1 AND feature_sequence=$2",[m.modelSnapshotId,ref.featureSequence]);
    const r2=q2.rows[0];
    if(q2.rowCount!==1||r2.event_id!==m.eventId||r2.feature_lineage_id!==ref.featureLineageId||r2.feature_fingerprint!==ref.featureFingerprint||r2.link_fingerprint!==linkFingerprint||r2.capital_state!=='LOCKED'||r2.real_money!=='NO')throw fail('POSTGRES_MODEL_FEATURE_LINEAGE_IMMUTABILITY_CONFLICT:'+m.modelSnapshotId);
  }
}

async function insertSignal(client,s){
  const p=await client.query("SELECT event_id,model_fingerprint,kickoff_at,frozen_at FROM reference_model_snapshots_v01 WHERE model_snapshot_id=$1",[s.modelSnapshotId]);
  const m=p.rows[0];
  if(p.rowCount!==1||m.event_id!==s.eventId||m.model_fingerprint!==s.modelFingerprint)throw fail('POSTGRES_FROZEN_SIGNAL_MODEL_CROSS_EVENT_OR_NOT_EXACT');
  if(dbIso(m.kickoff_at)!==s.kickoffAt||Date.parse(dbIso(m.frozen_at))>Date.parse(s.frozenAt))throw fail('POSTGRES_FROZEN_SIGNAL_MODEL_TEMPORAL_CONFLICT');
  await client.query("INSERT INTO reference_frozen_signal_snapshots_v01(signal_snapshot_id,event_id,signal_kind,model_snapshot_id,model_fingerprint,signal_fingerprint,signal_payload_fingerprint,signal_payload,kickoff_at,frozen_at,capital_state,real_money) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'LOCKED','NO') ON CONFLICT(signal_snapshot_id) DO NOTHING",[s.signalSnapshotId,s.eventId,s.signalKind,s.modelSnapshotId,s.modelFingerprint,s.signalFingerprint,s.signalPayloadFingerprint,JSON.stringify(s.payload),s.kickoffAt,s.frozenAt]);
  const q=await client.query("SELECT event_id,signal_kind,model_snapshot_id,model_fingerprint,signal_fingerprint,signal_payload_fingerprint,signal_payload,kickoff_at,frozen_at,capital_state,real_money FROM reference_frozen_signal_snapshots_v01 WHERE signal_snapshot_id=$1",[s.signalSnapshotId]);
  const r=q.rows[0];
  if(q.rowCount!==1||r.event_id!==s.eventId||r.signal_kind!==s.signalKind||r.model_snapshot_id!==s.modelSnapshotId||r.model_fingerprint!==s.modelFingerprint||r.signal_fingerprint!==s.signalFingerprint||r.signal_payload_fingerprint!==s.signalPayloadFingerprint||sha256(r.signal_payload)!==s.signalPayloadFingerprint||dbIso(r.kickoff_at)!==s.kickoffAt||dbIso(r.frozen_at)!==s.frozenAt||r.capital_state!=='LOCKED'||r.real_money!=='NO')throw fail('POSTGRES_FROZEN_SIGNAL_IMMUTABILITY_CONFLICT:'+s.signalSnapshotId);
}

function isPool(v){return v&&typeof v.connect==='function'&&Number.isInteger(v.totalCount)&&typeof v.query==='function';}
async function acquire(db){if(!db?.query)throw fail('POSTGRES_FEATURE_MODEL_SIGNAL_CLIENT_REQUIRED');if(isPool(db)){const client=await db.connect();return{client,release:()=>client.release()};}return{client:db,release:()=>{}};}

export async function archiveFeatureModelSignalBundle({client:database,models=[],signals=[]}){
  if(!Array.isArray(models)||!Array.isArray(signals)||(models.length===0&&signals.length===0))throw fail('POSTGRES_FEATURE_MODEL_SIGNAL_BUNDLE_REQUIRED');
  const ms=models.map(prepareModelSnapshot),ss=signals.map(prepareFrozenSignal);
  const {client,release}=await acquire(database);
  try{
    await client.query('BEGIN');
    try{
      for(const m of ms)await insertModel(client,m);
      for(const s of ss)await insertSignal(client,s);
      const bundleFingerprint=sha256({modelFingerprints:ms.map(x=>x.modelFingerprint),signalFingerprints:ss.map(x=>x.signalFingerprint)});
      await client.query('COMMIT');
      return Object.freeze({version:POSTGRES_FEATURE_MODEL_SIGNAL_LINEAGE_VERSION,status:'DURABLY_ARCHIVED',modelCount:ms.length,signalCount:ss.length,bundleFingerprint,capitalState:'LOCKED',realMoney:'NO'});
    }catch(cause){
      await client.query('ROLLBACK').catch(()=>{});
      if(cause?.message?.startsWith('POSTGRES_'))throw cause;
      if(cause?.code==='23503')throw fail('POSTGRES_FEATURE_MODEL_SIGNAL_REFERENCE_CONFLICT',cause);
      if(cause?.code==='23505')throw fail('POSTGRES_FEATURE_MODEL_SIGNAL_UNIQUE_CONFLICT',cause);
      if(cause?.code==='23514'||cause?.code==='P0001')throw fail('POSTGRES_FEATURE_MODEL_SIGNAL_CONSTRAINT_VIOLATION',cause);
      throw fail('POSTGRES_FEATURE_MODEL_SIGNAL_TRANSACTION_FAILED',cause);
    }
  }finally{release();}
}
