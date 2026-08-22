CREATE TABLE IF NOT EXISTS system_events_v01(
 event_id uuid PRIMARY KEY,event_type text NOT NULL,schema_version text NOT NULL CHECK(schema_version='0.1'),
 occurred_at timestamptz NOT NULL,observed_at timestamptz NOT NULL,producer text NOT NULL,stage text NOT NULL,
 correlation_id text NOT NULL,causation_id text,idempotency_key text NOT NULL,entity_type text NOT NULL,entity_id text NOT NULL,
 payload jsonb NOT NULL,lineage_refs jsonb NOT NULL,attempt integer NOT NULL CHECK(attempt>=0),status text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(idempotency_key,stage));

CREATE TABLE IF NOT EXISTS stage_runs_v01(
 stage_run_id uuid PRIMARY KEY,event_id uuid NOT NULL REFERENCES system_events_v01(event_id),stage text NOT NULL,
 started_at timestamptz NOT NULL,completed_at timestamptz,status text NOT NULL,attempt integer NOT NULL,
 input_hash text NOT NULL,output_hash text,error_code text,error_message text,worker_id text NOT NULL,
 immutable boolean NOT NULL DEFAULT true CHECK(immutable=true),created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS dead_letter_events_v01(
 dead_letter_id uuid PRIMARY KEY,event_id uuid NOT NULL,stage text NOT NULL,failed_at timestamptz NOT NULL,
 attempts integer NOT NULL,last_error_code text,last_error_message text,payload jsonb NOT NULL,lineage_refs jsonb NOT NULL);

CREATE TABLE IF NOT EXISTS trace_spans_v01(
 span_id text PRIMARY KEY,trace_id text NOT NULL,parent_span_id text,stage text NOT NULL,name text NOT NULL,
 started_at timestamptz NOT NULL,ended_at timestamptz,status text NOT NULL,attributes jsonb NOT NULL);

CREATE TABLE IF NOT EXISTS alerts_v01(
 alert_id uuid PRIMARY KEY,created_at timestamptz NOT NULL,severity text NOT NULL,source text NOT NULL,stage text,
 code text NOT NULL,message text NOT NULL,trace_id text,correlation_id text,auto_action text NOT NULL,resolved_at timestamptz);

CREATE TABLE IF NOT EXISTS circuit_breakers_v01(
 circuit_id text PRIMARY KEY,stage text NOT NULL,state text NOT NULL,failure_rate numeric NOT NULL,
 consecutive_failures integer NOT NULL,opened_at timestamptz,last_transition_at timestamptz NOT NULL);

CREATE TABLE IF NOT EXISTS replay_requests_v01(
 replay_id uuid PRIMARY KEY,requested_at timestamptz NOT NULL,stage text NOT NULL,source_event_ids jsonb NOT NULL,
 mode text NOT NULL,reason text NOT NULL,preserve_original_artifacts boolean NOT NULL DEFAULT true CHECK(preserve_original_artifacts=true));

CREATE OR REPLACE FUNCTION reject_stage_run_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'stage runs are immutable'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS stage_runs_no_mutation ON stage_runs_v01;
CREATE TRIGGER stage_runs_no_mutation BEFORE UPDATE OR DELETE ON stage_runs_v01
FOR EACH ROW EXECUTE FUNCTION reject_stage_run_mutation();
