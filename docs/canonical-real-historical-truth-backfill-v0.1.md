# Canonical Real Historical Truth & Backfill Pipeline v0.1

## Purpose

This capability replaces template-only Gate1→Gate2 handoff with a canonical real historical truth store.

The pipeline is:

`CSV/manual historical observations → Gate1 truth/provenance validation → canonical truth store → Gate2 chronological feature/model backfill`

It does **not** claim that Gate3 or Gate4 are statistically validated. It only creates the real-data path required to feed them later.

## Gate1 canonical importer

`packages/gate1/historical_truth_importer.py`

The importer separates:

- canonical venue-local match date;
- final-score provenance;
- market provenance;
- source-reported market date;
- Gate2 backfill eligibility;
- Gate1 validation-N eligibility.

A verified final result is sufficient for historical feature backfill even if market odds are absent. A market observation must independently satisfy the existing Gate1 source/quote policy before it can count as Gate1 validation-N eligible.

Conflicting final scores for the same canonical match ID are quarantined.

## Real seed

`packages/gate1/gate1_real_historical_seed_2026_mls.csv`

The first seed contains six real 2026 MLS opening-round matches already represented in the Gate1 closing-odds evidence set, now joined to verified final results from official club sources.

This seed is deliberately small. It proves real ingestion and provenance flow; it is **not** a statistically sufficient historical corpus.

Some archive odds rows report the match as February 22 while the official venue-local match date is February 21. The importer preserves both values and uses the official venue-local date for canonical identity.

## Gate2 bridge

`packages/gate2/canonical_backfill.py`

`matches_from_truth_store()` accepts only `REAL_HISTORICAL_TRUTH` store v0.1 records with `gate2_backfill_eligible=true`.

`build_backfill_from_truth_store()` then calls the existing Gate2 `build_features()` implementation. Therefore existing no-hindsight behavior remains intact: the current match enters history only after its features are computed.

For the six-match opening-round seed there is not enough prior history for the Gate2 warmup threshold, so the expected state is `PENDING`, not a fabricated model probability.

## Commands

Gate1 import:

```bash
cd packages/gate1
python import_historical_truth.py \
  MLS-2026-OPENING-REAL-SEED-V0.1 \
  gate1_real_historical_seed_2026_mls.csv \
  /tmp/gate1-truth-store.json
```

Gate2 backfill:

```bash
cd packages/gate2
python run_canonical_backfill.py \
  /tmp/gate1-truth-store.json \
  /tmp/gate2-backfill.json
```

Pipeline test:

```bash
python scripts/test_canonical_historical_pipeline.py
```

The root `scripts/verify_unified.py` also invokes this pipeline test.

## Current limitation

The real-data path is now implemented, but the historical corpus must still be expanded substantially before Gate2 produces broad warm historical model coverage and before Gate3/Gate4 evidence thresholds can be satisfied.

No capital unlock is implied. `real_money = NO` remains unchanged.
