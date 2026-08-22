import test from"node:test";import assert from"node:assert/strict";
import{evaluateAccess,fnv1a32,verifyContentHash,assessProviderTrust,aggregatePoisoning,validateArtifact}from"../dist/index.js";

const identity={identity_id:"u1",identity_type:"HUMAN",display_name:"Admin",active:true,environment_scope:["PRODUCTION"],roles:["MODEL_REVIEWER"],created_at:"2026-01-01T00:00:00Z",expires_at:null};
const permission={permission_id:"p1",role:"MODEL_REVIEWER",resource_pattern:"model:*",actions:["READ","PROMOTE"],environments:["PRODUCTION"],data_classes:["INTERNAL"]};

test("deny by default without permission",()=>{const r=evaluateAccess({request_id:"r",identity,action:"WRITE",resource:"model:x",environment:"PRODUCTION",data_class:"INTERNAL",requested_at:"2026-08-21T00:00:00Z",reason:"test",break_glass:false},[permission]);assert.equal(r.allowed,false)});
test("promotion allowed but needs secondary approval",()=>{const r=evaluateAccess({request_id:"r",identity,action:"PROMOTE",resource:"model:x",environment:"PRODUCTION",data_class:"INTERNAL",requested_at:"2026-08-21T00:00:00Z",reason:"validated challenger",break_glass:false},[permission]);assert.equal(r.allowed,true);assert.equal(r.requires_secondary_approval,true)});
test("stable hash verifies content",()=>{const x={a:1,b:2},h=fnv1a32(x);assert.equal(verifyContentHash(x,h),true)});
test("bad provider is blocked",()=>assert.equal(assessProviderTrust({provider_id:"p",trust_level:"TRUSTED",last_reviewed_at:"x",anomaly_score:.9,schema_violation_rate:.01,timestamp_anomaly_rate:.01,conflict_rate:.01,signature_verified:null}),"BLOCKED"));
test("critical tamper invalidates artifact",()=>assert.equal(aggregatePoisoning([{signal_id:"s",detected_at:"x",source_id:"src",scope:"MODEL",anomaly_type:"ARTIFACT_TAMPER",severity:"CRITICAL",score:1,action:"INVALIDATE_ARTIFACT"}]),"INVALIDATE_ARTIFACT"));
test("artifact requires signature",()=>{const issues=validateArtifact({artifact_id:"a",artifact_type:"MODEL",artifact_version:"1",created_at:"x",created_by_identity_id:"u",content_hash:"h",signature:"",signature_algorithm:"ED25519",key_id:"k",immutable:true});assert.equal(issues.some(x=>x.code==="SIGNATURE_REQUIRED"),true)});
