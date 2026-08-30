CREATE TABLE IF NOT EXISTS prediction_outcomes_v01(
  outcome_id text PRIMARY KEY,
  prediction_snapshot_id uuid NOT NULL,
  event_id text NOT NULL,
  outcome_kind text NOT NULL CHECK(outcome_kind IN ('OFFICIAL_RESULT','VOID')),
  home_goals integer CHECK(home_goals >= 0),
  away_goals integer CHECK(away_goals >= 0),
  official_source text NOT NULL,
  source_payload jsonb NOT NULL,
  source_payload_fingerprint text NOT NULL CHECK(source_payload_fingerprint ~ '^[0-9a-f]{64}$'),
  outcome_fingerprint text NOT NULL UNIQUE CHECK(outcome_fingerprint ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  UNIQUE(outcome_id,event_id),
  FOREIGN KEY(prediction_snapshot_id,event_id)
    REFERENCES prediction_snapshots_v01(snapshot_id,event_id),
  CHECK(observed_at >= occurred_at),
  CHECK((outcome_kind='VOID' AND home_goals IS NULL AND away_goals IS NULL)
     OR (outcome_kind='OFFICIAL_RESULT' AND home_goals IS NOT NULL AND away_goals IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS prediction_validations_v01(
  validation_id text PRIMARY KEY,
  prediction_snapshot_id uuid NOT NULL,
  outcome_id text NOT NULL,
  event_id text NOT NULL,
  validation_payload jsonb NOT NULL,
  validation_payload_fingerprint text NOT NULL CHECK(validation_payload_fingerprint ~ '^[0-9a-f]{64}$'),
  validation_fingerprint text NOT NULL UNIQUE CHECK(validation_fingerprint ~ '^[0-9a-f]{64}$'),
  validated_at timestamptz NOT NULL,
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  FOREIGN KEY(prediction_snapshot_id,event_id)
    REFERENCES prediction_snapshots_v01(snapshot_id,event_id),
  FOREIGN KEY(outcome_id,event_id)
    REFERENCES prediction_outcomes_v01(outcome_id,event_id)
);

CREATE OR REPLACE FUNCTION reject_prediction_validation_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'prediction outcome and validation evidence is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prediction_outcomes_no_mutation ON prediction_outcomes_v01;
CREATE TRIGGER prediction_outcomes_no_mutation BEFORE UPDATE OR DELETE ON prediction_outcomes_v01
FOR EACH ROW EXECUTE FUNCTION reject_prediction_validation_mutation();
DROP TRIGGER IF EXISTS prediction_validations_no_mutation ON prediction_validations_v01;
CREATE TRIGGER prediction_validations_no_mutation BEFORE UPDATE OR DELETE ON prediction_validations_v01
FOR EACH ROW EXECUTE FUNCTION reject_prediction_validation_mutation();
