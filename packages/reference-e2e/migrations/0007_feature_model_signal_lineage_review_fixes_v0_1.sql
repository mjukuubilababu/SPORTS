DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='reference_model_snapshots_id_event_uq'
       AND conrelid='reference_model_snapshots_v01'::regclass
  ) THEN
    ALTER TABLE reference_model_snapshots_v01
      ADD CONSTRAINT reference_model_snapshots_id_event_uq
      UNIQUE(model_snapshot_id,event_id);
  END IF;
END;
$$;

ALTER TABLE reference_model_feature_lineage_v01
  DROP CONSTRAINT IF EXISTS reference_model_feature_lineage_v01_model_snapshot_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='reference_model_feature_model_event_fk'
       AND conrelid='reference_model_feature_lineage_v01'::regclass
  ) THEN
    ALTER TABLE reference_model_feature_lineage_v01
      ADD CONSTRAINT reference_model_feature_model_event_fk
      FOREIGN KEY(model_snapshot_id,event_id)
      REFERENCES reference_model_snapshots_v01(model_snapshot_id,event_id);
  END IF;
END;
$$;

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
   WHERE model_snapshot_id=NEW.model_snapshot_id
     AND event_id=NEW.event_id;
  IF model_frozen IS NULL OR source_event IS NULL OR source_event <> NEW.event_id
     OR source_eligible IS NOT TRUE OR source_captured > model_frozen THEN
    RAISE EXCEPTION 'model feature lineage must use exact eligible evidence available by model freeze';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
