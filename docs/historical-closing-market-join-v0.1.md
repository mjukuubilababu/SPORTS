# Historical Closing-Market Join v0.1

## Purpose

Join verified historical match identities from the canonical Gate1 truth store to historical closing goal-market observations without using the final score to manufacture or select odds.

The target flow is:

`cross-source verified result history → canonical match ID → closing market join → Gate2 chronological features + same-match de-vig market probability`

This is the bridge required before Gate3 can receive a real settled prediction corpus.

## Source semantics

The supported v0.1 market source is a Footiqo public Odds export/manual CSV for USA MLS. Footiqo describes the Odds view as historical **closing odds** sourced from **1xBet**, including Over/Under 2.5 and 3.5 goals.

No private endpoint discovery or reverse engineering is part of this capability.

## Parser and joiner

`packages/gate1/historical_market_join.py`

Key functions:

- `parse_footiqo_odds_csv()`
- `join_historical_markets()`

The CSV parser accepts Footiqo-style column names such as:

- `matchDate`
- `Season`
- `homeTeam`
- `awayTeam`
- `O25`
- `U25`
- `O35`
- `U35`

The join requires:

- same season;
- normalized home/away pair;
- source date within ±1 day of the canonical date.

The final match score is deliberately not part of market matching.

If multiple equally close observations disagree on closing odds, the record is quarantined with `CONFLICTING_CLOSING_MARKET_OBSERVATIONS` and the existing truth record remains without a joined market.

## Two different eligibility concepts

### `market_join_eligible`

This means the closing source passed Gate1 source acceptance and the target O3.5/U3.5 pair is available. Gate2 may de-vig that same-match target line and compare it with a model probability.

### `gate1_validation_n_eligible`

This remains stricter. It also requires the frozen P002 price gate, including O2.5 and the U3.5 range. Therefore a valid historical closing quote can help model-vs-market backfill without being counted as a P002 qualifying observation.

The two states must never be treated as synonyms.

## Runner

```bash
cd packages/gate1
python join_historical_markets.py \
  /tmp/mls-2025-truth-store.json \
  /path/to/footiqo-mls-odds-export.csv \
  /tmp/mls-2025-truth-with-market.json
```

Then:

```bash
cd packages/gate2
python run_canonical_backfill.py \
  /tmp/mls-2025-truth-with-market.json \
  /tmp/mls-2025-gate2-backfill-with-market.json
```

## Test

`python scripts/test_historical_closing_market_join.py`

The offline deterministic test uses real Footiqo-format 2026 values already observed in the public MLS odds table and verifies:

- date +1 matching;
- provider/closing provenance;
- O3.5/U3.5 market availability;
- strict P002 validation-N separation;
- Gate2 market-probability compatibility;
- fail-closed conflicting closing observations.

The test is included in the root verifier.

## Current limitation

The join capability is implemented, but the repository does not yet contain a full 2025 Footiqo odds export joined to the 164-record cross-source result corpus. Until that historical closing-market corpus is physically captured and processed, Gate3/Gate4 statistical validation remains incomplete.

No capital unlock is implied. `real_money = NO`.
