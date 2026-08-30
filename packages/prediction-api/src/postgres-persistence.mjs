import { createHash, randomUUID } from 'node:crypto';
import { orchestrateModelProbabilities } from '../../intelligence-engine/src/model-probability-orchestrator.mjs';
import { predictLive1X2 } from '../../intelligence-engine/src/live-outcome.mjs';

export const PREDICTION_PERSISTENCE_VERSION='POSTGRES_PREDICTION_PERSISTENCE_V0_2';
export const PREDICTION_PERSISTENCE_MODE='POSTGRES';

function stable(value){if(value===null||typeof value!=='object')return value;if(Array.isArray(value))return value.map(stable);return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));}
export function sha256Json(value){return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');}
export function sha256ReferencePayload(value){return createHash('sha256').update(typeof value==='string'?value:JSON.stringify(stable(value))).digest('hex');}
function persistenceError(message,statusCode=503,cause){const error=new Error(message,{cause});error.statusCode=statusCode;return error;}
function exactHash(value){return typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);}

function freezeDeterministic(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;for(const child of Object.values(value))freezeDeterministic(child);return Object.freeze(value);}
export function deterministicPredictionOutput(endpoint,input){
  if(endpoint==='/v1/predict'){
    const result=orchestrateModelProbabilities(input);
    return {apiVersion:'PREDICTION_HTTP_API_V0_1',state:result.status,eventId:result.eventId,market:result.market,selection:result.selection,probability:result.probability??null,breakEvenProbability:result.breakEvenProbability??null,ev:result.ev??null,evidenceMaturity:result.evidenceMaturity??null,criticalBlocks:result.criticalBlocks??[],modelFamilyCount:result.familyCount??0,inputModelCount:result.inputModelCount??0,audit:{orchestratorVersion:result.version,kickoffAt:result.kickoffAt??null,families:result.families??[],modelSnapshots:result.modelSnapshots??[],governance:result.governance??null},capitalState:'LOCKED',realMoney:'NO'};
  }
  if(!input||typeof input!=='object'||Array.isArray(input)||!input.preMatchSnapshot||typeof input.preMatchSnapshot!=='object'||Array.isArray(input.preMatchSnapshot)||!input.live||typeof input.live!=='object'||Array.isArray(input.live)||input.live.eventId!==input.preMatchSnapshot.eventId||!Array.isArray(input.live.evidence)||input.live.evidence.length===0||!input.live.evidence.some(item=>item&&typeof item==='object'&&item.verified===true))throw new Error('LIVE_INPUT_NOT_CANONICAL');
  for(const value of [input.homeRateMultiplier,input.awayRateMultiplier,input.live.homeRateMultiplier,input.live.awayRateMultiplier])if(value!==undefined&&value!==1)throw new Error('LIVE_RATE_OVERRIDE_FORBIDDEN');
  const result=predictLive1X2({preMatchSnapshot:freezeDeterministic(input.preMatchSnapshot),minute:input.live.minute,homeScore:input.live.homeScore,awayScore:input.live.awayScore,observedAt:input.live.observedAt,regulationMinutes:input.live.regulationMinutes??90,homeRateMultiplier:1,awayRateMultiplier:1,maxAdditionalGoals:input.live.maxAdditionalGoals??8,evidence:input.live.evidence});
  return {apiVersion:'PREDICTION_LIVE_HTTP_API_V0_1',state:'LIVE',snapshotType:result.snapshotType,eventId:result.eventId,minute:result.minute,score:result.score,probabilities:result.probabilities,predictedOutcome:result.predictedOutcome,confidence:result.confidence,mostLikelyFinalScore:result.mostLikelyFinalScore,remainingFraction:result.remainingFraction,remainingLambdas:{home:result.remainingHomeLambda,away:result.remainingAwayLambda},audit:{parentSignalId:result.parentSignalId,modelVersion:result.modelVersion,featureVersion:result.featureVersion,observedAt:result.observedAt,rateMultipliers:result.rateMultipliers,evidence:result.evidence,preMatchSnapshotPreserved:result.preMatchSnapshotPreserved,governance:{preMatchSnapshotImmutable:true,arbitraryRateMultiplierOverrideAllowed:false,providerPredictionUsed:false,bookmakerOddsUsedAsLiveModelInput:false}},capitalState:'LOCKED',realMoney:'NO'};
}

