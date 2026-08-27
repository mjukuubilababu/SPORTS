import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { archiveIngestionProvenanceBundle, prepareFeatureProvenanceLineage } from '../src/postgres-ingestion-provenance.mjs';
import { archiveFeatureModelSignalBundle, prepareModelSnapshot, prepareFrozenSignal } from '../src/postgres-feature-model-signal-lineage.mjs';

const connectionString=process.env.TEST_DATABASE_URL??process.env.DATABASE_URL;

function fixture(suffix='BASE'){
  const eventId='MATCH-LINEAGE-'+suffix;
  const kickoffAt='2026-08-28T15:00:00.000Z';
  const observation={provenanceId:'PROV-'+suffix,observationId:'OBS-'+suffix,eventId,entityType:'MATCH',entityId:eventId,evidenceKind:'TEAM_STATS',source:'TEST_SOURCE',sourceType:'PUBLIC_WEB',sourceUrl:'https://example.test/'+suffix,observedAt:'2026-08-28T12:00:00.000Z',availableAt:'2026-08-28T12:00:01.000Z',capturedAt:'2026-08-28T12:00:02.000Z',predictionCutoff:'2026-08-28T14:00:00.000Z',isVerified:true,payload:{event_id:eventId,xg:1.4}};
  const feature={lineageId:'FEATURE-LINEAGE-'+suffix,featureId:'FEATURE-'+suffix,eventId,featureName:'xg_strength',featureVersion:'FEATURE_V0_1',featurePayload:{xg_strength:0.71},sourceProvenanceId:observation.provenanceId,sourceEvidenceFingerprint:null,createdAt:'2026-08-28T12:05:00.000Z'};
  return{eventId,kickoffAt,observation,feature};
}
async function seed(pool,data){
  const { prepareIngestionObservation }=await import('../src/postgres-ingestion-provenance.mjs');
  const source=prepareIngestionObservation(data.observation);
  data.feature.sourceEvidenceFingerprint=source.evidenceFingerprint;
  await archiveIngestionProvenanceBundle({client:pool,observations:[data.observation],featureLineage:[data.feature]});
  return prepareFeatureProvenanceLineage(data.feature);
}
function modelInput(data,feature,overrides={}){
  return{modelSnapshotId:'MODEL-'+data.eventId,eventId:data.eventId,modelVersion:'MODEL_V0_1',payload:{probability:0.64,market:'UNDER_3_5'},kickoffAt:data.kickoffAt,frozenAt:'2026-08-28T13:00:00.000Z',features:[{featureLineageId:feature.lineageId,featureFingerprint:feature.featureFingerprint}],...overrides};
}
function signalInput(data,model,overrides={}){
  return{signalSnapshotId:'SIGNAL-'+data.eventId,eventId:data.eventId,signalKind:'FROZEN_SIGNAL',modelSnapshotId:model.modelSnapshotId,modelFingerprint:model.modelFingerprint,payload:{market:'UNDER_3_5',probability:0.64,qualified:true},kickoffAt:data.kickoffAt,frozenAt:'2026-08-28T13:05:00.000Z',...overrides};
}

