CREATE TABLE IF NOT EXISTS reference_artifacts_v01(
  correlation_id text NOT NULL,
  artifact_type text NOT NULL,
  artifact_id text NOT NULL,
  event_id text,
  content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  payload_json jsonb NOT NULL,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  PRIMARY KEY(artifact_type, artifact_id)
);

CREATE INDEX IF NOT EXISTS reference_artifacts_event_idx
  ON reference_artifacts_v01(event_id, persisted_at);
CREATE INDEX IF NOT EXISTS reference_artifacts_correlation_idx
  ON reference_artifacts_v01(correlation_id, artifact_type);

CREATE TABLE IF NOT EXISTS reference_audit_events_v01(
  audit_id text PRIMARY KEY,
  correlation_id text NOT NULL,
  causation_id text,
  actor text NOT NULL,
  action text NOT NULL,
  artifact_type text NOT NULL,
  artifact_id text NOT NULL,
  sequence integer NOT NULL CHECK(sequence >= 0),
  previous_hash text NOT NULL CHECK(previous_hash='GENESIS' OR previous_hash ~ '^[0-9a-f]{64}$'),
  event_hash text NOT NULL CHECK(event_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL,
  event_json jsonb NOT NULL,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  UNIQUE(correlation_id, sequence)
);

CREATE INDEX IF NOT EXISTS reference_audit_correlation_idx
  ON reference_audit_events_v01(correlation_id, sequence);

CREATE TABLE IF NOT EXISTS reference_evidence_runs_v01(
  correlation_id text PRIMARY KEY,
  state text NOT NULL CHECK(state='ASSURED'),
  assurance_gate text,
  artifact_count integer NOT NULL CHECK(artifact_count > 0),
  audit_event_count integer NOT NULL CHECK(audit_event_count > 0),
  artifact_set_hash text NOT NULL CHECK(artifact_set_hash ~ '^[0-9a-f]{64}$'),
  audit_chain_head text NOT NULL CHECK(audit_chain_head ~ '^[0-9a-f]{64}$'),
  archive_fingerprint text NOT NULL UNIQUE CHECK(archive_fingerprint ~ '^[0-9a-f]{64}$'),
  persisted_at timestamptz NOT NULL DEFAULT now(),
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO')
);

CREATE OR REPLACE FUNCTION reject_reference_evidence_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'reference evidence is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reference_artifacts_no_mutation ON reference_artifacts_v01;
CREATE TRIGGER reference_artifacts_no_mutation
BEFORE UPDATE OR DELETE ON reference_artifacts_v01
FOR EACH ROW EXECUTE FUNCTION reject_reference_evidence_mutation();

DROP TRIGGER IF EXISTS reference_audit_no_mutation ON reference_audit_events_v01;
CREATE TRIGGER reference_audit_no_mutation
BEFORE UPDATE OR DELETE ON reference_audit_events_v01
FOR EACH ROW EXECUTE FUNCTION reject_reference_evidence_mutation();

DROP TRIGGER IF EXISTS reference_evidence_runs_no_mutation ON reference_evidence_runs_v01;
CREATE TRIGGER reference_evidence_runs_no_mutation
BEFORE UPDATE OR DELETE ON reference_evidence_runs_v01
FOR EACH ROW EXECUTE FUNCTION reject_reference_evidence_mutation();
