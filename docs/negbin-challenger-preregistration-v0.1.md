# Negative Binomial Challenger Preregistration v0.1

This challenger tests one specific hypothesis without changing the existing team-strength mean model: football total-goal counts may be more dispersed than a Poisson distribution assumes.

## Model

- Target: Under 3.5 regulation-time goals.
- Mean `mu`: existing Gate2 `pre_lineup_lambda`, unchanged.
- Distribution: NB2, with variance `mu + mu^2/r`.
- Probability: sum the NB2 PMF for goal totals 0, 1, 2 and 3.
- Fitted parameter: global dispersion `r`.

## Training isolation

`r` is estimated by maximum likelihood using only cross-source-verified MLS 2025 matches for which Gate2 can form a chronological pre-lineup lambda. Current-match outcomes are not used when forming their Gate2 features.

Bookmaker odds are not model inputs. The 25-match 2026 Holdout A dataset and every canonical match ID in that holdout are forbidden from training and tuning.

## Why Holdout A is not evaluated

Holdout A has already been inspected and showed that the market beat the current Poisson model on Brier and LogLoss. Evaluating this newly designed challenger on the same 25 rows would contaminate the model-development process. This implementation therefore trains and preregisters the challenger but deliberately does not calculate its Holdout A Brier, LogLoss, ROI, edge performance or ranking.

## Preregistration sequence

1. CI reproduces the pinned 2025 training corpus.
2. CI fits `r` with the locked MLE algorithm and outputs a training artifact.
3. The fitted parameter, complete specification hash, training dataset ID and training match IDs are frozen into a preregistration artifact.
4. Final CI reproduces training and verifies that the preregistered specification is unchanged.
5. Only a new, disjoint Test Set B captured after preregistration may evaluate this challenger for promotion.

Existing Gate4 promotion rules remain unchanged, including minimum N=100, Brier, LogLoss, walk-forward and regime-consistency requirements. Capital remains locked; `realMoney: NO`.