test('exact source to feature to model to frozen signal lineage is immutable and exact replay idempotent',{skip:!connectionString},async()=>{
  const pool=new Pool({connectionString});const data=fixture('EXACT');
  try{
    const feature=await seed(pool,data);
    const model=prepareModelSnapshot(modelInput(data,feature));
    const signal=prepareFrozenSignal(signalInput(data,model));
    const first=await archiveFeatureModelSignalBundle({client:pool,models:[modelInput(data,feature)],signals:[signalInput(data,model)]});
    const replay=await archiveFeatureModelSignalBundle({client:pool,models:[modelInput(data,feature)],signals:[signalInput(data,model)]});
    assert.equal(replay.bundleFingerprint,first.bundleFingerprint);
    assert.equal(first.capitalState,'LOCKED');assert.equal(first.realMoney,'NO');
    const chain=await pool.query("SELECT s.signal_snapshot_id,s.model_fingerprint,m.model_fingerprint,l.feature_fingerprint,f.feature_fingerprint,o.evidence_fingerprint FROM reference_frozen_signal_snapshots_v01 s JOIN reference_model_snapshots_v01 m ON m.model_snapshot_id=s.model_snapshot_id AND m.model_fingerprint=s.model_fingerprint AND m.event_id=s.event_id JOIN reference_model_feature_lineage_v01 l ON l.model_snapshot_id=m.model_snapshot_id AND l.event_id=m.event_id JOIN reference_feature_provenance_lineage_v01 f ON f.lineage_id=l.feature_lineage_id AND f.feature_fingerprint=l.feature_fingerprint AND f.event_id=l.event_id JOIN reference_ingestion_observations_v01 o ON o.provenance_id=f.source_provenance_id AND o.evidence_fingerprint=f.source_evidence_fingerprint AND o.event_id=f.event_id WHERE s.signal_snapshot_id=$1",[signal.signalSnapshotId]);
    assert.equal(chain.rowCount,1);
    assert.equal(chain.rows[0].model_fingerprint,model.modelFingerprint);
    assert.equal(chain.rows[0].feature_fingerprint,feature.featureFingerprint);
    await assert.rejects(archiveFeatureModelSignalBundle({client:pool,models:[modelInput(data,feature,{payload:{probability:0.99}})]}),/POSTGRES_MODEL_SNAPSHOT_IMMUTABILITY_CONFLICT/);
  }finally{await pool.end();}
});

test('pg.Pool uses one dedicated PoolClient and partial failure rolls back the model',{skip:!connectionString},async()=>{
  const pool=new Pool({connectionString});const data=fixture('POOL');let connects=0,releases=0;
  try{
    const feature=await seed(pool,data);const model=prepareModelSnapshot(modelInput(data,feature));
    const guarded={get totalCount(){return pool.totalCount;},query(){throw new Error('POOL_QUERY_FORBIDDEN');},async connect(){connects++;const c=await pool.connect();const release=c.release.bind(c);c.release=()=>{releases++;release();};return c;}};
    await assert.rejects(archiveFeatureModelSignalBundle({client:guarded,models:[modelInput(data,feature)],signals:[signalInput(data,model,{modelFingerprint:'0'.repeat(64)})]}),/POSTGRES_FROZEN_SIGNAL_MODEL_CROSS_EVENT_OR_NOT_EXACT/);
    assert.equal(connects,1);assert.equal(releases,1);
    const q=await pool.query('SELECT count(*)::int count FROM reference_model_snapshots_v01 WHERE model_snapshot_id=$1',[model.modelSnapshotId]);
    assert.equal(q.rows[0].count,0);
  }finally{await pool.end();}
});

test('cross-event lineage is rejected at application and PostgreSQL levels',{skip:!connectionString},async()=>{
  const pool=new Pool({connectionString});const data=fixture('CROSS');
  try{
    const feature=await seed(pool,data);
    const cross=modelInput(data,feature,{modelSnapshotId:'MODEL-CROSS-EVENT',eventId:'MATCH-OTHER'});
    await assert.rejects(archiveFeatureModelSignalBundle({client:pool,models:[cross]}),/POSTGRES_MODEL_FEATURE_CROSS_EVENT_OR_MISSING/);
    const prepared=prepareModelSnapshot(cross);
    await pool.query("INSERT INTO reference_model_snapshots_v01(model_snapshot_id,event_id,model_version,model_fingerprint,model_payload_fingerprint,model_payload,kickoff_at,frozen_at,capital_state,real_money) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'LOCKED','NO')",[prepared.modelSnapshotId,prepared.eventId,prepared.modelVersion,prepared.modelFingerprint,prepared.modelPayloadFingerprint,JSON.stringify(prepared.payload),prepared.kickoffAt,prepared.frozenAt]);
    await assert.rejects(pool.query("INSERT INTO reference_model_feature_lineage_v01(model_snapshot_id,feature_sequence,event_id,feature_lineage_id,feature_fingerprint,link_fingerprint,capital_state,real_money) VALUES($1,0,$2,$3,$4,$5,'LOCKED','NO')",[prepared.modelSnapshotId,prepared.eventId,feature.lineageId,feature.featureFingerprint,'1'.repeat(64)]),e=>e?.code==='23503'||e?.code==='P0001');
  }finally{await pool.end();}
});

