# Gate3 → Gate4 Real Robustness Adapter v0.1

This capability consumes the real Gate3 research report produced by the historical pipeline and evaluates the incumbent market probability against the current Poisson U3.5 model.

It intentionally does **not** invent Negative Binomial or ensemble probabilities. Those challengers remain unavailable until independently generated predictions exist.

## Promotion policy

The market remains incumbent unless all required conditions pass:

- research N >= 100;
- Poisson beats market on Brier;
- Poisson beats market on LogLoss;
- walk-forward win rate >= 60%;
- verified regime-consistency evidence exists.

A descriptive leader is diagnostic only and is not a promoted champion.

For the current real research sample, N is below the Gate4 threshold and the market already leads Poisson on Brier and LogLoss. Therefore the expected state is `BLOCK_PROMOTION`.

## Commands

```bash
python scripts/test_gate3_gate4_real_robustness.py
python packages/gate4/run_canonical_robustness.py \
  artifacts/real-2026-historical-research-report.json \
  artifacts/real-gate4-robustness-report.json
```

## Governance

- no challenger probability fabrication;
- no regime inference from outcome, odds or date;
- no retuning on the evaluation sample;
- Gate4 minimum N remains 100;
- research findings do not unlock capital;
- `real_money = NO`.
