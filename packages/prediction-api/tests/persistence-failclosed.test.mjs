import test from 'node:test';
import assert from 'node:assert/strict';
import { createPredictionApiServer } from '../src/server.mjs';
import { createPredictionPersistenceFromPool } from '../src/postgres-persistence.mjs';

function payload(){
  return {
    eventId:'FAIL-CLOSED-E1',market:'TOTAL_3_5',selection:'UNDER',kickoffAt:'2026-08-26T19:00:00Z',offeredOdds:1.9,
    confidence:{score:0.9,criticalBlocks:[]},
    models:[{
      modelVersion:'POISSON_V1',eventId:'FAIL-CLOSED-E1',market:'TOTAL_3_5',selection:'UNDER',probability:0.6,
      usesMarketOdds:false,frozenAt:'2026-08-26T18:00:00Z',source:'MODEL_SNAPSHOT',snapshotId:'FAIL-S1',snapshotSha256:'a'.repeat(64),
      correlationFamily:'POISSON_FAMILY',baseWeight:1,validation:1,calibration:1,freshness:1,drift:1,availability:1
    }]
  };
}

async function withServer(persistence,fn){
  const server=createPredictionApiServer({persistence});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{return await fn(`http://127.0.0.1:${server.address().port}`);}finally{await new Promise(resolve=>server.close(resolve));}
}

test('configured persistence failure blocks prediction response',async()=>{
  const persistence={
    mode:'POSTGRES',
    async healthCheck(){return {status:'ok',mode:'POSTGRES'};},
    async persistPrediction(){throw Object.assign(new Error('POSTGRES_PERSISTENCE_WRITE_FAILED'),{statusCode:503});}
  };
  await withServer(persistence,async base=>{
    const response=await fetch(`${base}/v1/predict`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload())});
    const body=await response.json();
    assert.equal(response.status,503);
    assert.equal(body.error,'POSTGRES_PERSISTENCE_WRITE_FAILED');
    assert.equal(body.capitalState,'LOCKED');
    assert.equal(body.realMoney,'NO');
  });
});

test('health endpoint fails closed when configured PostgreSQL is unavailable',async()=>{
  const persistence={
    mode:'POSTGRES',
    async healthCheck(){throw Object.assign(new Error('POSTGRES_PERSISTENCE_UNAVAILABLE'),{statusCode:503});},
    async persistPrediction(){throw new Error('should not run');}
  };
  await withServer(persistence,async base=>{
    const response=await fetch(`${base}/health`);
    const body=await response.json();
    assert.equal(response.status,503);
    assert.equal(body.error,'POSTGRES_PERSISTENCE_UNAVAILABLE');
  });
});


test('pool acquisition failure is sanitized as stable 503 persistence failure',async()=>{
  const pool={
    query(){throw new Error('not used');},
    async connect(){throw new Error('connect ECONNREFUSED postgresql://secret-host');}
  };
  const persistence=createPredictionPersistenceFromPool(pool);
  const input=payload();
  input.persistenceLineage={frozenSignalSnapshotId:'SIGNAL-X',frozenSignalFingerprint:'a'.repeat(64)};
  await assert.rejects(
    persistence.persistPrediction({
      requestId:'connect-failure',
      endpoint:'/v1/predict',
      input,
      output:{eventId:input.eventId,market:input.market,selection:input.selection,capitalState:'LOCKED',realMoney:'NO'}
    }),
    error=>error?.message==='POSTGRES_PERSISTENCE_WRITE_FAILED'&&error?.statusCode===503&&!error.message.includes('secret-host')
  );
});


test('lineage attestation endpoint fails closed without PostgreSQL persistence',async()=>{
  await withServer(null,async base=>{
    const response=await fetch(`${base}/v1/predictions/00000000-0000-4000-8000-000000000001/lineage`);
    assert.equal(response.status,503);
    const body=await response.json();
    assert.equal(body.error,'POSTGRES_LINEAGE_ATTESTATION_REQUIRED');
    assert.equal(body.capitalState,'LOCKED');
    assert.equal(body.realMoney,'NO');
  });
});

test('lineage attestation rejects invalid ids and sanitizes database read failure',async()=>{
  const pool={
    async query(){throw new Error('read ECONNRESET postgresql://secret-host');},
    async connect(){throw new Error('not used');}
  };
  const persistence=createPredictionPersistenceFromPool(pool);
  await assert.rejects(persistence.attestPredictionLineage({snapshotId:'not-a-uuid'}),error=>error?.message==='PREDICTION_SNAPSHOT_ID_INVALID'&&error?.statusCode===400);
  await assert.rejects(
    persistence.attestPredictionLineage({snapshotId:'00000000-0000-4000-8000-000000000001'}),
    error=>error?.message==='POSTGRES_LINEAGE_ATTESTATION_READ_FAILED'&&error?.statusCode===503&&!error.message.includes('secret-host')
  );
});


test('PostgreSQL persistence rejects multi-model prematch writes it cannot attest exactly',async()=>{
  const pool={async query(){throw new Error('not used');},async connect(){throw new Error('must reject before pool acquisition');}};
  const persistence=createPredictionPersistenceFromPool(pool);
  const input=payload();
  input.models.push({...input.models[0],modelVersion:'POISSON_V2',snapshotId:'FAIL-S2',snapshotSha256:'b'.repeat(64)});
  input.persistenceLineage={frozenSignalSnapshotId:'SIGNAL-X',frozenSignalFingerprint:'a'.repeat(64)};
  await assert.rejects(persistence.persistPrediction({requestId:'multi-model',endpoint:'/v1/predict',input,output:{eventId:input.eventId,market:input.market,selection:input.selection,capitalState:'LOCKED',realMoney:'NO'}}),error=>error?.message==='PERSISTENCE_SINGLE_MODEL_LINEAGE_REQUIRED'&&error?.statusCode===409);
});


test('health readiness fails closed when upstream attestation schema is incomplete',async()=>{
  const pool={async query(){return {rows:[{table_name:'prediction_snapshots_v01',lineage_table:'prediction_snapshot_frozen_signal_lineage_v01',observations_table:'reference_ingestion_observations_v01',features_table:'reference_feature_provenance_lineage_v01',models_table:'reference_model_snapshots_v01',model_features_table:'reference_model_feature_lineage_v01',signals_table:'reference_frozen_signal_snapshots_v01',feature_payload_ready:false}]};},async connect(){throw new Error('not used');}};
  await assert.rejects(createPredictionPersistenceFromPool(pool).healthCheck(),error=>error?.message==='POSTGRES_PERSISTENCE_UNAVAILABLE'&&error?.statusCode===503);
});
