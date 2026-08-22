CREATE TABLE IF NOT EXISTS identities_v01(
 identity_id text PRIMARY KEY,identity_type text NOT NULL,display_name text NOT NULL,active boolean NOT NULL,
 environment_scope jsonb NOT NULL,roles jsonb NOT NULL,created_at timestamptz NOT NULL,expires_at timestamptz);

CREATE TABLE IF NOT EXISTS permissions_v01(
 permission_id text PRIMARY KEY,role text NOT NULL,resource_pattern text NOT NULL,actions jsonb NOT NULL,
 environments jsonb NOT NULL,data_classes jsonb NOT NULL);

CREATE TABLE IF NOT EXISTS approval_records_v01(
 approval_id uuid PRIMARY KEY,request_id text NOT NULL,approver_identity_id text NOT NULL,approved_at timestamptz NOT NULL,
 decision text NOT NULL,reason text NOT NULL,immutable boolean NOT NULL DEFAULT true CHECK(immutable=true));

CREATE TABLE IF NOT EXISTS signed_artifacts_v01(
 artifact_id text NOT NULL,artifact_type text NOT NULL,artifact_version text NOT NULL,created_at timestamptz NOT NULL,
 created_by_identity_id text NOT NULL,content_hash text NOT NULL,signature text NOT NULL,signature_algorithm text NOT NULL,
 key_id text NOT NULL,immutable boolean NOT NULL DEFAULT true CHECK(immutable=true),
 PRIMARY KEY(artifact_id,artifact_version));

CREATE TABLE IF NOT EXISTS provider_trust_v01(
 provider_id text PRIMARY KEY,trust_level text NOT NULL,last_reviewed_at timestamptz NOT NULL,anomaly_score numeric NOT NULL,
 schema_violation_rate numeric NOT NULL,timestamp_anomaly_rate numeric NOT NULL,conflict_rate numeric NOT NULL,
 signature_verified boolean);

CREATE TABLE IF NOT EXISTS data_governance_v01(
 dataset_id text PRIMARY KEY,data_class text NOT NULL,owner_identity_id text NOT NULL,purpose text NOT NULL,
 allowed_uses jsonb NOT NULL,prohibited_uses jsonb NOT NULL,retention_days integer,residency_scope jsonb NOT NULL,
 license_reference text,created_at timestamptz NOT NULL,review_due_at timestamptz NOT NULL);

CREATE TABLE IF NOT EXISTS security_audit_events_v01(
 event_id uuid PRIMARY KEY,occurred_at timestamptz NOT NULL,identity_id text NOT NULL,action text NOT NULL,
 resource text NOT NULL,environment text NOT NULL,outcome text NOT NULL,reason_codes jsonb NOT NULL,
 correlation_id text,immutable boolean NOT NULL DEFAULT true CHECK(immutable=true));

CREATE TABLE IF NOT EXISTS poisoning_signals_v01(
 signal_id uuid PRIMARY KEY,detected_at timestamptz NOT NULL,source_id text NOT NULL,scope text NOT NULL,
 anomaly_type text NOT NULL,severity text NOT NULL,score numeric NOT NULL CHECK(score BETWEEN 0 AND 1),
 action text NOT NULL);

CREATE OR REPLACE FUNCTION reject_security_truth_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'security/governance truth artifacts are immutable'; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS security_audit_no_mutation ON security_audit_events_v01;
CREATE TRIGGER security_audit_no_mutation BEFORE UPDATE OR DELETE ON security_audit_events_v01
FOR EACH ROW EXECUTE FUNCTION reject_security_truth_mutation();