test('post-kickoff source evidence is rejected by application and DB trigger',{skip:!connectionString},async()=>{
  const pool=new Pool({connectionString});const data=fixture('LATE');
  data.observation.capturedAt='2026-08-28T15:00:01.000Z';data.observation.predictionCutoff='2026-08-28T16:00:00.000Z';
  try{
    const feature=await seed(pool,data);const input=modelInput(data,feature,{modelSnapshotId:'MODEL-LATE'});
    await assert.rejects(archiveFeatureModelSignalBundle({client:pool,models:[input]}),/POSTGRES_MODEL_FEATURE_POST_KICKOFF_OR_INELIGIBLE/);
    const m=prepareModelSnapshot(input);
    await pool.query("INSERT INTO reference_model_snapshots_v01(model_snapshot_id,event_id,model_version,model_fingerprint,model_payload_fingerprint,model_payload,kickoff_at,frozen_at,capital_state,real_money) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'LOCKED','NO')",[m.modelSnapshotId,m.eventId,m.modelVersion,m.modelFingerprint,m.modelPayloadFingerprint,JSON.stringify(m.payload),m.kickoffAt,m.frozenAt]);
    await assert.rejects(pool.query("INSERT INTO reference_model_feature_lineage_v01(model_snapshot_id,feature_sequence,event_id,feature_lineage_id,feature_fingerprint,link_fingerprint,capital_state,real_money) VALUES($1,0,$2,$3,$4,$5,'LOCKED','NO')",[m.modelSnapshotId,m.eventId,feature.lineageId,feature.featureFingerprint,'2'.repeat(64)]),e=>e?.code==='P0001');
  }finally{await pool.end();}
});

test('settlement variants remain separate in JavaScript and PostgreSQL',{skip:!connectionString},async()=>{
  const pool=new Pool({connectionString});const data=fixture('SETTLE');
  try{
    for(const kind of [' settlement ','SeTtLeMeNt',' prediction_settlement ','Prediction_Settlement'])assert.throws(()=>prepareFrozenSignal({signalSnapshotId:'X',eventId:data.eventId,signalKind:kind,modelSnapshotId:'M',modelFingerprint:'0'.repeat(64),payload:{},kickoffAt:data.kickoffAt,frozenAt:'2026-08-28T13:00:00.000Z'}),/POSTGRES_FROZEN_SIGNAL_SETTLEMENT_OR_KIND_FORBIDDEN/);
    await assert.rejects(pool.query("INSERT INTO reference_frozen_signal_snapshots_v01(signal_snapshot_id,event_id,signal_kind,model_snapshot_id,model_fingerprint,signal_fingerprint,signal_payload_fingerprint,signal_payload,kickoff_at,frozen_at,capital_state,real_money) VALUES('BAD-SETTLEMENT','E',' settlement ','M',$1,$1,$1,'{}'::jsonb,$2,$3,'LOCKED','NO')",['0'.repeat(64),data.kickoffAt,'2026-08-28T13:00:00.000Z']),e=>e?.code==='23514'||e?.code==='23503');
  }finally{await pool.end();}
});

