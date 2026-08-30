ALTER TABLE reference_feature_provenance_lineage_v01
  ADD COLUMN IF NOT EXISTS feature_payload jsonb;

COMMENT ON COLUMN reference_feature_provenance_lineage_v01.feature_payload IS
  'Exact immutable feature payload. NULL denotes a pre-v0.1 legacy row that cannot be downstream-attested.';
