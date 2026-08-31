function isPool(db){return db&&typeof db.connect==='function';}
async function inTransaction(db,work){
  const client=isPool(db)?await db.connect():db;
  try{
    await client.query('BEGIN');
    const result=await work(client);
    await client.query('COMMIT');
    return result;
  }catch(error){
    try{await client.query('ROLLBACK');}catch{}
    throw error;
  }finally{if(isPool(db))client.release();}
}
function rowValues(o){return [
 o.observation_id,o.batch_id,o.dataset_type,o.status,o.observation_source,o.origin_decision,o.ingestion_timing,o.provider,
 o.event_id,o.competition,o.season,o.home_team,o.away_team,o.selection,o.entry_odds,o.entry_provider,o.entry_observed_at,o.kickoff_at,
 o.implied_entry_probability,o.closing_odds,o.closing_provider,o.closing_observed_at,o.closing_verified,o.clv,o.home_score,o.away_score,
 o.outcome,o.failure_classification,o.state,o.system_probability,o.confidence,o.prematch_signal_id,o.favorite_rank,o.trap_flag,
 o.market_context,o.identity_fingerprint,o.payload_fingerprint,o.created_at
];}
export async function persistBatch(db,evaluation,{failAfter=null}={}){
 return inTransaction(db,async client=>{
  const batchPayload=JSON.stringify({batch_id:evaluation.batch_id,dataset_type:evaluation.dataset_type,status:evaluation.status,n:evaluation.n,wins:evaluation.wins,losses:evaluation.losses,hit_rate:evaluation.hit_rate});
  const batchFingerprint=(await import('./observation.mjs')).fingerprint(JSON.parse(batchPayload));
  const b=await client.query(`INSERT INTO one_x_two_observation_batches
   (batch_id,dataset_type,status,provider,observation_source,origin_decision,payload_fingerprint,created_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)
   ON CONFLICT(batch_id) DO UPDATE SET batch_id=EXCLUDED.batch_id
   WHERE one_x_two_observation_batches.payload_fingerprint=EXCLUDED.payload_fingerprint
   RETURNING batch_id`,[evaluation.batch_id,evaluation.dataset_type,evaluation.status,evaluation.observations[0].provider,evaluation.observations[0].observation_source,evaluation.observations[0].origin_decision,batchFingerprint,evaluation.observations[0].created_at]);
  if(b.rowCount!==1)throw new Error('CHANGED_BATCH_SAME_IDENTITY_REJECTED');
  let inserted=0;
  for(const o of evaluation.observations){
   const q=await client.query(`INSERT INTO one_x_two_observations
    (observation_id,batch_id,dataset_type,status,observation_source,origin_decision,ingestion_timing,provider,event_id,competition,season,home_team,away_team,selection,entry_odds,entry_provider,entry_observed_at,kickoff_at,implied_entry_probability,closing_odds,closing_provider,closing_observed_at,closing_verified,clv,home_score,away_score,outcome,failure_classification,state,system_probability,confidence,prematch_signal_id,favorite_rank,trap_flag,market_context,identity_fingerprint,payload_fingerprint,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38)
    ON CONFLICT(observation_id) DO UPDATE SET observation_id=EXCLUDED.observation_id
    WHERE one_x_two_observations.payload_fingerprint=EXCLUDED.payload_fingerprint
    RETURNING observation_id`,rowValues(o));
   if(q.rowCount!==1)throw new Error('CHANGED_PAYLOAD_SAME_IDENTITY_REJECTED');
   inserted++;if(failAfter===inserted)throw new Error('INJECTED_PARTIAL_FAILURE');
  }
  return {batch_id:evaluation.batch_id,observations:evaluation.n};
 });
}
export async function persistReplay(db,replay){
 return inTransaction(db,async client=>{
  const r=await client.query(`INSERT INTO one_x_two_counterfactual_replays
   (replay_id,observation_id,event_id,cutoff_at,decision,probabilities,confidence,flags,input_fingerprint,created_at)
   VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10)
   ON CONFLICT(replay_id) DO UPDATE SET replay_id=EXCLUDED.replay_id
   WHERE one_x_two_counterfactual_replays.input_fingerprint=EXCLUDED.input_fingerprint
   RETURNING replay_id`,[replay.replay_id,replay.observation_id,replay.event_id,replay.cutoff_at,replay.decision,JSON.stringify(replay.probabilities),replay.confidence,JSON.stringify(replay.flags),replay.input_fingerprint,replay.created_at]);
  if(r.rowCount!==1)throw new Error('CHANGED_REPLAY_SAME_IDENTITY_REJECTED');
  return replay.replay_id;
 });
}
