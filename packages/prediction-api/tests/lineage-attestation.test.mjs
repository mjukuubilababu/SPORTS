import test from 'node:test';
import assert from 'node:assert/strict';
import { createPredictionPersistenceFromPool, deterministicPredictionOutput, sha256Json, sha256ReferencePayload } from '../src/postgres-persistence.mjs';

const iso=value=>new Date(value).toISOString();
const liveSnapshot=(eventId='ATTEST-E1')=>({snapshotType:'PRE_MATCH',immutable:true,signalId:'SIGNAL-ATTEST',eventId,modelVersion:'MODEL_V1',featureVersion:'V1',homeLambda:1.6,awayLambda:1.0,createdAt:'2026-08-26T14:30:00.000Z',frozenAt:'2026-08-26T15:04:00.000Z',realMoney:'NO'});
const liveInputFor=(row,preMatchSnapshot)=>({persistenceLineage:row.input_payload.persistenceLineage,preMatchSnapshot,live:{eventId:row.event_id,minute:61,homeScore:1,awayScore:0,observedAt:'2026-08-26T19:21:00.000Z',evidence:[{type:'LIVE_SCORE_TIME_PROVIDER_SNAPSHOT',verified:true}]}});
function attestationRow({payloadJson={value:1},featurePayload={rating:0.8},modelPayload=null,signalPayload={market:'1X2'},snapshotId='abcdefab-cdef-4abc-8def-abcdefabcdef',eventId='ATTEST-E1'}={}){
  const modelSnapshotId='MODEL-ATTEST',featureLineageId='FEATURE-LINEAGE-ATTEST';
  const sourcePayloadFingerprint=sha256ReferencePayload(payloadJson);
  const sourceCore={provenanceId:'PROV-ATTEST',observationId:'OBS-ATTEST',eventId,entityType:'MATCH',entityId:eventId,evidenceKind:'MODEL_INPUT',provider:null,source:'TEST',sourceType:'TEST',sourceUrl:null,observedAt:iso('2026-08-26T14:00:00Z'),availableAt:iso('2026-08-26T14:00:01Z'),capturedAt:iso('2026-08-26T14:00:02Z'),predictionCutoff:iso('2026-08-26T18:00:00Z'),isVerified:true,preMatchEligible:true,sourcePayloadFingerprint};
  const sourceEvidenceFingerprint=sha256Json(sourceCore);
  const featureFingerprint=sha256ReferencePayload(featurePayload);
  const featureCore={lineageId:featureLineageId,featureId:'FEATURE-ATTEST',eventId,featureName:'rating',featureVersion:'V1',featureFingerprint,sourceProvenanceId:'PROV-ATTEST',sourceEvidenceFingerprint,createdAt:iso('2026-08-26T14:05:00Z')};
  const modelFeatureCore={modelSnapshotId,featureSequence:0,eventId,featureLineageId,featureFingerprint};
  const features=[{featureSequence:0,featureLineageId,featureFingerprint}];
  const canonicalModelPayload=modelPayload??{modelVersion:'MODEL_V1',eventId,market:'1X2',selection:'HOME',probability:0.6,usesMarketOdds:false,frozenAt:'2026-08-26T15:00:00Z',source:'MODEL_SNAPSHOT',snapshotId:modelSnapshotId,correlationFamily:'MODEL_FAMILY',baseWeight:1,validation:1,calibration:1,freshness:1,drift:1,availability:1};
  const modelPayloadFingerprint=sha256ReferencePayload(canonicalModelPayload);
  const modelCore={modelSnapshotId,eventId,modelVersion:'MODEL_V1',modelPayloadFingerprint,kickoffAt:iso('2026-08-26T19:00:00Z'),frozenAt:iso('2026-08-26T15:00:00Z'),features};
  const modelFingerprint=sha256Json(modelCore);
  const signalPayloadFingerprint=sha256ReferencePayload(signalPayload);
  const signalCore={signalSnapshotId:'SIGNAL-ATTEST',eventId,signalKind:'FROZEN_PREDICTION',modelSnapshotId,modelFingerprint,signalPayloadFingerprint,kickoffAt:iso('2026-08-26T19:00:00Z'),frozenAt:iso('2026-08-26T15:05:00Z')};
  const signalFingerprint=sha256Json(signalCore);
  const consumedModel={...canonicalModelPayload,snapshotSha256:modelFingerprint};
  const inputPayload={eventId,market:'1X2',selection:'HOME',kickoffAt:'2026-08-26T19:00:00.000Z',models:[consumedModel],offeredOdds:2,confidence:{score:0.9,criticalBlocks:[]},persistenceLineage:{frozenSignalSnapshotId:'SIGNAL-ATTEST',frozenSignalFingerprint:signalFingerprint}};
  const predictionPayload=deterministicPredictionOutput('/v1/predict',inputPayload);
  return {snapshot_id:snapshotId,endpoint:'/v1/predict',snapshot_type:'PREMATCH',event_id:eventId,market:'1X2',selection:'HOME',input_sha256:sha256Json(inputPayload),output_sha256:sha256Json(predictionPayload),input_payload:inputPayload,prediction_payload:predictionPayload,parent_signal_id:null,prediction_model_version:null,prediction_capital:'LOCKED',prediction_money:'NO',frozen_signal_snapshot_id:'SIGNAL-ATTEST',frozen_signal_fingerprint:signalFingerprint,link_fingerprint:sha256Json({predictionSnapshotId:snapshotId,eventId,frozenSignalSnapshotId:'SIGNAL-ATTEST',frozenSignalFingerprint:signalFingerprint}),link_capital:'LOCKED',link_money:'NO',signal_kind:'FROZEN_PREDICTION',model_snapshot_id:modelSnapshotId,model_fingerprint:modelFingerprint,signal_fingerprint:signalFingerprint,signal_payload_fingerprint:signalPayloadFingerprint,signal_payload:signalPayload,signal_frozen_at:signalCore.frozenAt,signal_kickoff_at:signalCore.kickoffAt,signal_capital:'LOCKED',signal_money:'NO',model_version:'MODEL_V1',stored_model_fingerprint:modelFingerprint,model_payload_fingerprint:modelPayloadFingerprint,model_payload:canonicalModelPayload,model_frozen_at:modelCore.frozenAt,model_kickoff_at:modelCore.kickoffAt,model_capital:'LOCKED',model_money:'NO',feature_sequence:0,feature_lineage_id:featureLineageId,feature_fingerprint:featureFingerprint,model_feature_link_fingerprint:sha256Json(modelFeatureCore),model_feature_capital:'LOCKED',model_feature_money:'NO',feature_id:'FEATURE-ATTEST',feature_name:'rating',feature_version:'V1',feature_payload:featurePayload,feature_created_at:featureCore.createdAt,source_provenance_id:'PROV-ATTEST',source_evidence_fingerprint:sourceEvidenceFingerprint,lineage_fingerprint:sha256Json(featureCore),feature_capital:'LOCKED',feature_money:'NO',observation_id:'OBS-ATTEST',entity_type:'MATCH',entity_id:eventId,evidence_kind:'MODEL_INPUT',provider:null,source:'TEST',source_type:'TEST',source_url:null,observed_at:sourceCore.observedAt,available_at:sourceCore.availableAt,source_captured_at:sourceCore.capturedAt,prediction_cutoff:sourceCore.predictionCutoff,source_payload_fingerprint:sourcePayloadFingerprint,evidence_fingerprint:sourceEvidenceFingerprint,payload_json:payloadJson,pre_match_eligible:true,is_verified:true,source_capital:'LOCKED',source_money:'NO'};
}
function persistenceFor(row){return createPredictionPersistenceFromPool({async query(){return {rowCount:1,rows:[row]};},async connect(){throw new Error('not used');}});}

