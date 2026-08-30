import test from 'node:test';
import assert from 'node:assert/strict';
import { createPredictionPersistenceFromPool, sha256Json, sha256ReferencePayload } from '../src/postgres-persistence.mjs';

const iso=value=>new Date(value).toISOString();
function attestationRow({payloadJson={value:1},featurePayload={rating:0.8},modelPayload={lambda:2.4},signalPayload={market:'1X2'},snapshotId='abcdefab-cdef-4abc-8def-abcdefabcdef'}={}){
  const eventId='ATTEST-E1',modelSnapshotId='MODEL-ATTEST',featureLineageId='FEATURE-LINEAGE-ATTEST';
  const sourcePayloadFingerprint=sha256ReferencePayload(payloadJson);
  const sourceCore={provenanceId:'PROV-ATTEST',observationId:'OBS-ATTEST',eventId,entityType:'MATCH',entityId:eventId,evidenceKind:'MODEL_INPUT',provider:null,source:'TEST',sourceType:'TEST',sourceUrl:null,observedAt:iso('2026-08-26T14:00:00Z'),availableAt:iso('2026-08-26T14:00:01Z'),capturedAt:iso('2026-08-26T14:00:02Z'),predictionCutoff:iso('2026-08-26T18:00:00Z'),isVerified:true,preMatchEligible:true,sourcePayloadFingerprint};
  const sourceEvidenceFingerprint=sha256Json(sourceCore);
  const featureFingerprint=sha256ReferencePayload(featurePayload);
  const featureCore={lineageId:featureLineageId,featureId:'FEATURE-ATTEST',eventId,featureName:'rating',featureVersion:'V1',featureFingerprint,sourceProvenanceId:'PROV-ATTEST',sourceEvidenceFingerprint,createdAt:iso('2026-08-26T14:05:00Z')};
  const modelFeatureCore={modelSnapshotId,featureSequence:0,eventId,featureLineageId,featureFingerprint};
  const features=[{featureSequence:0,featureLineageId,featureFingerprint}];
  const modelPayloadFingerprint=sha256ReferencePayload(modelPayload);
  const modelCore={modelSnapshotId,eventId,modelVersion:'MODEL_V1',modelPayloadFingerprint,kickoffAt:iso('2026-08-26T19:00:00Z'),frozenAt:iso('2026-08-26T15:00:00Z'),features};
  const modelFingerprint=sha256Json(modelCore);
  const signalPayloadFingerprint=sha256ReferencePayload(signalPayload);
  const signalCore={signalSnapshotId:'SIGNAL-ATTEST',eventId,signalKind:'FROZEN_PREDICTION',modelSnapshotId,modelFingerprint,signalPayloadFingerprint,kickoffAt:iso('2026-08-26T19:00:00Z'),frozenAt:iso('2026-08-26T15:05:00Z')};
  const signalFingerprint=sha256Json(signalCore);
  const inputPayload={eventId,persistenceLineage:{frozenSignalSnapshotId:'SIGNAL-ATTEST',frozenSignalFingerprint:signalFingerprint}},predictionPayload={eventId,capitalState:'LOCKED',realMoney:'NO'};
  return {snapshot_id:snapshotId,snapshot_type:'PREMATCH',event_id:eventId,input_sha256:sha256Json(inputPayload),output_sha256:sha256Json(predictionPayload),input_payload:inputPayload,prediction_payload:predictionPayload,parent_signal_id:null,prediction_capital:'LOCKED',prediction_money:'NO',frozen_signal_snapshot_id:'SIGNAL-ATTEST',frozen_signal_fingerprint:signalFingerprint,link_fingerprint:sha256Json({predictionSnapshotId:snapshotId,eventId,frozenSignalSnapshotId:'SIGNAL-ATTEST',frozenSignalFingerprint:signalFingerprint}),link_capital:'LOCKED',link_money:'NO',signal_kind:'FROZEN_PREDICTION',model_snapshot_id:modelSnapshotId,model_fingerprint:modelFingerprint,signal_fingerprint:signalFingerprint,signal_payload_fingerprint:signalPayloadFingerprint,signal_payload:signalPayload,signal_frozen_at:signalCore.frozenAt,signal_kickoff_at:signalCore.kickoffAt,signal_capital:'LOCKED',signal_money:'NO',model_version:'MODEL_V1',stored_model_fingerprint:modelFingerprint,model_payload_fingerprint:modelPayloadFingerprint,model_payload:modelPayload,model_frozen_at:modelCore.frozenAt,model_kickoff_at:modelCore.kickoffAt,model_capital:'LOCKED',model_money:'NO',feature_sequence:0,feature_lineage_id:featureLineageId,feature_fingerprint:featureFingerprint,model_feature_link_fingerprint:sha256Json(modelFeatureCore),model_feature_capital:'LOCKED',model_feature_money:'NO',feature_id:'FEATURE-ATTEST',feature_name:'rating',feature_version:'V1',feature_payload:featurePayload,feature_created_at:featureCore.createdAt,source_provenance_id:'PROV-ATTEST',source_evidence_fingerprint:sourceEvidenceFingerprint,lineage_fingerprint:sha256Json(featureCore),feature_capital:'LOCKED',feature_money:'NO',observation_id:'OBS-ATTEST',entity_type:'MATCH',entity_id:eventId,evidence_kind:'MODEL_INPUT',provider:null,source:'TEST',source_type:'TEST',source_url:null,observed_at:sourceCore.observedAt,available_at:sourceCore.availableAt,source_captured_at:sourceCore.capturedAt,prediction_cutoff:sourceCore.predictionCutoff,source_payload_fingerprint:sourcePayloadFingerprint,evidence_fingerprint:sourceEvidenceFingerprint,payload_json:payloadJson,pre_match_eligible:true,is_verified:true,source_capital:'LOCKED',source_money:'NO'};
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
  const row=attestationRow({payloadJson:'source',featurePayload:'rating',modelPayload:'model',signalPayload:'signal'});
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
  const base=attestationRow();
  const liveInput={live:{eventId:base.event_id},preMatchSnapshot:{eventId:base.event_id},persistenceLineage:base.input_payload.persistenceLineage};
  const live={...base,snapshot_type:'LIVE',parent_signal_id:base.frozen_signal_snapshot_id,input_payload:liveInput,input_sha256:sha256Json(liveInput)};
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
