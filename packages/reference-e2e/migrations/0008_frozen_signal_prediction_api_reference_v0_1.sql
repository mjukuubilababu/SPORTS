DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='reference_frozen_signal_exact_event_uq'
       AND conrelid='reference_frozen_signal_snapshots_v01'::regclass
  ) THEN
    ALTER TABLE reference_frozen_signal_snapshots_v01
      ADD CONSTRAINT reference_frozen_signal_exact_event_uq
      UNIQUE(signal_snapshot_id,signal_fingerprint,event_id);
  END IF;
END;
$$;
