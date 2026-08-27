CREATE TABLE IF NOT EXISTS reference_stage_checkpoints_v01(
  correlation_id text NOT NULL,
  stage_sequence integer NOT NULL CHECK(stage_sequence >= 0 AND stage_sequence <= 10),
  stage text NOT NULL CHECK(stage IN (
    'INGEST','FEATURE','MODEL','PATTERN','DECISION','RISK','EXECUTION','START','SETTLEMENT','EVALUATION','ASSURANCE'
  )),
  state text NOT NULL CHECK(state IN (
    'DATA_READY','FEATURES_READY','MODEL_READY','PATTERN_READY','DECIDED','RISK_APPROVED',
    'PAPER_EXECUTED','STARTED','SETTLED','EVALUATED','ASSURED'
  )),
  run_input_hash text NOT NULL CHECK(run_input_hash ~ '^[0-9a-f]{64}$'),
  previous_checkpoint_fingerprint text NOT NULL CHECK(
    previous_checkpoint_fingerprint='GENESIS' OR previous_checkpoint_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  checkpoint_fingerprint text NOT NULL UNIQUE CHECK(checkpoint_fingerprint ~ '^[0-9a-f]{64}$'),
  artifact_type text,
  artifact_id text,
  artifact_hash text CHECK(artifact_hash IS NULL OR artifact_hash ~ '^[0-9a-f]{64}$'),
  artifact_json jsonb,
  audit_id text,
  audit_event_hash text CHECK(audit_event_hash IS NULL OR audit_event_hash ~ '^[0-9a-f]{64}$'),
  audit_event_json jsonb,
  trace_json jsonb NOT NULL,
  duplicate_execution boolean NOT NULL DEFAULT false,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  PRIMARY KEY(correlation_id, stage_sequence),
  CHECK(
    (stage='START' AND artifact_type IS NULL AND artifact_id IS NULL AND artifact_hash IS NULL AND artifact_json IS NULL
                   AND audit_id IS NULL AND audit_event_hash IS NULL AND audit_event_json IS NULL)
    OR
    (stage<>'START' AND artifact_type IS NOT NULL AND artifact_id IS NOT NULL AND artifact_hash IS NOT NULL AND artifact_json IS NOT NULL
                    AND audit_id IS NOT NULL AND audit_event_hash IS NOT NULL AND audit_event_json IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS reference_stage_checkpoints_correlation_idx
  ON reference_stage_checkpoints_v01(correlation_id, stage_sequence);

DROP TRIGGER IF EXISTS reference_stage_checkpoints_no_mutation ON reference_stage_checkpoints_v01;
CREATE TRIGGER reference_stage_checkpoints_no_mutation
BEFORE UPDATE OR DELETE ON reference_stage_checkpoints_v01
FOR EACH ROW EXECUTE FUNCTION reject_reference_evidence_mutation();
