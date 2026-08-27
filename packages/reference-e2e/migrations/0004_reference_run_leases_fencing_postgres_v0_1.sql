CREATE TABLE IF NOT EXISTS reference_run_leases_v01(
  correlation_id text PRIMARY KEY,
  worker_id text NOT NULL,
  fencing_token bigint NOT NULL CHECK(fencing_token >= 1),
  event_sequence bigint NOT NULL CHECK(event_sequence >= 0),
  lease_acquired_at timestamptz NOT NULL,
  lease_heartbeat_at timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  lease_status text NOT NULL CHECK(lease_status IN ('ACTIVE','RELEASED')),
  last_event_hash text NOT NULL CHECK(last_event_hash ~ '^[0-9a-f]{64}$'),
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO')
);
CREATE INDEX IF NOT EXISTS reference_run_leases_status_expiry_idx ON reference_run_leases_v01(lease_status, lease_expires_at);
CREATE TABLE IF NOT EXISTS reference_run_lease_events_v01(
  lease_event_id text PRIMARY KEY,
  correlation_id text NOT NULL,
  event_sequence bigint NOT NULL CHECK(event_sequence >= 0),
  event_type text NOT NULL CHECK(event_type IN ('ACQUIRED','TAKEN_OVER_AFTER_EXPIRY','RENEWED','RELEASED_AFTER_SUCCESS')),
  worker_id text NOT NULL,
  fencing_token bigint NOT NULL CHECK(fencing_token >= 1),
  previous_event_hash text NOT NULL CHECK(previous_event_hash='GENESIS' OR previous_event_hash ~ '^[0-9a-f]{64}$'),
  event_hash text NOT NULL UNIQUE CHECK(event_hash ~ '^[0-9a-f]{64}$'),
  lease_acquired_at timestamptz NOT NULL,
  lease_heartbeat_at timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  lease_status text NOT NULL CHECK(lease_status IN ('ACTIVE','RELEASED')),
  occurred_at timestamptz NOT NULL,
  event_json jsonb NOT NULL,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  UNIQUE(correlation_id, event_sequence)
);
CREATE INDEX IF NOT EXISTS reference_run_lease_events_correlation_idx ON reference_run_lease_events_v01(correlation_id, event_sequence);
CREATE TABLE IF NOT EXISTS reference_checkpoint_fence_receipts_v01(
  correlation_id text NOT NULL,
  stage_sequence integer NOT NULL CHECK(stage_sequence >= 0),
  checkpoint_fingerprint text NOT NULL CHECK(checkpoint_fingerprint ~ '^[0-9a-f]{64}$'),
  worker_id text NOT NULL,
  fencing_token bigint NOT NULL CHECK(fencing_token >= 1),
  lease_event_sequence bigint NOT NULL CHECK(lease_event_sequence >= 0),
  lease_event_hash text NOT NULL CHECK(lease_event_hash ~ '^[0-9a-f]{64}$'),
  lease_expires_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  PRIMARY KEY(correlation_id, stage_sequence)
);
CREATE OR REPLACE FUNCTION reject_reference_lease_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'reference lease history is immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS reference_run_lease_events_no_mutation ON reference_run_lease_events_v01;
CREATE TRIGGER reference_run_lease_events_no_mutation BEFORE UPDATE OR DELETE ON reference_run_lease_events_v01 FOR EACH ROW EXECUTE FUNCTION reject_reference_lease_history_mutation();
DROP TRIGGER IF EXISTS reference_checkpoint_fence_receipts_no_mutation ON reference_checkpoint_fence_receipts_v01;
CREATE TRIGGER reference_checkpoint_fence_receipts_no_mutation BEFORE UPDATE OR DELETE ON reference_checkpoint_fence_receipts_v01 FOR EACH ROW EXECUTE FUNCTION reject_reference_lease_history_mutation();
CREATE OR REPLACE FUNCTION enforce_reference_run_lease_fence() RETURNS trigger AS $$
DECLARE
  lease_row reference_run_leases_v01%ROWTYPE;
  session_worker text;
  session_token_text text;
  session_token bigint;
BEGIN
  SELECT * INTO lease_row FROM reference_run_leases_v01 WHERE correlation_id=NEW.correlation_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  session_worker := current_setting('app.reference_worker_id', true);
  session_token_text := current_setting('app.reference_fencing_token', true);
  IF session_worker IS NULL OR session_worker='' OR session_token_text IS NULL OR session_token_text='' THEN RAISE EXCEPTION 'reference run lease fence rejected missing session ownership'; END IF;
  BEGIN
    session_token := session_token_text::bigint;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'reference run lease fence rejected invalid session token';
  END;
  IF lease_row.lease_status <> 'ACTIVE' OR lease_row.lease_expires_at <= clock_timestamp() OR lease_row.worker_id <> session_worker OR lease_row.fencing_token <> session_token THEN RAISE EXCEPTION 'reference run lease fence rejected stale worker'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS reference_stage_checkpoints_lease_fence ON reference_stage_checkpoints_v01;
CREATE TRIGGER reference_stage_checkpoints_lease_fence BEFORE INSERT ON reference_stage_checkpoints_v01 FOR EACH ROW EXECUTE FUNCTION enforce_reference_run_lease_fence();
DROP TRIGGER IF EXISTS reference_artifacts_lease_fence ON reference_artifacts_v01;
CREATE TRIGGER reference_artifacts_lease_fence BEFORE INSERT ON reference_artifacts_v01 FOR EACH ROW EXECUTE FUNCTION enforce_reference_run_lease_fence();
DROP TRIGGER IF EXISTS reference_audit_events_lease_fence ON reference_audit_events_v01;
CREATE TRIGGER reference_audit_events_lease_fence BEFORE INSERT ON reference_audit_events_v01 FOR EACH ROW EXECUTE FUNCTION enforce_reference_run_lease_fence();
DROP TRIGGER IF EXISTS reference_evidence_runs_lease_fence ON reference_evidence_runs_v01;
CREATE TRIGGER reference_evidence_runs_lease_fence BEFORE INSERT ON reference_evidence_runs_v01 FOR EACH ROW EXECUTE FUNCTION enforce_reference_run_lease_fence();
CREATE OR REPLACE FUNCTION record_reference_checkpoint_fence_receipt() RETURNS trigger AS $$
DECLARE
  lease_row reference_run_leases_v01%ROWTYPE;
BEGIN
  SELECT * INTO lease_row FROM reference_run_leases_v01 WHERE correlation_id=NEW.correlation_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  INSERT INTO reference_checkpoint_fence_receipts_v01(correlation_id, stage_sequence, checkpoint_fingerprint, worker_id, fencing_token, lease_event_sequence, lease_event_hash, lease_expires_at, capital_state, real_money)
  VALUES(NEW.correlation_id, NEW.stage_sequence, NEW.checkpoint_fingerprint, lease_row.worker_id, lease_row.fencing_token, lease_row.event_sequence, lease_row.last_event_hash, lease_row.lease_expires_at, 'LOCKED', 'NO');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS reference_stage_checkpoints_fence_receipt ON reference_stage_checkpoints_v01;
CREATE TRIGGER reference_stage_checkpoints_fence_receipt AFTER INSERT ON reference_stage_checkpoints_v01 FOR EACH ROW EXECUTE FUNCTION record_reference_checkpoint_fence_receipt();
