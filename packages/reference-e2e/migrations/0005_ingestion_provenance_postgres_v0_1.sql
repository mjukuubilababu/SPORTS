CREATE TABLE IF NOT EXISTS reference_ingestion_observations_v01(
  provenance_id text PRIMARY KEY,
  observation_id text NOT NULL,
  event_id text NOT NULL,
  entity_type text,
  entity_id text,
  evidence_kind text NOT NULL CHECK(
    evidence_kind = upper(btrim(evidence_kind))
    AND evidence_kind NOT IN ('SETTLEMENT','PREDICTION_SETTLEMENT')
  ),
  provider text,
  source text NOT NULL,
  source_type text NOT NULL,
  source_url text,
  observed_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL,
  prediction_cutoff timestamptz,
  is_verified boolean NOT NULL,
  pre_match_eligible boolean NOT NULL,
  source_payload_fingerprint text NOT NULL CHECK(source_payload_fingerprint ~ '^[0-9a-f]{64}$'),
  evidence_fingerprint text NOT NULL CHECK(evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  payload_json jsonb NOT NULL,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  UNIQUE(event_id, observation_id),
  UNIQUE(provenance_id, evidence_fingerprint),
  UNIQUE(provenance_id, evidence_fingerprint, event_id),
  CHECK(available_at >= observed_at),
  CHECK(captured_at >= available_at),
  CHECK(
    pre_match_eligible = false OR (
      is_verified = true AND
      prediction_cutoff IS NOT NULL AND
      available_at <= prediction_cutoff AND
      captured_at <= prediction_cutoff
    )
  )
);

CREATE INDEX IF NOT EXISTS reference_ingestion_event_idx
  ON reference_ingestion_observations_v01(event_id, captured_at);
CREATE INDEX IF NOT EXISTS reference_ingestion_source_payload_idx
  ON reference_ingestion_observations_v01(event_id, source_payload_fingerprint);

CREATE TABLE IF NOT EXISTS reference_feature_provenance_lineage_v01(
  lineage_id text PRIMARY KEY,
  feature_id text NOT NULL,
  event_id text NOT NULL,
  feature_name text NOT NULL,
  feature_version text NOT NULL,
  feature_fingerprint text NOT NULL CHECK(feature_fingerprint ~ '^[0-9a-f]{64}$'),
  feature_payload jsonb,
  source_provenance_id text NOT NULL,
  source_evidence_fingerprint text NOT NULL CHECK(source_evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  lineage_fingerprint text NOT NULL UNIQUE CHECK(lineage_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  UNIQUE(feature_id, source_provenance_id, source_evidence_fingerprint),
  FOREIGN KEY(source_provenance_id, source_evidence_fingerprint, event_id)
    REFERENCES reference_ingestion_observations_v01(provenance_id, evidence_fingerprint, event_id)
);

CREATE INDEX IF NOT EXISTS reference_feature_lineage_event_idx
  ON reference_feature_provenance_lineage_v01(event_id, feature_id);

CREATE TABLE IF NOT EXISTS reference_match_memory_materializations_v01(
  memory_fingerprint text PRIMARY KEY CHECK(memory_fingerprint ~ '^[0-9a-f]{64}$'),
  memory_id text NOT NULL,
  event_id text NOT NULL,
  memory_version text NOT NULL,
  source_truth_record_fingerprint text NOT NULL CHECK(source_truth_record_fingerprint ~ '^[0-9a-f]{64}$'),
  memory_payload_fingerprint text NOT NULL UNIQUE CHECK(memory_payload_fingerprint ~ '^[0-9a-f]{64}$'),
  evidence_set_fingerprint text NOT NULL CHECK(evidence_set_fingerprint ~ '^[0-9a-f]{64}$'),
  materialized_at timestamptz NOT NULL,
  prediction_cutoff timestamptz,
  memory_json jsonb NOT NULL,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  truth_owner text NOT NULL CHECK(truth_owner='GATE1'),
  memory_role text NOT NULL CHECK(memory_role='DERIVED_IMMUTABLE_MATERIALIZED_VIEW'),
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  UNIQUE(memory_id, memory_fingerprint)
);

CREATE INDEX IF NOT EXISTS reference_match_memory_event_idx
  ON reference_match_memory_materializations_v01(event_id, materialized_at);

CREATE TABLE IF NOT EXISTS reference_match_memory_evidence_links_v01(
  memory_fingerprint text NOT NULL,
  evidence_sequence integer NOT NULL CHECK(evidence_sequence >= 0),
  evidence_role text NOT NULL CHECK(evidence_role IN ('OBSERVATION','MARKET_SNAPSHOT')),
  source_provenance_id text NOT NULL,
  source_evidence_fingerprint text NOT NULL CHECK(source_evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  link_fingerprint text NOT NULL UNIQUE CHECK(link_fingerprint ~ '^[0-9a-f]{64}$'),
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  PRIMARY KEY(memory_fingerprint, evidence_sequence),
  FOREIGN KEY(memory_fingerprint)
    REFERENCES reference_match_memory_materializations_v01(memory_fingerprint),
  FOREIGN KEY(source_provenance_id, source_evidence_fingerprint)
    REFERENCES reference_ingestion_observations_v01(provenance_id, evidence_fingerprint)
);

CREATE INDEX IF NOT EXISTS reference_match_memory_evidence_source_idx
  ON reference_match_memory_evidence_links_v01(source_provenance_id, memory_fingerprint);

CREATE OR REPLACE FUNCTION reject_reference_ingestion_provenance_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'reference ingestion provenance is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reference_ingestion_observations_no_mutation ON reference_ingestion_observations_v01;
CREATE TRIGGER reference_ingestion_observations_no_mutation
BEFORE UPDATE OR DELETE ON reference_ingestion_observations_v01
FOR EACH ROW EXECUTE FUNCTION reject_reference_ingestion_provenance_mutation();

DROP TRIGGER IF EXISTS reference_feature_provenance_lineage_no_mutation ON reference_feature_provenance_lineage_v01;
CREATE TRIGGER reference_feature_provenance_lineage_no_mutation
BEFORE UPDATE OR DELETE ON reference_feature_provenance_lineage_v01
FOR EACH ROW EXECUTE FUNCTION reject_reference_ingestion_provenance_mutation();

DROP TRIGGER IF EXISTS reference_match_memory_materializations_no_mutation ON reference_match_memory_materializations_v01;
CREATE TRIGGER reference_match_memory_materializations_no_mutation
BEFORE UPDATE OR DELETE ON reference_match_memory_materializations_v01
FOR EACH ROW EXECUTE FUNCTION reject_reference_ingestion_provenance_mutation();

DROP TRIGGER IF EXISTS reference_match_memory_evidence_links_no_mutation ON reference_match_memory_evidence_links_v01;
CREATE TRIGGER reference_match_memory_evidence_links_no_mutation
BEFORE UPDATE OR DELETE ON reference_match_memory_evidence_links_v01
FOR EACH ROW EXECUTE FUNCTION reject_reference_ingestion_provenance_mutation();
),
  feature_payload jsonb,
  source_provenance_id text NOT NULL,
  source_evidence_fingerprint text NOT NULL CHECK(source_evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  lineage_fingerprint text NOT NULL UNIQUE CHECK(lineage_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  UNIQUE(feature_id, source_provenance_id, source_evidence_fingerprint),
  FOREIGN KEY(source_provenance_id, source_evidence_fingerprint, event_id)
    REFERENCES reference_ingestion_observations_v01(provenance_id, evidence_fingerprint, event_id)
);

CREATE INDEX IF NOT EXISTS reference_feature_lineage_event_idx
  ON reference_feature_provenance_lineage_v01(event_id, feature_id);

CREATE TABLE IF NOT EXISTS reference_match_memory_materializations_v01(
  memory_fingerprint text PRIMARY KEY CHECK(memory_fingerprint ~ '^[0-9a-f]{64}$'),
  memory_id text NOT NULL,
  event_id text NOT NULL,
  memory_version text NOT NULL,
  source_truth_record_fingerprint text NOT NULL CHECK(source_truth_record_fingerprint ~ '^[0-9a-f]{64}$'),
  memory_payload_fingerprint text NOT NULL UNIQUE CHECK(memory_payload_fingerprint ~ '^[0-9a-f]{64}$'),
  evidence_set_fingerprint text NOT NULL CHECK(evidence_set_fingerprint ~ '^[0-9a-f]{64}$'),
  materialized_at timestamptz NOT NULL,
  prediction_cutoff timestamptz,
  memory_json jsonb NOT NULL,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  truth_owner text NOT NULL CHECK(truth_owner='GATE1'),
  memory_role text NOT NULL CHECK(memory_role='DERIVED_IMMUTABLE_MATERIALIZED_VIEW'),
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  UNIQUE(memory_id, memory_fingerprint)
);

CREATE INDEX IF NOT EXISTS reference_match_memory_event_idx
  ON reference_match_memory_materializations_v01(event_id, materialized_at);

CREATE TABLE IF NOT EXISTS reference_match_memory_evidence_links_v01(
  memory_fingerprint text NOT NULL,
  evidence_sequence integer NOT NULL CHECK(evidence_sequence >= 0),
  evidence_role text NOT NULL CHECK(evidence_role IN ('OBSERVATION','MARKET_SNAPSHOT')),
  source_provenance_id text NOT NULL,
  source_evidence_fingerprint text NOT NULL CHECK(source_evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  link_fingerprint text NOT NULL UNIQUE CHECK(link_fingerprint ~ '^[0-9a-f]{64}$'),
  capital_state text NOT NULL CHECK(capital_state='LOCKED'),
  real_money text NOT NULL CHECK(real_money='NO'),
  PRIMARY KEY(memory_fingerprint, evidence_sequence),
  FOREIGN KEY(memory_fingerprint)
    REFERENCES reference_match_memory_materializations_v01(memory_fingerprint),
  FOREIGN KEY(source_provenance_id, source_evidence_fingerprint)
    REFERENCES reference_ingestion_observations_v01(provenance_id, evidence_fingerprint)
);

CREATE INDEX IF NOT EXISTS reference_match_memory_evidence_source_idx
  ON reference_match_memory_evidence_links_v01(source_provenance_id, memory_fingerprint);

CREATE OR REPLACE FUNCTION reject_reference_ingestion_provenance_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'reference ingestion provenance is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reference_ingestion_observations_no_mutation ON reference_ingestion_observations_v01;
CREATE TRIGGER reference_ingestion_observations_no_mutation
BEFORE UPDATE OR DELETE ON reference_ingestion_observations_v01
FOR EACH ROW EXECUTE FUNCTION reject_reference_ingestion_provenance_mutation();

DROP TRIGGER IF EXISTS reference_feature_provenance_lineage_no_mutation ON reference_feature_provenance_lineage_v01;
CREATE TRIGGER reference_feature_provenance_lineage_no_mutation
BEFORE UPDATE OR DELETE ON reference_feature_provenance_lineage_v01
FOR EACH ROW EXECUTE FUNCTION reject_reference_ingestion_provenance_mutation();

DROP TRIGGER IF EXISTS reference_match_memory_materializations_no_mutation ON reference_match_memory_materializations_v01;
CREATE TRIGGER reference_match_memory_materializations_no_mutation
BEFORE UPDATE OR DELETE ON reference_match_memory_materializations_v01
FOR EACH ROW EXECUTE FUNCTION reject_reference_ingestion_provenance_mutation();

DROP TRIGGER IF EXISTS reference_match_memory_evidence_links_no_mutation ON reference_match_memory_evidence_links_v01;
CREATE TRIGGER reference_match_memory_evidence_links_no_mutation
BEFORE UPDATE OR DELETE ON reference_match_memory_evidence_links_v01
FOR EACH ROW EXECUTE FUNCTION reject_reference_ingestion_provenance_mutation();
