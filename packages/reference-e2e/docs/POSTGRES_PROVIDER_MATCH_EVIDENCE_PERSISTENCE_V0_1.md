# PostgreSQL Provider Match Evidence Persistence v0.1

Status: **IMPLEMENTED-ARTIFACT**

This increment persists the canonical provider-derived `MatchEvidenceSnapshot` and its inferred features without introducing another evidence, feature, model, or prediction store.

## Canonical route

```text
real provider event
  -> existing MatchEvidenceSnapshot builder
  -> reference_ingestion_observations_v01
  -> reference_feature_provenance_lineage_v01
  -> existing reference_model_snapshots_v01
  -> existing reference_frozen_signal_snapshots_v01
```

The source observation contains the exact immutable snapshot, the snapshot fingerprint, and the fingerprint of the provider event payload. Each feature record is persisted in the existing feature-lineage table with its exact record payload, deterministic identity, source provenance ID, source evidence fingerprint, event ID, and version.

## Boundaries

- `pg.Pool` uses one checked-out `PoolClient` for `BEGIN -> observation -> all features -> COMMIT/ROLLBACK`.
- Exact replay is idempotent. A changed snapshot or provider payload using the same snapshot identity conflicts.
- Application checks reject row/snapshot identity mismatches and altered per-feature provenance.
- PostgreSQL insert guards independently enforce exact event, provider, source type/reference, verification, snapshot/cutoff timing, and feature-to-snapshot linkage.
- Existing event-aware foreign keys prevent cross-event feature/model lineage.
- Unverified evidence may be retained explicitly, but existing model-lineage guards prevent it from entering a model.
- Existing immutable triggers reject `UPDATE` and `DELETE`.
- Settlement is not accepted in this pre-match evidence route.

## Governance

P002 is unchanged. Gate1 remains authoritative truth owner. Gate6 remains capital owner. Prediction, validation, and execution remain separate. Capital is `LOCKED`, capital effect is `NONE`, real money is `NO`, and there is no automatic promotion or retuning.

## Verification

The dedicated workflow runs PostgreSQL 16, applies the existing migration chain plus `0010_provider_match_evidence_persistence_v0_1.sql` twice, runs existing provenance and feature/model/signal regressions, and verifies:

- exact archive and replay;
- changed-payload conflict;
- cross-event rejection at application and DB level;
- post-kickoff and forged identity rejection;
- partial failure rollback;
- one dedicated `PoolClient`;
- eligible downstream model/frozen-signal linkage;
- unverified evidence blocked from model lineage;
- immutable `UPDATE`/`DELETE`.
