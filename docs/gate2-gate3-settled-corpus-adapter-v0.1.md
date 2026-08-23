# Gate2 → Gate3 Settled Corpus Adapter v0.1

## Purpose

Remove manual copying of `model_prob`, `market_prob` and settlement outcome between the real historical Gate2 backfill and Gate3 statistical validation.

The adapter joins by canonical `match_id`:

`Gate1 truth store + Gate2 feature/model backfill → settlement adapter → Gate3 research report + strict P002 validation report`

## Identity preservation

`packages/gate2/canonical_backfill.py` now adds `match_id`, `season` and `league` to each serialized feature row. It does **not** add the final score or settlement outcome to the feature snapshot.

This keeps prediction-time features separate from hindsight settlement information while giving Gate3 a deterministic join key.

## Adapter

`packages/gate3/canonical_settlement_adapter.py`

A row is **research eligible** when all three exist:

- model U3.5 probability;
- same-match de-vig U3.5 market probability;
- verified final result.

Research eligibility is not P002 qualification.

A row is **strict P002 qualified** only when research eligibility is present **and**:

- Gate1 `validation_n_eligible=true`;
- Gate2 `final_model_gate=PASS`.

Therefore historical rows with missing lineup evidence remain outside the strict validation sample.

## Two reports

`evaluate_settled_corpus()` produces:

1. `research_model_market_report` — model-vs-market calibration/score research on model+market+result-ready rows. Promotion is explicitly forbidden from this report.
2. `strict_p002_validation_report` — uses the existing Gate3 qualified-only semantics.

`promotion_readiness()` runs only on the strict report.

The existing Gate3 `evaluate()` implementation and its default filtering behavior are unchanged.

## Price and CLV policy

A historical U3.5 closing quote may be used as a **closing reference price** for descriptive flat P/L research. It is not claimed to be an execution entry price.

Because no distinct earlier entry price exists in this path, `closing_odds=None` is passed to Gate3 and CLV remains unavailable. The adapter never sets entry=closing merely to manufacture a zero CLV observation.

This means strict promotion remains blocked by the existing CLV requirement until a real entry-price capture is available.

## Runner

```bash
cd packages/gate3
python run_canonical_validation.py \
  /tmp/mls-truth-with-market.json \
  /tmp/mls-gate2-backfill.json \
  /tmp/mls-gate3-validation.json
```

## Test

`python scripts/test_gate2_gate3_settled_corpus.py`

The test verifies:

- Gate2 preserves `match_id` but not final score;
- model+market+result-ready rows enter research scope;
- unknown/failed strict gates do not enter strict validation N;
- U3.5 settlement is derived from the separate truth store;
- CLV is not fabricated;
- research report cannot promote;
- strict promotion remains blocked at insufficient N and absent CLV.

The root verifier includes the integration test.

## Remaining empirical work

The adapter closes the software handoff. Gate3 still needs a physically captured historical market corpus large enough to create real model+market rows, plus historical strict gate evidence and distinct entry/closing price observations if CLV is required for promotion.

No capital unlock is implied. `real_money = NO`.
