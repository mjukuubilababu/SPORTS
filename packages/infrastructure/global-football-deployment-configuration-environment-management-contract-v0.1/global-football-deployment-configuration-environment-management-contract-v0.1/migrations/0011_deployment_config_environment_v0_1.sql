CREATE TABLE IF NOT EXISTS build_artifacts_v01(
 build_id text PRIMARY KEY,source_commit text NOT NULL,source_tree_hash text NOT NULL,dependency_lock_hash text NOT NULL,
 compiler_version text NOT NULL,build_environment text NOT NULL,built_at timestamptz NOT NULL,artifact_hash text NOT NULL,
 reproducible boolean NOT NULL,sbom_reference text,immutable boolean NOT NULL DEFAULT true CHECK(immutable=true));

CREATE TABLE IF NOT EXISTS release_artifacts_v01(
 release_id text PRIMARY KEY,release_version text NOT NULL,build_id text NOT NULL,state text NOT NULL,created_at timestamptz NOT NULL,
 signed_at timestamptz,signature text,key_id text,target_environments jsonb NOT NULL,migration_bundle_id text,
 config_schema_version text NOT NULL,immutable boolean NOT NULL DEFAULT true CHECK(immutable=true));

CREATE TABLE IF NOT EXISTS config_snapshots_v01(
 config_snapshot_id text PRIMARY KEY,environment text NOT NULL,schema_version text NOT NULL,created_at timestamptz NOT NULL,
 created_by_identity_id text NOT NULL,entries jsonb NOT NULL,content_hash text NOT NULL,
 immutable boolean NOT NULL DEFAULT true CHECK(immutable=true));

CREATE TABLE IF NOT EXISTS feature_flags_v01(
 flag_id text PRIMARY KEY,name text NOT NULL,environment text NOT NULL,enabled boolean NOT NULL,rollout_pct numeric NOT NULL,
 allowed_scopes jsonb NOT NULL,created_at timestamptz NOT NULL,expires_at timestamptz,owner text NOT NULL);

CREATE TABLE IF NOT EXISTS deployment_results_v01(
 deployment_id text PRIMARY KEY,started_at timestamptz NOT NULL,completed_at timestamptz,status text NOT NULL,
 promoted_release_id text,rollback_release_id text,reason_codes jsonb NOT NULL,
 immutable boolean NOT NULL DEFAULT true CHECK(immutable=true));

CREATE TABLE IF NOT EXISTS migration_bundles_v01(
 migration_bundle_id text PRIMARY KEY,schema_from text NOT NULL,schema_to text NOT NULL,steps jsonb NOT NULL,
 created_at timestamptz NOT NULL,immutable boolean NOT NULL DEFAULT true CHECK(immutable=true));

CREATE TABLE IF NOT EXISTS backup_records_v01(
 backup_id text PRIMARY KEY,environment text NOT NULL,created_at timestamptz NOT NULL,data_scope text NOT NULL,
 storage_reference text NOT NULL,checksum text NOT NULL,restore_tested boolean NOT NULL,restore_tested_at timestamptz,
 retention_until timestamptz NOT NULL);

CREATE TABLE IF NOT EXISTS disaster_recovery_plans_v01(
 dr_plan_id text PRIMARY KEY,environment text NOT NULL,rpo_minutes integer NOT NULL,rto_minutes integer NOT NULL,
 backup_required boolean NOT NULL,multi_region_required boolean NOT NULL,failover_target text,last_dr_test_at timestamptz,
 next_dr_test_due_at timestamptz NOT NULL);

CREATE OR REPLACE FUNCTION reject_release_truth_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'build/release/deployment truth artifacts are immutable'; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS build_artifacts_no_mutation ON build_artifacts_v01;
CREATE TRIGGER build_artifacts_no_mutation BEFORE UPDATE OR DELETE ON build_artifacts_v01
FOR EACH ROW EXECUTE FUNCTION reject_release_truth_mutation();

DROP TRIGGER IF EXISTS deployment_results_no_mutation ON deployment_results_v01;
CREATE TRIGGER deployment_results_no_mutation BEFORE UPDATE OR DELETE ON deployment_results_v01
FOR EACH ROW EXECUTE FUNCTION reject_release_truth_mutation();
