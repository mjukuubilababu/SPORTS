CREATE TABLE IF NOT EXISTS prediction_snapshots_v01(
  snapshot_id uuid PRIMARY KEY,
  request_id text NOT NULL,
  endpoint text NOT NULL CHECK(endpoint IN ('/v1/predict','/v1/predict/live')),
  snapshot_type text NOT NULL CHECK(snapshot_type IN ('PREMATCH','LIVE')),
  event_id text NOT NULL,
  market text NOT NULL,
  selection text,
  input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[0-9a-f]{64}$'),
  output_sha256 text NOT NULL CHECK(output_sha256 ~ '^[0-9a-f]{64}$'),
  input_payload jsonb NOT NULL,
  prediction_payload jsonb NOT NULL,
  parent_signal_id text,
  model_version text,
  feature_version text,
  source_observed_at timestamptz,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  UNIQUE(request_id,endpoint)
);

CREATE INDEX IF NOT EXISTS prediction_snapshots_event_idx
  ON prediction_snapshots_v01(event_id,persisted_at);
CREATE INDEX IF NOT EXISTS prediction_snapshots_type_idx
  ON prediction_snapshots_v01(snapshot_type,persisted_at);

CREATE OR REPLACE FUNCTION reject_prediction_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'prediction snapshots are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prediction_snapshots_no_mutation ON prediction_snapshots_v01;
CREATE TRIGGER prediction_snapshots_no_mutation
BEFORE UPDATE OR DELETE ON prediction_snapshots_v01
FOR EACH ROW EXECUTE FUNCTION reject_prediction_snapshot_mutation();
