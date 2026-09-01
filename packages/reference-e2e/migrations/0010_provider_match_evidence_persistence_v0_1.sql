CREATE OR REPLACE FUNCTION enforce_reference_match_evidence_snapshot_observation_v01()
RETURNS trigger AS $$
DECLARE
  snapshot jsonb;
  expected_eligible boolean;
BEGIN
  IF NEW.evidence_kind <> 'MATCH_EVIDENCE_SNAPSHOT' THEN
    RETURN NEW;
  END IF;

  snapshot := NEW.payload_json->'snapshot';
  expected_eligible :=
    NEW.is_verified IS TRUE
    AND NEW.prediction_cutoff IS NOT NULL
    AND NEW.available_at <= NEW.prediction_cutoff
    AND NEW.captured_at <= NEW.prediction_cutoff;

  IF jsonb_typeof(NEW.payload_json) IS DISTINCT FROM 'object'
     OR NEW.payload_json->>'schema_version' IS DISTINCT FROM 'POSTGRES_PROVIDER_MATCH_EVIDENCE_PERSISTENCE_V0_1'
     OR NEW.payload_json->>'event_id' IS DISTINCT FROM NEW.event_id
     OR NEW.payload_json->>'evidence_snapshot_id' IS DISTINCT FROM NEW.entity_id
     OR COALESCE(NEW.payload_json->>'provider_payload_fingerprint', '') !~ '^[0-9a-f]{64}$'
     OR COALESCE(NEW.payload_json->>'evidence_snapshot_fingerprint', '') !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(snapshot) IS DISTINCT FROM 'object'
     OR snapshot->>'event_id' IS DISTINCT FROM NEW.event_id
     OR snapshot->>'evidence_snapshot_id' IS DISTINCT FROM NEW.entity_id
     OR snapshot->>'fingerprint' IS DISTINCT FROM NEW.payload_json->>'evidence_snapshot_fingerprint'
     OR (snapshot->>'immutable')::boolean IS DISTINCT FROM TRUE
     OR snapshot->>'source_provider' IS DISTINCT FROM NEW.provider
     OR snapshot->>'source_type' IS DISTINCT FROM NEW.source_type
     OR snapshot->>'source_reference' IS DISTINCT FROM NEW.source
     OR snapshot #>> '{source,provider}' IS DISTINCT FROM NEW.provider
     OR snapshot #>> '{source,source_type}' IS DISTINCT FROM NEW.source_type
     OR snapshot #>> '{source,source_reference}' IS DISTINCT FROM NEW.source
     OR (snapshot #>> '{source,verified}')::boolean IS DISTINCT FROM NEW.is_verified
     OR (snapshot->>'captured_at')::timestamptz IS DISTINCT FROM NEW.captured_at
     OR (snapshot #>> '{source,captured_at}')::timestamptz IS DISTINCT FROM NEW.captured_at
     OR (snapshot->>'kickoff_at')::timestamptz <= NEW.captured_at
     OR NEW.prediction_cutoff IS NULL
     OR NEW.prediction_cutoff >= (snapshot->>'kickoff_at')::timestamptz
     OR NEW.entity_type IS DISTINCT FROM 'MATCH_EVIDENCE_SNAPSHOT'
     OR NEW.pre_match_eligible IS DISTINCT FROM expected_eligible
  THEN
    RAISE EXCEPTION 'match evidence snapshot provenance payload is not exact';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reference_match_evidence_snapshot_observation_guard_v01
  ON reference_ingestion_observations_v01;
CREATE TRIGGER reference_match_evidence_snapshot_observation_guard_v01
BEFORE INSERT ON reference_ingestion_observations_v01
FOR EACH ROW EXECUTE FUNCTION enforce_reference_match_evidence_snapshot_observation_v01();

CREATE OR REPLACE FUNCTION enforce_reference_match_evidence_feature_lineage_v01()
RETURNS trigger AS $$
DECLARE
  source_observation reference_ingestion_observations_v01%ROWTYPE;
  payload jsonb;
  feature jsonb;
  snapshot jsonb;
  feature_event_time text;
BEGIN
  IF NEW.feature_name NOT LIKE 'match_evidence.%' THEN
    RETURN NEW;
  END IF;

  SELECT *
    INTO source_observation
    FROM reference_ingestion_observations_v01
   WHERE provenance_id = NEW.source_provenance_id
     AND evidence_fingerprint = NEW.source_evidence_fingerprint
     AND event_id = NEW.event_id;

  payload := NEW.feature_payload;
  feature := payload->'feature';
  snapshot := source_observation.payload_json->'snapshot';
  feature_event_time := feature->>'event_time';

  IF source_observation.provenance_id IS NULL
     OR source_observation.evidence_kind IS DISTINCT FROM 'MATCH_EVIDENCE_SNAPSHOT'
     OR jsonb_typeof(payload) IS DISTINCT FROM 'object'
     OR payload->>'schema_version' IS DISTINCT FROM 'POSTGRES_PROVIDER_MATCH_EVIDENCE_PERSISTENCE_V0_1'
     OR payload->>'event_id' IS DISTINCT FROM NEW.event_id
     OR payload->>'evidence_snapshot_id' IS DISTINCT FROM source_observation.entity_id
     OR payload->>'evidence_snapshot_fingerprint'
          IS DISTINCT FROM source_observation.payload_json->>'evidence_snapshot_fingerprint'
     OR payload->>'feature_name' IS DISTINCT FROM NEW.feature_name
     OR COALESCE(payload->>'feature_path', '') !~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'
     OR NEW.feature_name IS DISTINCT FROM 'match_evidence.' || (payload->>'feature_path')
     OR ((snapshot->'features') #> string_to_array(payload->>'feature_path', '.')) IS DISTINCT FROM feature
     OR jsonb_typeof(feature) IS DISTINCT FROM 'object'
     OR feature->>'feature_version' IS DISTINCT FROM NEW.feature_version
     OR feature->>'provider' IS DISTINCT FROM source_observation.provider
     OR feature->>'source_type' IS DISTINCT FROM source_observation.source_type
     OR feature #>> '{source,provider}' IS DISTINCT FROM source_observation.provider
     OR feature #>> '{source,source_type}' IS DISTINCT FROM source_observation.source_type
     OR feature #>> '{source,source_reference}' IS DISTINCT FROM source_observation.source
     OR (feature->>'captured_at')::timestamptz IS DISTINCT FROM source_observation.captured_at
     OR (feature #>> '{source,captured_at}')::timestamptz IS DISTINCT FROM source_observation.captured_at
     OR NEW.created_at IS DISTINCT FROM source_observation.captured_at
     OR (
       feature_event_time IS NOT NULL
       AND (
         feature_event_time::timestamptz > source_observation.captured_at
         OR feature_event_time::timestamptz >= (snapshot->>'kickoff_at')::timestamptz
       )
     )
  THEN
    RAISE EXCEPTION 'match evidence feature lineage is not exact';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reference_match_evidence_feature_lineage_guard_v01
  ON reference_feature_provenance_lineage_v01;
CREATE TRIGGER reference_match_evidence_feature_lineage_guard_v01
BEFORE INSERT ON reference_feature_provenance_lineage_v01
FOR EACH ROW EXECUTE FUNCTION enforce_reference_match_evidence_feature_lineage_v01();

COMMENT ON FUNCTION enforce_reference_match_evidence_snapshot_observation_v01() IS
  'DB-level event, source, verification, cutoff, and payload boundary for canonical MatchEvidenceSnapshot provenance.';
COMMENT ON FUNCTION enforce_reference_match_evidence_feature_lineage_v01() IS
  'DB-level exact event-aware MatchEvidence feature-to-snapshot provenance boundary.';
