# Evaluation Freeze & Challenger Protocol v0.1

## Why this exists

The first real MLS model-vs-market research benchmark has already been observed. Its 25 match outcomes and metrics therefore cannot be treated as unseen validation data again.

The verified benchmark is frozen as **Holdout A**:

- dataset: `MLS-2025-WARMUP-PLUS-2026-FOOTIQO-CLOSING-RESEARCH-V0.1`
- research N: 25
- strict P002 N: 0
- result: market beat the current model on both Brier and LogLoss
- promotion effect: none

The freeze prevents a common evaluation failure: changing a model after inspecting Holdout A and then claiming improved performance on the same matches as independent validation.

## Holdout A

Canonical freeze artifact:

`packages/gate4/data/mls-2026-evaluation-holdout-a-v0.1.json`

It records the verified workflow run, artifact digest, source reference blob SHA, exact 25 canonical match IDs, headline metrics, freeze timestamp and a deterministic fingerprint.

Rules:

1. Holdout A cannot be training or tuning data.
2. Any of its 25 matches are forbidden from challenger training.
3. Holdout A cannot be reused for promotion.
4. The existing result may be used diagnostically to identify failure classes, but any change motivated by those diagnostics must be evaluated on new unseen data.

## Challenger preregistration

Before a challenger can see a new evaluation set, register:

- challenger ID;
- model version;
- complete model specification hash;
- training dataset IDs;
- training match IDs where available;
- training cutoff;
- registration timestamp.

If the specification changes after registration, the original registration no longer matches and a new challenger/version must be registered.

## Test Set B

A promotion-capable Test Set B must:

- be captured after challenger preregistration;
- have explicit canonical match IDs;
- be disjoint from all frozen Holdout A match IDs;
- not reuse the frozen dataset/freezer ID;
- remain subject to existing Gate4 champion/challenger requirements.

This protocol does **not** lower Gate4's existing `challenger_decision()` defaults. In particular the current Gate4 default `min_n=100`, Brier, LogLoss, walk-forward and regime consistency requirements remain intact.

## What the protocol does not do

It does not train a challenger, choose hyperparameters, alter P002, bypass historical lineup requirements, invent missing closing odds, create CLV, or unlock capital.

## Current empirical state

Holdout A is an evaluation already used. The current model underperformed the market on that 25-match research sample, and N=25 is below the frozen independent-validation minimum N=30. No retuning claim can be validated on Holdout A.

The next empirical evaluation requires a separately preregistered challenger and genuinely new, disjoint market/result observations.

Capital remains `LOCKED`; `realMoney: NO`.
