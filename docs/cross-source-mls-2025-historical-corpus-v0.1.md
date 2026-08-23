# Cross-Source MLS 2025 Historical Corpus v0.1

## Goal

Expand the canonical Gate1→Gate2 historical path beyond the six-match 2026 seed without lowering provenance standards.

This capability does not trust one season file by itself. A historical final result becomes `result_verified=true` only after two independent public source snapshots agree on:

1. normalized home team;
2. normalized away team;
3. exact final score;
4. source dates within one calendar day.

The one-day tolerance exists because the MLSOpenSkill/FixtureDownload-style source records UTC date/time while the OpenFootball source records the match date separately. Both source dates are retained.

## Reviewed source snapshots

### MLSOpenSkill

- URL: `https://raw.githubusercontent.com/dewanthenmalai/MLSOpenSkill/main/mls-2025.csv`
- reviewed Git blob SHA-1: `022c9bc83a3196adc702bf84a64217571b087630`
- shape: CSV with match number, round, UTC date/time, venue, team abbreviations and final result.

### OpenFootball football.json

- URL: `https://raw.githubusercontent.com/openfootball/football.json/master/2025/mls.json`
- reviewed Git blob SHA-1: `2896d283601615739418575cbe6b6c9b316a3151`
- shape: JSON with round, date, team names and final/half-time scores where settled data exists.

The source snapshots have different completeness. The reviewed OpenFootball snapshot contains settled scores through Matchday 11 and then has later fixture rows without scores. Therefore later rows are not promoted merely because the other source contains a result.

## Reconciler

`packages/gate1/cross_source_result_reconciler.py`

Important functions:

- `parse_mlsopenskill_csv()`
- `parse_openfootball_json()`
- `reconcile_results()`
- `build_truth_store_from_source_texts()`
- `verify_source_blob()`

The team abbreviation adapter expands source-A abbreviations before existing Gate1 team normalization runs.

A source-A row is accepted only if a source-B row with the same normalized home/away pair exists within ±1 day and has the exact same final score.

Quarantine reasons are explicit:

- `NO_CROSS_SOURCE_MATCH`
- `CROSS_SOURCE_SCORE_DISAGREEMENT`
- `CROSS_SOURCE_TARGET_ALREADY_CONSUMED`

## Fail-closed source acquisition

`packages/gate1/build_cross_source_mls2025.py`

The builder downloads the two public source files only when explicitly executed. It computes the Git blob SHA-1 from the returned bytes and compares it with the reviewed blob hash embedded in the source registry.

If either source changed, the command fails with `SOURCE_BLOB_SHA_MISMATCH` instead of silently importing a new historical corpus.

Run:

```bash
cd packages/gate1
python build_cross_source_mls2025.py \
  /tmp/mls-2025-truth-store.json \
  /tmp/mls-2025-reconciliation-audit.json
```

Then Gate2 uses the existing canonical bridge:

```bash
cd packages/gate2
python run_canonical_backfill.py \
  /tmp/mls-2025-truth-store.json \
  /tmp/mls-2025-gate2-backfill.json
```

## Expected reviewed-snapshot behavior

The reviewed MLSOpenSkill snapshot has settled result rows farther into the season than the reviewed OpenFootball snapshot. OpenFootball has settled scores through Matchday 11; the corresponding first 11 matchdays contain 164 settled matches.

Therefore the expected cross-source verified intersection is 164 records if both downloaded bytes still match the reviewed Git blob hashes. This is an expected data assertion, not a claimed runtime result in this repository environment.

Those records are enough to make the Gate2 chronological warmup meaningful after early rounds. They do **not** make Gate3 or Gate4 validated because most of these result records do not yet carry verified historical closing market prices.

## Tests

`python scripts/test_cross_source_result_reconciler.py`

The deterministic offline test covers:

- source-A abbreviation normalization;
- source-B score formats;
- UTC/local date difference;
- exact score agreement;
- cross-source provenance preservation;
- Gate1 truth-store conversion;
- Gate2 bridge compatibility;
- score disagreement quarantine;
- missing source result quarantine.

The root verifier includes this offline test. Network source acquisition itself is deliberately excluded from the root verification path.

## Governance

- cross-source agreement before verified historical truth;
- source dates preserved separately;
- source blob changes fail closed;
- no bookmaker odds inferred from results;
- no Gate3/Gate4 statistical-validation claim from result history alone;
- no capital unlock;
- `real_money = NO`.
