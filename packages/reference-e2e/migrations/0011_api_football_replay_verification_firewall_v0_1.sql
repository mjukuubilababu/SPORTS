-- API-Football replay evidence is never verified or prematch eligible.
-- This constraint protects the persistence boundary even if a serialized
-- runtime envelope is edited before ingestion.
ALTER TABLE reference_ingestion_observations_v01
  DROP CONSTRAINT IF EXISTS reference_ingestion_replay_unverified_ck;

ALTER TABLE reference_ingestion_observations_v01
  ADD CONSTRAINT reference_ingestion_replay_unverified_ck
  CHECK (
    upper(btrim(source_type)) <> 'PROVIDER_API_REPLAY'
    OR (is_verified = false AND pre_match_eligible = false)
  ) NOT VALID;

ALTER TABLE reference_ingestion_observations_v01
  VALIDATE CONSTRAINT reference_ingestion_replay_unverified_ck;
