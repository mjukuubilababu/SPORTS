CREATE TABLE IF NOT EXISTS test_cases_v01(
 test_id text PRIMARY KEY,layer text NOT NULL,name text NOT NULL,owner text NOT NULL,critical boolean NOT NULL,
 requirement_refs jsonb NOT NULL,invariant_refs jsonb NOT NULL,deterministic boolean NOT NULL);

CREATE TABLE IF NOT EXISTS test_results_v01(
 run_id text NOT NULL,test_id text NOT NULL,layer text NOT NULL,started_at timestamptz NOT NULL,completed_at timestamptz NOT NULL,
 status text NOT NULL,duration_ms numeric NOT NULL,failure_code text,artifact_refs jsonb NOT NULL,environment text NOT NULL,
 source_commit text NOT NULL,immutable boolean NOT NULL DEFAULT true CHECK(immutable=true),PRIMARY KEY(run_id,test_id));

CREATE TABLE IF NOT EXISTS coverage_snapshots_v01(
 snapshot_id text PRIMARY KEY,observed_at timestamptz NOT NULL,requirement_total integer NOT NULL,requirement_covered integer NOT NULL,
 critical_invariant_total integer NOT NULL,critical_invariant_covered integer NOT NULL,contract_total integer NOT NULL,contract_verified integer NOT NULL);

CREATE TABLE IF NOT EXISTS assurance_gate_results_v01(
 release_id text NOT NULL,evaluated_at timestamptz NOT NULL,decision text NOT NULL,reason_codes jsonb NOT NULL,
 immutable boolean NOT NULL DEFAULT true CHECK(immutable=true),PRIMARY KEY(release_id,evaluated_at));

CREATE TABLE IF NOT EXISTS chaos_experiments_v01(
 experiment_id text PRIMARY KEY,fault_type text NOT NULL,target text NOT NULL,started_at timestamptz NOT NULL,completed_at timestamptz,
 expected_safe_behavior text NOT NULL,observed_behavior text,passed boolean,blast_radius text NOT NULL);

CREATE TABLE IF NOT EXISTS defects_v01(
 defect_id text PRIMARY KEY,detected_at timestamptz NOT NULL,severity text NOT NULL,source_test_id text,
 component text NOT NULL,description text NOT NULL,status text NOT NULL,root_cause text,regression_test_id text);

CREATE OR REPLACE FUNCTION reject_assurance_truth_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'assurance evidence is immutable'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS assurance_results_no_mutation ON assurance_gate_results_v01;
CREATE TRIGGER assurance_results_no_mutation BEFORE UPDATE OR DELETE ON assurance_gate_results_v01
FOR EACH ROW EXECUTE FUNCTION reject_assurance_truth_mutation();