test('attestation recomputes every persisted fingerprint hop',async()=>{
  const row=attestationRow();
  const ok=await persistenceFor(row).attestPredictionLineage({snapshotId:row.snapshot_id});
  assert.equal(ok.status,'ATTESTED');
  assert.equal(ok.allFingerprintsRecomputed,true);
  assert.equal(ok.completeFeatureSet,true);
  for(const field of ['source_payload_fingerprint','evidence_fingerprint','feature_fingerprint','lineage_fingerprint','model_feature_link_fingerprint','model_payload_fingerprint','stored_model_fingerprint','signal_payload_fingerprint','signal_fingerprint','link_fingerprint','input_sha256','output_sha256']){
    const changed={...row,[field]:'f'.repeat(64)};
    await assert.rejects(persistenceFor(changed).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
  }
});

test('attestation rejects incomplete features and impossible model-to-signal time',async()=>{
  const row=attestationRow();
  await assert.rejects(persistenceFor({...row,feature_sequence:1}).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
  await assert.rejects(persistenceFor({...row,signal_frozen_at:'2026-08-26T14:59:00.000Z'}).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
  await assert.rejects(persistenceFor({...row,signal_kickoff_at:'2026-08-26T20:00:00.000Z'}).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
});


test('attestation uses canonical raw-string payload hash semantics',async()=>{
  const row=attestationRow({payloadJson:'source',featurePayload:'rating',signalPayload:'signal'});
  assert.notEqual(sha256ReferencePayload('rating'),sha256Json('rating'));
  const result=await persistenceFor(row).attestPredictionLineage({snapshotId:row.snapshot_id});
  assert.equal(result.status,'ATTESTED');
  assert.equal(result.allFingerprintsRecomputed,true);
});


test('attestation binds stored prediction event and declared lineage to joined chain',async()=>{
  const row=attestationRow();
  const wrongOutput={...row.prediction_payload,eventId:'EVENT-B'};
  await assert.rejects(persistenceFor({...row,prediction_payload:wrongOutput,output_sha256:sha256Json(wrongOutput)}).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
  const wrongInput={...row.input_payload,eventId:'EVENT-B'};
  await assert.rejects(persistenceFor({...row,input_payload:wrongInput,input_sha256:sha256Json(wrongInput)}).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
  const wrongLineage={...row.input_payload,persistenceLineage:{...row.input_payload.persistenceLineage,frozenSignalSnapshotId:'OTHER-SIGNAL'}};
  await assert.rejects(persistenceFor({...row,input_payload:wrongLineage,input_sha256:sha256Json(wrongLineage)}).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
});


test('attestation canonicalizes an uppercase UUID before verifying and returning its lineage link',async()=>{
  const row=attestationRow();
  const result=await persistenceFor(row).attestPredictionLineage({snapshotId:row.snapshot_id.toUpperCase()});
  assert.equal(result.status,'ATTESTED');
  assert.equal(result.snapshotId,row.snapshot_id);
});


test('live attestation requires both live and prematch input event IDs to match the chain',async()=>{
  const preMatchSnapshot=liveSnapshot();
  const base=attestationRow({signalPayload:preMatchSnapshot});
  const liveInput=liveInputFor(base,preMatchSnapshot);
  const liveOutput=deterministicPredictionOutput('/v1/predict/live',liveInput);
  const live={...base,endpoint:'/v1/predict/live',snapshot_type:'LIVE',market:'1X2',selection:null,parent_signal_id:base.frozen_signal_snapshot_id,prediction_model_version:'MODEL_V1',input_payload:liveInput,input_sha256:sha256Json(liveInput),prediction_payload:liveOutput,output_sha256:sha256Json(liveOutput)};
  assert.equal((await persistenceFor(live).attestPredictionLineage({snapshotId:live.snapshot_id})).status,'ATTESTED');
  const crossEventInput={...liveInput,preMatchSnapshot:{eventId:'EVENT-B'}};
  await assert.rejects(persistenceFor({...live,input_payload:crossEventInput,input_sha256:sha256Json(crossEventInput)}).attestPredictionLineage({snapshotId:live.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
});

test('attestation accepts and returns a canonical UUIDv7 snapshot identity',async()=>{
  const row=attestationRow({snapshotId:'01890f3e-7b1c-7cc2-98c4-dc0c0c0c0c0c'});
  const result=await persistenceFor(row).attestPredictionLineage({snapshotId:row.snapshot_id.toUpperCase()});
  assert.equal(result.status,'ATTESTED');
  assert.equal(result.snapshotId,row.snapshot_id);
});


test('attestation rejects hashed payload governance that contradicts LOCKED and NO',async()=>{
  const row=attestationRow();
  for(const predictionPayload of [{...row.prediction_payload,capitalState:'UNLOCKED'},{...row.prediction_payload,realMoney:'YES'}]){
    await assert.rejects(persistenceFor({...row,prediction_payload:predictionPayload,output_sha256:sha256Json(predictionPayload)}).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
  }
});

test('attestation canonicalizes accepted numeric prediction event IDs',async()=>{
  const row=attestationRow({eventId:'42'});
  const inputPayload={...row.input_payload,eventId:42};
  const predictionPayload={...row.prediction_payload,eventId:42};
  const result=await persistenceFor({...row,input_payload:inputPayload,input_sha256:sha256Json(inputPayload),prediction_payload:predictionPayload,output_sha256:sha256Json(predictionPayload)}).attestPredictionLineage({snapshotId:row.snapshot_id});
  assert.equal(result.status,'ATTESTED');
  assert.equal(result.eventId,'42');
});


test('attestation binds endpoint to snapshot type and live output parent signal',async()=>{
  const preMatchSnapshot=liveSnapshot();
  const row=attestationRow({signalPayload:preMatchSnapshot});
  await assert.rejects(persistenceFor({...row,endpoint:'/v1/predict/live'}).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
  const liveInput=liveInputFor(row,preMatchSnapshot);
  const canonicalOutput=deterministicPredictionOutput('/v1/predict/live',liveInput);
  const wrongOutput={...canonicalOutput,audit:{...canonicalOutput.audit,parentSignalId:'OTHER-SIGNAL'}};
  const live={...row,endpoint:'/v1/predict/live',snapshot_type:'LIVE',market:'1X2',selection:null,parent_signal_id:row.frozen_signal_snapshot_id,prediction_model_version:'MODEL_V1',input_payload:liveInput,input_sha256:sha256Json(liveInput),prediction_payload:wrongOutput,output_sha256:sha256Json(wrongOutput)};
  await assert.rejects(persistenceFor(live).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
});

test('attestation rejects non-scalar event identities instead of coercing them',async()=>{
  const row=attestationRow({eventId:'[object Object]'});
  const inputPayload={...row.input_payload,eventId:{id:'A'}};
  const predictionPayload={...row.prediction_payload,eventId:{id:'B'}};
  await assert.rejects(persistenceFor({...row,input_payload:inputPayload,input_sha256:sha256Json(inputPayload),prediction_payload:predictionPayload,output_sha256:sha256Json(predictionPayload)}).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
});


test('prematch attestation binds the consumed and reported model to joined lineage',async()=>{
  const row=attestationRow();
  const wrong={modelVersion:'MODEL_V1',snapshotId:'OTHER-MODEL',snapshotSha256:'a'.repeat(64)};
  const inputPayload={...row.input_payload,models:[wrong]};
  await assert.rejects(persistenceFor({...row,input_payload:inputPayload,input_sha256:sha256Json(inputPayload)}).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
  const predictionPayload={...row.prediction_payload,audit:{...row.prediction_payload.audit,modelSnapshots:[wrong]}};
  await assert.rejects(persistenceFor({...row,prediction_payload:predictionPayload,output_sha256:sha256Json(predictionPayload)}).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
});


test('live attestation rejects altered consumed prematch snapshot payload',async()=>{
  const preMatchSnapshot=liveSnapshot();
  const row=attestationRow({signalPayload:preMatchSnapshot});
  const altered={...preMatchSnapshot,homeLambda:9.9};
  const inputPayload=liveInputFor(row,altered);
  const predictionPayload=deterministicPredictionOutput('/v1/predict/live',inputPayload);
  const live={...row,endpoint:'/v1/predict/live',snapshot_type:'LIVE',market:'1X2',selection:null,parent_signal_id:row.frozen_signal_snapshot_id,prediction_model_version:'MODEL_V1',input_payload:inputPayload,input_sha256:sha256Json(inputPayload),prediction_payload:predictionPayload,output_sha256:sha256Json(predictionPayload)};
  await assert.rejects(persistenceFor(live).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
});


test('attestation re-derives prematch eligibility from source timestamps',async()=>{
  const row=attestationRow();
  const capturedAfterCutoff={...row,source_captured_at:'2026-08-26T18:00:01.000Z'};
  const sourceCore={provenanceId:row.source_provenance_id,observationId:row.observation_id,eventId:row.event_id,entityType:row.entity_type,entityId:row.entity_id,evidenceKind:row.evidence_kind,provider:row.provider,source:row.source,sourceType:row.source_type,sourceUrl:row.source_url,observedAt:iso(row.observed_at),availableAt:iso(row.available_at),capturedAt:iso(capturedAfterCutoff.source_captured_at),predictionCutoff:iso(row.prediction_cutoff),isVerified:true,preMatchEligible:true,sourcePayloadFingerprint:row.source_payload_fingerprint};
  await assert.rejects(persistenceFor({...capturedAfterCutoff,evidence_fingerprint:sha256Json(sourceCore)}).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
});

test('live attestation binds stored and reported model version to lineage',async()=>{
  const preMatchSnapshot=liveSnapshot();
  const row=attestationRow({signalPayload:preMatchSnapshot});
  const inputPayload=liveInputFor(row,preMatchSnapshot);
  const canonicalOutput=deterministicPredictionOutput('/v1/predict/live',inputPayload);
  const predictionPayload={...canonicalOutput,audit:{...canonicalOutput.audit,modelVersion:'OTHER_MODEL'}};
  const live={...row,endpoint:'/v1/predict/live',snapshot_type:'LIVE',market:'1X2',selection:null,parent_signal_id:row.frozen_signal_snapshot_id,prediction_model_version:'OTHER_MODEL',input_payload:inputPayload,input_sha256:sha256Json(inputPayload),prediction_payload:predictionPayload,output_sha256:sha256Json(predictionPayload)};
  await assert.rejects(persistenceFor(live).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
});


test('prematch attestation binds probability and reliability values to immutable model payload',async()=>{
  const row=attestationRow();
  const inputPayload={...row.input_payload,models:[{...row.input_payload.models[0],probability:0.99}]};
  await assert.rejects(persistenceFor({...row,input_payload:inputPayload,input_sha256:sha256Json(inputPayload)}).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
});


test('attestation rejects a correctly hashed output not deterministically produced by its input',async()=>{
  const row=attestationRow();
  const predictionPayload={...row.prediction_payload,probability:0.99};
  await assert.rejects(persistenceFor({...row,prediction_payload:predictionPayload,output_sha256:sha256Json(predictionPayload)}).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
});


test('live attestation rejects persisted inputs forbidden by canonical live validation',async()=>{
  const preMatchSnapshot=liveSnapshot();
  const row=attestationRow({signalPayload:preMatchSnapshot});
  const validInput=liveInputFor(row,preMatchSnapshot);
  const predictionPayload=deterministicPredictionOutput('/v1/predict/live',validInput);
  const invalidInput={...validInput,live:{...validInput.live,homeRateMultiplier:2}};
  const live={...row,endpoint:'/v1/predict/live',snapshot_type:'LIVE',market:'1X2',selection:null,parent_signal_id:row.frozen_signal_snapshot_id,prediction_model_version:'MODEL_V1',input_payload:invalidInput,input_sha256:sha256Json(invalidInput),prediction_payload:predictionPayload,output_sha256:sha256Json(predictionPayload)};
  await assert.rejects(persistenceFor(live).attestPredictionLineage({snapshotId:row.snapshot_id}),error=>error?.message==='PREDICTION_LINEAGE_ATTESTATION_FAILED');
});

test('deterministic single-model WAIT snapshots remain attestable',async()=>{
  const base=attestationRow();
  const row=attestationRow({modelPayload:{...base.model_payload,baseWeight:0}});
  assert.equal(row.prediction_payload.state,'WAIT');
  assert.deepEqual(row.prediction_payload.audit.modelSnapshots,[]);
  assert.equal((await persistenceFor(row).attestPredictionLineage({snapshotId:row.snapshot_id})).status,'ATTESTED');
});
