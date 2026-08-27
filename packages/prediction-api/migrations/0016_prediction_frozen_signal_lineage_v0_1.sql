CREATE TABLE IF NOT EXISTS prediction_snapshot_frozen_signal_lineage_v01(
  prediction_snapshot_id uuid PRIMARY KEY,
  event_id text NOT NULL,
  frozen_signal_snapshot_id text NOT NULL,
  frozen_signal_fingerprint text NOT NULL CHECK(frozen_signal_fingerprint ~ '^[0-9a-f]{64}$'),
  link_fingerprint text NOT NULL UNIQUE CHECK(link_fingerprint ~ '^[0-9a-f]{64}$'),
  persisted_at timestamptz NOT NULL DEFAULT now(),
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  FOREIGN KEY(prediction_snapshot_id) REFERENCES prediction_snapshots_v01(snapshot_id),
  FOREIGN KEY(frozen_signal_snapshot_id,frozen_signal_fingerprint,event_id)
    REFERENCES reference_frozen_signal_snapshots_v01(signal_snapshot_id,signal_fingerprint,event_id)
);

CREATE INDEX IF NOT EXISTS prediction_frozen_signal_event_idx
  ON prediction_snapshot_frozen_signal_lineage_v01(event_id,frozen_signal_snapshot_id);

CREATE OR REPLACE FUNCTION reject_prediction_frozen_signal_lineage_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'prediction frozen signal lineage is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prediction_frozen_signal_lineage_no_mutation
  ON prediction_snapshot_frozen_signal_lineage_v01;
CREATE TRIGGER prediction_frozen_signal_lineage_no_mutation
BEFORE UPDATE OR DELETE ON prediction_snapshot_frozen_signal_lineage_v01
FOR EACH ROW EXECUTE FUNCTION reject_prediction_frozen_signal_lineage_mutation();