test('UPDATE and DELETE are rejected for all new immutable tables',{skip:!connectionString},async()=>{
  const pool=new Pool({connectionString});const data=fixture('IMMUTABLE');
  try{
    const feature=await seed(pool,data);const model=prepareModelSnapshot(modelInput(data,feature));const signal=prepareFrozenSignal(signalInput(data,model));
    await archiveFeatureModelSignalBundle({client:pool,models:[modelInput(data,feature)],signals:[signalInput(data,model)]});
    const rows=[['reference_model_snapshots_v01','model_snapshot_id',model.modelSnapshotId],['reference_model_feature_lineage_v01','model_snapshot_id',model.modelSnapshotId],['reference_frozen_signal_snapshots_v01','signal_snapshot_id',signal.signalSnapshotId]];
    for(const [table,key,value] of rows){
      await assert.rejects(pool.query('UPDATE '+table+' SET capital_state=capital_state WHERE '+key+'=$1',[value]),/feature model signal lineage is immutable/i);
      await assert.rejects(pool.query('DELETE FROM '+table+' WHERE '+key+'=$1',[value]),/feature model signal lineage is immutable/i);
    }
  }finally{await pool.end();}
});


test('DB rejects an event-A model linked through a row claiming event B feature lineage',{skip:!connectionString},async()=>{
  const pool=new Pool({connectionString});const a=fixture('MODEL-A');const b=fixture('FEATURE-B');
  try{
    const featureA=await seed(pool,a);const featureB=await seed(pool,b);
    const modelA=prepareModelSnapshot(modelInput(a,featureA));
    await archiveFeatureModelSignalBundle({client:pool,models:[modelInput(a,featureA)]});
    await assert.rejects(
      pool.query("INSERT INTO reference_model_feature_lineage_v01(model_snapshot_id,feature_sequence,event_id,feature_lineage_id,feature_fingerprint,link_fingerprint,capital_state,real_money) VALUES($1,1,$2,$3,$4,$5,'LOCKED','NO')",[modelA.modelSnapshotId,b.eventId,featureB.lineageId,featureB.featureFingerprint,'3'.repeat(64)]),
      error=>error?.code==='23503'||error?.code==='P0001'
    );
  }finally{await pool.end();}
});

test('evidence captured after model freeze but before kickoff is rejected by app and DB',{skip:!connectionString},async()=>{
  const pool=new Pool({connectionString});const data=fixture('AFTER-FREEZE');
  data.observation.capturedAt='2026-08-28T13:30:00.000Z';
  data.observation.predictionCutoff='2026-08-28T14:00:00.000Z';
  try{
    const feature=await seed(pool,data);
    const input=modelInput(data,feature,{modelSnapshotId:'MODEL-AFTER-FREEZE',frozenAt:'2026-08-28T13:00:00.000Z'});
    await assert.rejects(
      archiveFeatureModelSignalBundle({client:pool,models:[input]}),
      /POSTGRES_MODEL_FEATURE_POST_KICKOFF_OR_INELIGIBLE/
    );
    const model=prepareModelSnapshot(input);
    await pool.query("INSERT INTO reference_model_snapshots_v01(model_snapshot_id,event_id,model_version,model_fingerprint,model_payload_fingerprint,model_payload,kickoff_at,frozen_at,capital_state,real_money) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'LOCKED','NO')",[model.modelSnapshotId,model.eventId,model.modelVersion,model.modelFingerprint,model.modelPayloadFingerprint,JSON.stringify(model.payload),model.kickoffAt,model.frozenAt]);
    await assert.rejects(
      pool.query("INSERT INTO reference_model_feature_lineage_v01(model_snapshot_id,feature_sequence,event_id,feature_lineage_id,feature_fingerprint,link_fingerprint,capital_state,real_money) VALUES($1,0,$2,$3,$4,$5,'LOCKED','NO')",[model.modelSnapshotId,model.eventId,feature.lineageId,feature.featureFingerprint,'4'.repeat(64)]),
      error=>error?.code==='P0001'
    );
  }finally{await pool.end();}
});
