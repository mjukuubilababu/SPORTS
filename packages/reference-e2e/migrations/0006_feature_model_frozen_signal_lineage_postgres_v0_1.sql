CREATE UNIQUE INDEX IF NOT EXISTS reference_feature_lineage_exact_event_uq
  ON reference_feature_provenance_lineage_v01(lineage_id, feature_fingerprint, event_id);

CREATE TABLE IF NOT EXISTS reference_model_snapshots_v01(
  model_snapshot_id text PRIMARY KEY,
  event_id text NOT NULL,
  model_version text NOT NULL,
  model_fingerprint text NOT NULL CHECK(model_fingerprint ~ '^[0-9a-f]{64}$'),
  model_payload_fingerprint text NOT NULL CHECK(model_payload_fingerprint ~ '^[0-9a-f]{64}$'),
  model_payload jsonb NOT NULL,
  kickoff_at timestamptz NOT NULL,
  frozen_at timestamptz NOT NULL,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  UNIQUE(model_snapshot_id, model_fingerprint, event_id),
  CONSTRAINT reference_model_snapshots_id_event_uq UNIQUE(model_snapshot_id, event_id),
  CHECK(frozen_at < kickoff_at)
);

CREATE TABLE IF NOT EXISTS reference_model_feature_lineage_v01(
  model_snapshot_id text NOT NULL,
  feature_sequence integer NOT NULL CHECK(feature_sequence >= 0),
  event_id text NOT NULL,
  feature_lineage_id text NOT NULL,
  feature_fingerprint text NOT NULL CHECK(feature_fingerprint ~ '^[0-9a-f]{64}$'),
  link_fingerprint text NOT NULL UNIQUE CHECK(link_fingerprint ~ '^[0-9a-f]{64}$'),
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  PRIMARY KEY(model_snapshot_id, feature_sequence),
  CONSTRAINT reference_model_feature_model_event_fk
    FOREIGN KEY(model_snapshot_id, event_id)
    REFERENCES reference_model_snapshots_v01(model_snapshot_id, event_id),
  FOREIGN KEY(feature_lineage_id, feature_fingerprint, event_id)
    REFERENCES reference_feature_provenance_lineage_v01(lineage_id, feature_fingerprint, event_id)
);

CREATE TABLE IF NOT EXISTS reference_frozen_signal_snapshots_v01(
  signal_snapshot_id text PRIMARY KEY,
  event_id text NOT NULL,
  signal_kind text NOT NULL CHECK(
    signal_kind = upper(btrim(signal_kind))
    AND signal_kind IN ('FROZEN_SIGNAL','FROZEN_PREDICTION')
    AND signal_kind NOT IN ('SETTLEMENT','PREDICTION_SETTLEMENT')
  ),
  model_snapshot_id text NOT NULL,
  model_fingerprint text NOT NULL CHECK(model_fingerprint ~ '^[0-9a-f]{64}$'),
  signal_fingerprint text NOT NULL CHECK(signal_fingerprint ~ '^[0-9a-f]{64}$'),
  signal_payload_fingerprint text NOT NULL CHECK(signal_payload_fingerprint ~ '^[0-9a-f]{64}$'),
  signal_payload jsonb NOT NULL,
  kickoff_at timestamptz NOT NULL,
  frozen_at timestamptz NOT NULL,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  UNIQUE(signal_snapshot_id, signal_fingerprint),
  FOREIGN KEY(model_snapshot_id, model_fingerprint, event_id)
    REFERENCES reference_model_snapshots_v01(model_snapshot_id, model_fingerprint, event_id),
  CHECK(frozen_at < kickoff_at)
);

CREATE OR REPLACE FUNCTION enforce_reference_model_feature_prematch() RETURNS trigger AS $$
DECLARE
  source_event text;
  source_captured timestamptz;
  source_eligible boolean;
  model_frozen timestamptz;
BEGIN
  SELECT o.event_id, o.captured_at, o.pre_match_eligible
    INTO source_event, source_captured, source_eligible
    FROM reference_feature_provenance_lineage_v01 f
    JOIN reference_ingestion_observations_v01 o
      ON o.provenance_id=f.source_provenance_id
     AND o.evidence_fingerprint=f.source_evidence_fingerprint
     AND o.event_id=f.event_id
   WHERE f.lineage_id=NEW.feature_lineage_id
     AND f.feature_fingerprint=NEW.feature_fingerprint
     AND f.event_id=NEW.event_id;
  SELECT frozen_at INTO model_frozen
    FROM reference_model_snapshots_v01
   WHERE model_snapshot_id=NEW.model_snapshot_id AND event_id=NEW.event_id;
  IF model_frozen IS NULL OR source_event IS NULL OR source_event <> NEW.event_id OR source_eligible IS NOT TRUE OR source_captured > model_frozen THEN
    RAISE EXCEPTION 'model feature lineage must use exact eligible pre-kickoff source evidence';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reference_model_feature_prematch_guard ON reference_model_feature_lineage_v01;
CREATE TRIGGER reference_model_feature_prematch_guard
BEFORE INSERT ON reference_model_feature_lineage_v01
FOR EACH ROW EXECUTE FUNCTION enforce_reference_model_feature_prematch();

CREATE OR REPLACE FUNCTION reject_reference_feature_model_signal_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'reference feature model signal lineage is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reference_model_snapshots_no_mutation ON reference_model_snapshots_v01;
CREATE TRIGGER reference_model_snapshots_no_mutation
BEFORE UPDATE OR DELETE ON reference_model_snapshots_v01
FOR EACH ROW EXECUTE FUNCTION reject_reference_feature_model_signal_mutation();

DROP TRIGGER IF EXISTS reference_model_feature_lineage_no_mutation ON reference_model_feature_lineage_v01;
CREATE TRIGGER reference_model_feature_lineage_no_mutation
BEFORE UPDATE OR DELETE ON reference_model_feature_lineage_v01
FOR EACH ROW EXECUTE FUNCTION reject_reference_feature_model_signal_mutation();

DROP TRIGGER IF EXISTS reference_frozen_signal_snapshots_no_mutation ON reference_frozen_signal_snapshots_v01;
CREATE TRIGGER reference_frozen_signal_snapshots_no_mutation
BEFORE UPDATE OR DELETE ON reference_frozen_signal_snapshots_v01
FOR EACH ROW EXECUTE FUNCTION reject_reference_feature_model_signal_mutation();