function assertPersistenceInput({requestId,endpoint,input,output}){
  if(!requestId||typeof requestId!=='string')throw persistenceError('PERSISTENCE_REQUEST_ID_REQUIRED',400);
  if(!['/v1/predict','/v1/predict/live'].includes(endpoint))throw persistenceError('PERSISTENCE_ENDPOINT_INVALID',400);
  if(!input||typeof input!=='object'||Array.isArray(input))throw persistenceError('PERSISTENCE_INPUT_OBJECT_REQUIRED',400);
  if(!output||typeof output!=='object'||Array.isArray(output))throw persistenceError('PERSISTENCE_OUTPUT_OBJECT_REQUIRED',400);
  if(!output.eventId)throw persistenceError('PERSISTENCE_EVENT_ID_REQUIRED',400);
  if(endpoint==='/v1/predict'&&(!Array.isArray(input.models)||input.models.length!==1))throw persistenceError('PERSISTENCE_SINGLE_MODEL_LINEAGE_REQUIRED',409);
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
        const result=await pool.query("SELECT current_database() AS database_name,to_regclass('prediction_snapshots_v01')::text AS table_name,to_regclass('prediction_snapshot_frozen_signal_lineage_v01')::text AS lineage_table,to_regclass('reference_ingestion_observations_v01')::text AS observations_table,to_regclass('reference_feature_provenance_lineage_v01')::text AS features_table,to_regclass('reference_model_snapshots_v01')::text AS models_table,to_regclass('reference_model_feature_lineage_v01')::text AS model_features_table,to_regclass('reference_frozen_signal_snapshots_v01')::text AS signals_table,EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='reference_feature_provenance_lineage_v01' AND column_name='feature_payload') AS feature_payload_ready");
        const row=result.rows?.[0];
        if(row?.table_name!=='prediction_snapshots_v01'||row?.lineage_table!=='prediction_snapshot_frozen_signal_lineage_v01'||row?.observations_table!=='reference_ingestion_observations_v01'||row?.features_table!=='reference_feature_provenance_lineage_v01'||row?.models_table!=='reference_model_snapshots_v01'||row?.model_features_table!=='reference_model_feature_lineage_v01'||row?.signals_table!=='reference_frozen_signal_snapshots_v01'||row?.feature_payload_ready!==true)throw new Error('PREDICTION_LINEAGE_SCHEMA_NOT_READY');
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
      if(snapshotType==='LIVE'&&(typeof parentSignalId!=='string'||parentSignalId!==lineage.frozenSignalSnapshotId))throw persistenceError('PERSISTENCE_LIVE_PARENT_SIGNAL_LINEAGE_NOT_EXACT',409);
      let client=null;
      try{
        client=await pool.connect();
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
        if(client)await client.query('ROLLBACK').catch(()=>{});
        if(error?.statusCode)throw error;
        throw persistenceError('POSTGRES_PERSISTENCE_WRITE_FAILED',503,error);
      }finally{client?.release();}
    },
    async attestPredictionLineage({snapshotId}){
      if(typeof snapshotId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId))throw persistenceError('PREDICTION_SNAPSHOT_ID_INVALID',400);
      const dbIso=value=>new Date(value).toISOString();
      try{
        const result=await pool.query(`SELECT p.snapshot_id::text,p.endpoint,p.snapshot_type,p.event_id,p.market,p.selection,p.input_sha256,p.output_sha256,p.input_payload,p.prediction_payload,p.parent_signal_id,p.model_version AS prediction_model_version,p.capital_state AS prediction_capital,p.real_money AS prediction_money,l.frozen_signal_snapshot_id,l.frozen_signal_fingerprint,l.link_fingerprint,l.capital_state AS link_capital,l.real_money AS link_money,s.signal_kind,s.model_snapshot_id,s.model_fingerprint,s.signal_fingerprint,s.signal_payload_fingerprint,s.signal_payload,s.frozen_at AS signal_frozen_at,s.kickoff_at AS signal_kickoff_at,s.capital_state AS signal_capital,s.real_money AS signal_money,m.model_version,m.model_fingerprint AS stored_model_fingerprint,m.model_payload_fingerprint,m.model_payload,m.frozen_at AS model_frozen_at,m.kickoff_at AS model_kickoff_at,m.capital_state AS model_capital,m.real_money AS model_money,mf.feature_sequence,mf.feature_lineage_id,mf.feature_fingerprint,mf.link_fingerprint AS model_feature_link_fingerprint,mf.capital_state AS model_feature_capital,mf.real_money AS model_feature_money,f.feature_id,f.feature_name,f.feature_version,f.feature_payload,f.created_at AS feature_created_at,f.source_provenance_id,f.source_evidence_fingerprint,f.lineage_fingerprint,f.capital_state AS feature_capital,f.real_money AS feature_money,o.observation_id,o.entity_type,o.entity_id,o.evidence_kind,o.provider,o.source,o.source_type,o.source_url,o.observed_at,o.available_at,o.captured_at AS source_captured_at,o.prediction_cutoff,o.source_payload_fingerprint,o.evidence_fingerprint,o.payload_json,o.pre_match_eligible,o.is_verified,o.capital_state AS source_capital,o.real_money AS source_money
          FROM prediction_snapshots_v01 p
          JOIN prediction_snapshot_frozen_signal_lineage_v01 l ON l.prediction_snapshot_id=p.snapshot_id AND l.event_id=p.event_id
          JOIN reference_frozen_signal_snapshots_v01 s ON s.signal_snapshot_id=l.frozen_signal_snapshot_id AND s.signal_fingerprint=l.frozen_signal_fingerprint AND s.event_id=l.event_id
          JOIN reference_model_snapshots_v01 m ON m.model_snapshot_id=s.model_snapshot_id AND m.model_fingerprint=s.model_fingerprint AND m.event_id=s.event_id
          JOIN reference_model_feature_lineage_v01 mf ON mf.model_snapshot_id=m.model_snapshot_id AND mf.event_id=m.event_id
          JOIN reference_feature_provenance_lineage_v01 f ON f.lineage_id=mf.feature_lineage_id AND f.feature_fingerprint=mf.feature_fingerprint AND f.event_id=mf.event_id
          JOIN reference_ingestion_observations_v01 o ON o.provenance_id=f.source_provenance_id AND o.evidence_fingerprint=f.source_evidence_fingerprint AND o.event_id=f.event_id
         WHERE p.snapshot_id=$1 ORDER BY mf.feature_sequence`,[snapshotId]);
        if(result.rowCount===0){
          const exists=await pool.query('SELECT 1 FROM prediction_snapshots_v01 WHERE snapshot_id=$1',[snapshotId]);
          throw persistenceError(exists.rowCount===1?'PREDICTION_LINEAGE_NOT_ATTESTABLE':'PREDICTION_SNAPSHOT_NOT_FOUND',exists.rowCount===1?409:404);
        }
        const first=result.rows[0];
        const features=result.rows.map((row,index)=>({featureSequence:row.feature_sequence,featureLineageId:row.feature_lineage_id,featureFingerprint:row.feature_fingerprint}));
        const completeFeatures=features.every((row,index)=>row.featureSequence===index)&&new Set(features.map(row=>row.featureLineageId+':'+row.featureFingerprint)).size===features.length;
        const exactRows=result.rows.every(row=>{
          const sourcePayloadFingerprint=sha256ReferencePayload(row.payload_json);
          const sourceCore={provenanceId:row.source_provenance_id,observationId:row.observation_id,eventId:row.event_id,entityType:row.entity_type,entityId:row.entity_id,evidenceKind:row.evidence_kind,provider:row.provider,source:row.source,sourceType:row.source_type,sourceUrl:row.source_url,observedAt:dbIso(row.observed_at),availableAt:dbIso(row.available_at),capturedAt:dbIso(row.source_captured_at),predictionCutoff:row.prediction_cutoff==null?null:dbIso(row.prediction_cutoff),isVerified:row.is_verified,preMatchEligible:row.pre_match_eligible,sourcePayloadFingerprint:row.source_payload_fingerprint};
          const featureCore={lineageId:row.feature_lineage_id,featureId:row.feature_id,eventId:row.event_id,featureName:row.feature_name,featureVersion:row.feature_version,featureFingerprint:row.feature_fingerprint,sourceProvenanceId:row.source_provenance_id,sourceEvidenceFingerprint:row.source_evidence_fingerprint,createdAt:dbIso(row.feature_created_at)};
          const modelFeatureCore={modelSnapshotId:row.model_snapshot_id,featureSequence:row.feature_sequence,eventId:row.event_id,featureLineageId:row.feature_lineage_id,featureFingerprint:row.feature_fingerprint};
          return row.feature_payload!==null&&sourcePayloadFingerprint===row.source_payload_fingerprint&&sha256Json(sourceCore)===row.evidence_fingerprint&&sha256ReferencePayload(row.feature_payload)===row.feature_fingerprint&&sha256Json(featureCore)===row.lineage_fingerprint&&sha256Json(modelFeatureCore)===row.model_feature_link_fingerprint;
        });
        const modelPayloadFingerprint=sha256ReferencePayload(first.model_payload);
        const modelCore={modelSnapshotId:first.model_snapshot_id,eventId:first.event_id,modelVersion:first.model_version,modelPayloadFingerprint,kickoffAt:dbIso(first.model_kickoff_at),frozenAt:dbIso(first.model_frozen_at),features};
        const signalPayloadFingerprint=sha256ReferencePayload(first.signal_payload);
        const signalCore={signalSnapshotId:first.frozen_signal_snapshot_id,eventId:first.event_id,signalKind:first.signal_kind,modelSnapshotId:first.model_snapshot_id,modelFingerprint:first.model_fingerprint,signalPayloadFingerprint,kickoffAt:dbIso(first.signal_kickoff_at),frozenAt:dbIso(first.signal_frozen_at)};
        const expectedLink=sha256Json({predictionSnapshotId:first.snapshot_id,eventId:first.event_id,frozenSignalSnapshotId:first.frozen_signal_snapshot_id,frozenSignalFingerprint:first.frozen_signal_fingerprint});
        const governed=result.rows.every(row=>[row.prediction_capital,row.link_capital,row.signal_capital,row.model_capital,row.model_feature_capital,row.feature_capital,row.source_capital].every(value=>value==='LOCKED')&&[row.prediction_money,row.link_money,row.signal_money,row.model_money,row.model_feature_money,row.feature_money,row.source_money].every(value=>value==='NO'));
        const prematch=result.rows.every(row=>row.pre_match_eligible===true&&row.is_verified===true&&row.prediction_cutoff!==null&&new Date(row.observed_at)<=new Date(row.available_at)&&new Date(row.available_at)<=new Date(row.source_captured_at)&&new Date(row.available_at)<=new Date(row.prediction_cutoff)&&new Date(row.source_captured_at)<=new Date(row.prediction_cutoff)&&new Date(row.source_captured_at)<=new Date(row.feature_created_at)&&new Date(row.source_captured_at)<=new Date(row.model_frozen_at)&&new Date(row.feature_created_at)<=new Date(row.model_frozen_at)&&!['SETTLEMENT','PREDICTION_SETTLEMENT'].includes(row.evidence_kind));
        const hashes=exactRows&&modelPayloadFingerprint===first.model_payload_fingerprint&&sha256Json(modelCore)===first.stored_model_fingerprint&&first.model_fingerprint===first.stored_model_fingerprint&&signalPayloadFingerprint===first.signal_payload_fingerprint&&sha256Json(signalCore)===first.signal_fingerprint&&first.signal_fingerprint===first.frozen_signal_fingerprint&&first.input_sha256===sha256Json(first.input_payload)&&first.output_sha256===sha256Json(first.prediction_payload)&&first.link_fingerprint===expectedLink;
        const temporal=dbIso(first.model_kickoff_at)===dbIso(first.signal_kickoff_at)&&new Date(first.model_frozen_at)<=new Date(first.signal_frozen_at)&&new Date(first.signal_frozen_at)<new Date(first.signal_kickoff_at)&&new Date(first.model_frozen_at)<new Date(first.model_kickoff_at);
        const endpointType=(first.endpoint==='/v1/predict'&&first.snapshot_type==='PREMATCH')||(first.endpoint==='/v1/predict/live'&&first.snapshot_type==='LIVE');
        const liveParent=first.snapshot_type!=='LIVE'||(first.parent_signal_id===first.frozen_signal_snapshot_id&&first.prediction_payload?.audit?.parentSignalId===first.frozen_signal_snapshot_id);
        const declaredLineage=first.input_payload?.persistenceLineage;
        const canonicalEvent=value=>typeof value==='string'?value:(typeof value==='number'&&Number.isFinite(value)?String(value):null);
        const sameEvent=value=>canonicalEvent(value)===first.event_id;
        const inputEventMatches=first.snapshot_type==='LIVE'
          ?sameEvent(first.input_payload?.live?.eventId)&&sameEvent(first.input_payload?.preMatchSnapshot?.eventId)
          :sameEvent(first.input_payload?.eventId??first.input_payload?.preMatchSnapshot?.eventId);
        const predictionSemantics=sameEvent(first.prediction_payload?.eventId)&&first.prediction_payload?.capitalState==='LOCKED'&&first.prediction_payload?.realMoney==='NO'&&inputEventMatches&&declaredLineage?.frozenSignalSnapshotId===first.frozen_signal_snapshot_id&&declaredLineage?.frozenSignalFingerprint===first.frozen_signal_fingerprint;
        const requestKickoff=first.snapshot_type!=='PREMATCH'||(Number.isFinite(Date.parse(first.input_payload?.kickoffAt))&&dbIso(first.input_payload.kickoffAt)===dbIso(first.model_kickoff_at));
        let deterministicOutput=false;
        try{const expectedOutput=deterministicPredictionOutput(first.endpoint,first.input_payload);deterministicOutput=sha256Json(expectedOutput)===first.output_sha256&&String(expectedOutput.market??'1X2')===first.market&&(expectedOutput.selection==null?null:String(expectedOutput.selection))===first.selection;}catch{}
        const consumedModels=first.input_payload?.models,reportedModels=first.prediction_payload?.audit?.modelSnapshots,consumedModel=consumedModels?.[0];
        const reportedModelsMatch=first.prediction_payload?.state==='WAIT'?Array.isArray(reportedModels)&&reportedModels.length===0:Array.isArray(reportedModels)&&reportedModels.length===1&&reportedModels[0]?.modelVersion===first.model_version&&reportedModels[0]?.snapshotId===first.model_snapshot_id&&reportedModels[0]?.snapshotSha256===first.model_fingerprint;
        const consumedModelPayload=consumedModel&&{modelVersion:consumedModel.modelVersion,eventId:consumedModel.eventId,market:consumedModel.market,selection:consumedModel.selection,probability:consumedModel.probability,usesMarketOdds:consumedModel.usesMarketOdds,frozenAt:consumedModel.frozenAt,source:consumedModel.source,snapshotId:consumedModel.snapshotId,correlationFamily:consumedModel.correlationFamily,baseWeight:consumedModel.baseWeight,validation:consumedModel.validation,calibration:consumedModel.calibration,freshness:consumedModel.freshness,drift:consumedModel.drift,availability:consumedModel.availability};
        const modelSemantics=first.snapshot_type==='PREMATCH'
          ?Array.isArray(consumedModels)&&consumedModels.length===1&&reportedModelsMatch&&consumedModels[0]?.modelVersion===first.model_version&&consumedModels[0]?.snapshotId===first.model_snapshot_id&&consumedModels[0]?.snapshotSha256===first.model_fingerprint&&sha256ReferencePayload(consumedModelPayload)===first.model_payload_fingerprint
          :first.input_payload?.preMatchSnapshot?.signalId===first.frozen_signal_snapshot_id&&first.input_payload?.preMatchSnapshot?.modelVersion===first.model_version&&first.prediction_model_version===first.model_version&&first.prediction_payload?.audit?.modelVersion===first.model_version&&sha256ReferencePayload(first.input_payload?.preMatchSnapshot)===first.signal_payload_fingerprint;
        if(!completeFeatures||!governed||!prematch||!hashes||!temporal||!endpointType||!liveParent||!predictionSemantics||!requestKickoff||!deterministicOutput||!modelSemantics||!['FROZEN_SIGNAL','FROZEN_PREDICTION'].includes(first.signal_kind))throw persistenceError('PREDICTION_LINEAGE_ATTESTATION_FAILED',409);
        return Object.freeze({status:'ATTESTED',snapshotId:first.snapshot_id,eventId:first.event_id,snapshotType:first.snapshot_type,frozenSignalSnapshotId:first.frozen_signal_snapshot_id,frozenSignalFingerprint:first.frozen_signal_fingerprint,modelSnapshotId:first.model_snapshot_id,modelFingerprint:first.model_fingerprint,features:Object.freeze(result.rows.map(row=>Object.freeze({sequence:row.feature_sequence,featureLineageId:row.feature_lineage_id,featureFingerprint:row.feature_fingerprint,sourceProvenanceId:row.source_provenance_id,sourceEvidenceFingerprint:row.source_evidence_fingerprint}))),allFingerprintsRecomputed:true,completeFeatureSet:true,exactEventBound:true,prematchEvidenceOnly:true,settlementSeparate:true,authorizesValidation:false,authorizesExecution:false,capitalState:'LOCKED',realMoney:'NO'});
      }catch(error){if(error?.statusCode)throw error;throw persistenceError('POSTGRES_LINEAGE_ATTESTATION_READ_FAILED',503,error);}
    },
    async getByRequest({requestId,endpoint}){
      try{
        const result=await pool.query("SELECT p.snapshot_id::text,p.request_id,p.endpoint,p.snapshot_type,p.event_id,p.market,p.selection,p.input_sha256,p.output_sha256,p.input_payload,p.prediction_payload,p.parent_signal_id,p.model_version,p.feature_version,p.source_observed_at,p.persisted_at,p.capital_state,p.real_money,l.frozen_signal_snapshot_id,l.frozen_signal_fingerprint,l.link_fingerprint FROM prediction_snapshots_v01 p LEFT JOIN prediction_snapshot_frozen_signal_lineage_v01 l ON l.prediction_snapshot_id=p.snapshot_id AND l.event_id=p.event_id WHERE p.request_id=$1 AND p.endpoint=$2",[requestId,endpoint]);
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
