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
  UNIQUE(outcome_id,outcome_fingerprint,event_id),
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
  outcome_fingerprint text NOT NULL CHECK(outcome_fingerprint ~ '^[0-9a-f]{64}
  validation_payload jsonb NOT NULL,
  validation_payload_fingerprint text NOT NULL CHECK(validation_payload_fingerprint ~ '^[0-9a-f]{64}$'),
  validation_fingerprint text NOT NULL UNIQUE CHECK(validation_fingerprint ~ '^[0-9a-f]{64}$'),
  validated_at timestamptz NOT NULL,
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  FOREIGN KEY(prediction_snapshot_id,event_id)
    REFERENCES prediction_snapshots_v01(snapshot_id,event_id),
  FOREIGN KEY(outcome_id,outcome_fingerprint,event_id)
    REFERENCES prediction_outcomes_v01(outcome_id,outcome_fingerprint,event_id),
  UNIQUE(prediction_snapshot_id,outcome_id)
);

CREATE OR REPLACE FUNCTION enforce_prediction_outcome_temporal_lineage() RETURNS trigger AS $
DECLARE lineage_kickoff timestamptz;
BEGIN
  SELECT s.kickoff_at INTO lineage_kickoff
    FROM prediction_snapshot_frozen_signal_lineage_v01 l
    JOIN reference_frozen_signal_snapshots_v01 s
      ON s.signal_snapshot_id=l.frozen_signal_snapshot_id
     AND s.signal_fingerprint=l.frozen_signal_fingerprint
     AND s.event_id=l.event_id
   WHERE l.prediction_snapshot_id=NEW.prediction_snapshot_id
     AND l.event_id=NEW.event_id;
  IF lineage_kickoff IS NULL OR NEW.occurred_at <= lineage_kickoff THEN
    RAISE EXCEPTION 'prediction outcome must follow exact lineage kickoff';
  END IF;
  RETURN NEW;
END;
$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_prediction_validation_temporal_lineage() RETURNS trigger AS $
DECLARE outcome_observed timestamptz;
BEGIN
  SELECT observed_at INTO outcome_observed FROM prediction_outcomes_v01
   WHERE outcome_id=NEW.outcome_id AND event_id=NEW.event_id
     AND prediction_snapshot_id=NEW.prediction_snapshot_id;
  IF outcome_observed IS NULL OR NEW.validated_at < outcome_observed THEN
    RAISE EXCEPTION 'prediction validation cannot predate exact outcome observation';
  END IF;
  RETURN NEW;
END;
$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prediction_outcomes_temporal_guard ON prediction_outcomes_v01;
CREATE TRIGGER prediction_outcomes_temporal_guard BEFORE INSERT ON prediction_outcomes_v01
FOR EACH ROW EXECUTE FUNCTION enforce_prediction_outcome_temporal_lineage();
DROP TRIGGER IF EXISTS prediction_validations_temporal_guard ON prediction_validations_v01;
CREATE TRIGGER prediction_validations_temporal_guard BEFORE INSERT ON prediction_validations_v01
FOR EACH ROW EXECUTE FUNCTION enforce_prediction_validation_temporal_lineage();

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
),
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
    REFERENCES prediction_outcomes_v01(outcome_id,event_id),
  UNIQUE(prediction_snapshot_id,outcome_id)
);

CREATE OR REPLACE FUNCTION enforce_prediction_outcome_temporal_lineage() RETURNS trigger AS $
DECLARE lineage_kickoff timestamptz;
BEGIN
  SELECT s.kickoff_at INTO lineage_kickoff
    FROM prediction_snapshot_frozen_signal_lineage_v01 l
    JOIN reference_frozen_signal_snapshots_v01 s
      ON s.signal_snapshot_id=l.frozen_signal_snapshot_id
     AND s.signal_fingerprint=l.frozen_signal_fingerprint
     AND s.event_id=l.event_id
   WHERE l.prediction_snapshot_id=NEW.prediction_snapshot_id
     AND l.event_id=NEW.event_id;
  IF lineage_kickoff IS NULL OR NEW.occurred_at <= lineage_kickoff THEN
    RAISE EXCEPTION 'prediction outcome must follow exact lineage kickoff';
  END IF;
  RETURN NEW;
END;
$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_prediction_validation_temporal_lineage() RETURNS trigger AS $
DECLARE outcome_observed timestamptz;
BEGIN
  SELECT observed_at INTO outcome_observed FROM prediction_outcomes_v01
   WHERE outcome_id=NEW.outcome_id AND event_id=NEW.event_id
     AND prediction_snapshot_id=NEW.prediction_snapshot_id;
  IF outcome_observed IS NULL OR NEW.validated_at < outcome_observed THEN
    RAISE EXCEPTION 'prediction validation cannot predate exact outcome observation';
  END IF;
  RETURN NEW;
END;
$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prediction_outcomes_temporal_guard ON prediction_outcomes_v01;
CREATE TRIGGER prediction_outcomes_temporal_guard BEFORE INSERT ON prediction_outcomes_v01
FOR EACH ROW EXECUTE FUNCTION enforce_prediction_outcome_temporal_lineage();
DROP TRIGGER IF EXISTS prediction_validations_temporal_guard ON prediction_validations_v01;
CREATE TRIGGER prediction_validations_temporal_guard BEFORE INSERT ON prediction_validations_v01
FOR EACH ROW EXECUTE FUNCTION enforce_prediction_validation_temporal_lineage();

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
