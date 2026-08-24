# M014 Preregistration v0.1

Model ID: `M014`

Purpose: test whether improving total-goals mean estimation can improve U3.5 probability quality while leaving the probability distribution Poisson.

Fixed before first empirical M014 execution:

- Minimum hierarchical training matches: `30`
- Team partial-pooling pseudo-count: `5`
- Gate2 / hierarchical lambda blend: `50% / 50%`
- Distribution: `Poisson`
- Team strength scope: venue-specific attack and defence
- Market odds/probabilities: benchmark-only; never model input
- Walk-forward: date-batched; only strictly earlier verified scorelines may train a prediction
- Same-date outcomes: appended only after all predictions for that date
- Exact Gate1/Gate2 team identity required; mismatch fails closed
- Existing consumed market-evaluable rows: `DEVELOPMENT_DIAGNOSTIC` only
- Independent validation count from consumed rows: `0`
- Model state: `PAPER_ONLY`
- Decision weight: `0`
- No automatic promotion, capital unlock, API/UI/live change, contract change, frozen-rule change, or gate-order change

This file records the fixed experimental design and must not be edited in response to the first observed empirical M014 result.
