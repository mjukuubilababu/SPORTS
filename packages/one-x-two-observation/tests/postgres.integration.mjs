import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import pg from 'pg';
import {evaluateBatch,normalizeObservation} from '../src/observation.mjs';import {persistBatch} from '../src/postgres-persistence.mjs';
const url=process.env.TEST_DATABASE_URL;const raw=JSON.parse(fs.readFileSync(new URL('../data/betpawa-real-world-observation-batch-v0.1.json',import.meta.url)));
test('PostgreSQL 16 enforces immutable, atomic, idempotent observation evidence',{skip:!url},async()=>{const pool=new pg.Pool({connectionString:url,max:4});
 try{
  await pool.query('TRUNCATE one_x_two_counterfactual_replays,one_x_two_observations,one_x_two_observation_batches CASCADE');
  const e=evaluateBatch(raw);await persistBatch(pool,e);await persistBatch(pool,e);
  assert.equal(Number((await pool.query('SELECT count(*) n FROM one_x_two_observations')).rows[0].n),5);
  const changed={...e,observations:e.observations.map((x,i)=>i?x:{...x,entry_odds:9,payload_fingerprint:'a'.repeat(64)})};
  await assert.rejects(()=>persistBatch(pool,changed),/CHANGED_PAYLOAD/);
  const rollbackRaw={...raw,batch_id:'rollback-batch',observations:raw.observations.map((x,i)=>({...x,observation_id:'rollback-'+i}))};
  await assert.rejects(()=>persistBatch(pool,evaluateBatch(rollbackRaw),{failAfter:2}),/INJECTED_PARTIAL_FAILURE/);
  assert.equal(Number((await pool.query("SELECT count(*) n FROM one_x_two_observations WHERE batch_id='rollback-batch'")).rows[0].n),0);
  await assert.rejects(()=>pool.query("UPDATE one_x_two_observations SET selection='AWAY' WHERE observation_id=$1",[e.observations[0].observation_id]),/IMMUTABLE_ONE_X_TWO_EVIDENCE/);
  await assert.rejects(()=>pool.query("DELETE FROM one_x_two_observations WHERE observation_id=$1",[e.observations[0].observation_id]),/IMMUTABLE_ONE_X_TWO_EVIDENCE/);

  const timedRaw={...raw,batch_id:'timed-batch',ingestion_timing:'PRE_KICKOFF_VERIFIED',observations:[{...raw.observations[0],observation_id:'timed-observation',event_id:'event-a',entry_observed_at:'2026-01-01T10:00:00Z',kickoff_at:'2026-01-01T12:00:00Z'}]};
  const timed=evaluateBatch(timedRaw);await persistBatch(pool,timed);
  await assert.rejects(()=>pool.query(`INSERT INTO one_x_two_counterfactual_replays(replay_id,observation_id,event_id,cutoff_at,decision,probabilities,confidence,flags,input_fingerprint,created_at) VALUES('cross','timed-observation','event-b','2026-01-01T11:00:00Z','ABSTAIN','{"home":0.4,"draw":0.3,"away":0.3}',NULL,'[]',$1,now())`,['b'.repeat(64)]),/CROSS_EVENT_REPLAY_REJECTED/);
  await assert.rejects(()=>pool.query(`INSERT INTO one_x_two_counterfactual_replays(replay_id,observation_id,event_id,cutoff_at,decision,probabilities,confidence,flags,input_fingerprint,created_at) VALUES('late','timed-observation','event-a','2026-01-01T12:00:01Z','ABSTAIN','{"home":0.4,"draw":0.3,"away":0.3}',NULL,'[]',$1,now())`,['c'.repeat(64)]),/REPLAY_CUTOFF_AFTER_KICKOFF/);

  const columns=(await pool.query("SELECT string_agg(column_name,',' ORDER BY ordinal_position) c FROM information_schema.columns WHERE table_name='one_x_two_observations'")).rows[0].c;
  assert.ok(columns.includes('closing_provider'));
  await assert.rejects(()=>pool.query(`INSERT INTO one_x_two_observations SELECT 'bad-close',batch_id,dataset_type,status,observation_source,origin_decision,ingestion_timing,provider,event_id,competition,season,home_team,away_team,selection,entry_odds,entry_provider,entry_observed_at,kickoff_at,implied_entry_probability,2.0,'1xBet','2026-01-01T11:00:00Z',true,0,home_score,away_score,outcome,failure_classification,'EVALUATED',system_probability,confidence,prematch_signal_id,favorite_rank,trap_flag,market_context,$1,$2,created_at FROM one_x_two_observations WHERE observation_id='timed-observation'`,['d'.repeat(64),'e'.repeat(64)]),/check constraint/);
 }finally{await pool.end();}
});
