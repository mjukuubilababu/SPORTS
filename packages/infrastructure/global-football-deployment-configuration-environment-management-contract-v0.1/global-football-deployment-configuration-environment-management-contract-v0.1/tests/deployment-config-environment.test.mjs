import test from"node:test";import assert from"node:assert/strict";
import{configDrift,validatePromotionPath,rolloutAction,secretReferenceViolations,validateMigrationBundle,productionMigrationAllowed,validateDRPlan,validateBuild,validateRelease}from"../dist/index.js";

const build={build_id:"b",source_commit:"abc",source_tree_hash:"t",dependency_lock_hash:"l",compiler_version:"ts",build_environment:"ci",built_at:"2026-08-21T00:00:00Z",artifact_hash:"h",reproducible:true,sbom_reference:null,immutable:true};
test("reproducible build valid",()=>assert.deepEqual(validateBuild(build),[]));

const release={release_id:"r",release_version:"1.0.0",build_id:"b",state:"STAGED",created_at:"2026-08-21T00:00:00Z",signed_at:"2026-08-21T00:01:00Z",signature:"sig",key_id:"k",target_environments:["PRODUCTION"],migration_bundle_id:null,config_schema_version:"1",immutable:true};
test("signed staged release valid",()=>assert.deepEqual(validateRelease(release),[]));

test("direct dev to prod rejected",()=>{const p={deployment_id:"d",release_id:"r",from_environment:"DEV",to_environment:"PRODUCTION",strategy:"CANARY",created_at:"x",requested_by_identity_id:"u",canary_pct:10,success_slo_ids:[],abort_on_critical_alert:true,rollback_release_id:"old"};assert.ok(validatePromotionPath(p,release).includes("NON_SEQUENTIAL_ENVIRONMENT_PROMOTION"))});

test("config drift detected",()=>{const a={config_snapshot_id:"a",environment:"PRODUCTION",schema_version:"1",created_at:"x",created_by_identity_id:"u",entries:[{key:"x",value:1,secret_ref:null,data_class:"INTERNAL",mutable_at_runtime:false}],content_hash:"h",immutable:true};const b={...a,config_snapshot_id:"b",entries:[{...a.entries[0],value:2}]};assert.equal(configDrift(a,b).drift,true)});

test("secret-like key requires reference",()=>{const s={config_snapshot_id:"a",environment:"PRODUCTION",schema_version:"1",created_at:"x",created_by_identity_id:"u",entries:[{key:"api_key",value:"plain",secret_ref:null,data_class:"RESTRICTED",mutable_at_runtime:false}],content_hash:"h",immutable:true};assert.equal(secretReferenceViolations(s)[0],"api_key")});

test("critical signal rolls back",()=>assert.equal(rolloutAction({critical_alert:true,slo_burn_rate:1,error_rate:0,latency_regression_pct:0,model_quality_regression:false,config_drift:false}),"ROLLBACK"));

test("destructive migration requires backup",()=>{const m={migration_bundle_id:"m",schema_from:"1",schema_to:"2",created_at:"x",immutable:true,steps:[{migration_id:"1",order:1,description:"drop",backward_compatible:false,destructive:true,requires_backup:false,verification_query:null}]};assert.equal(validateMigrationBundle(m).includes("DESTRUCTIVE_MIGRATION_WITHOUT_BACKUP"),true);assert.equal(productionMigrationAllowed(m,false),false)});

test("DR requires failover target when multi-region",()=>{const r=validateDRPlan({dr_plan_id:"d",environment:"PRODUCTION",rpo_minutes:5,rto_minutes:30,backup_required:true,multi_region_required:true,failover_target:null,last_dr_test_at:null,next_dr_test_due_at:"2026-12-01T00:00:00Z"});assert.equal(r.includes("FAILOVER_TARGET_REQUIRED"),true)});
