# Blind Future Test Set B Accumulator v0.1

## Purpose

Holdout A has already been observed and is permanently unavailable for model tuning or promotion. The Negative Binomial challenger is now preregistered but unevaluated. Test Set B must therefore be genuinely future, disjoint, and accumulated without interim performance peeking.

This module creates that accumulation boundary.

## Target

The target is **100 promotion-eligible matches**, matching the existing Gate4 default minimum N=100. The target cannot be lowered by this v0.1 accumulator.

The first 100 eligible matches in chronological kickoff order form Test Set B. Eligible rows after the first 100 are not added to B; they are reserved for a later cohort.

## Candidate requirements

Each completed candidate must connect four independently auditable pieces:

1. **Pre-match prediction snapshot**
   - immutable snapshot ID and SHA256;
   - frozen after challenger preregistration and before kickoff;
   - Poisson baseline probability;
   - preregistered NB probability using the exact locked model/specification hash;
   - bookmaker odds cannot be model inputs.

2. **Closing market snapshot**
   - immutable snapshot ID and SHA256;
   - observed after preregistration and before kickoff;
   - verified source/provenance;
   - verified closing semantics;
   - same-market de-vig fair U3.5 probability.

3. **Pre-match regime snapshot**
   - immutable snapshot ID and SHA256;
   - verified before kickoff;
   - independent provenance;
   - cannot be derived from match outcome or bookmaker odds.

4. **Settlement**
   - verified result source and URL;
   - settlement timestamp after kickoff;
   - final home/away goals.

Holdout A match IDs and duplicate matches fail closed.

## No-peek behavior

Until N=100, analyst-facing output contains only:

- accumulator state;
- received count;
- eligible count;
- remaining count;
- rejected count;
- rejection-reason counts;
- data-quality/governance status.

It deliberately does **not** expose aggregate Brier, LogLoss, hit rate, ROI, profit, EV, edge, calibration, champion/leader, win rate or model ranking.

This is procedural blinding, not cryptographic encryption. Full internal records must exist for audit and eventual evaluation, but inspecting settled row-level records for model-tuning decisions would contaminate Test Set B and must be treated as a governance violation.

## Freeze

Once 100 eligible settled matches exist, `freeze_test_set_b()` selects the first 100 chronologically and freezes:

- exact canonical match IDs;
- SHA256 of every complete candidate record;
- challenger model version/specification hash;
- deterministic cohort fingerprint.

The freeze can occur only after all selected rows have settled.

This module intentionally does **not** evaluate the frozen cohort. A separate future one-time evaluation release must consume the frozen cohort without changing the preregistered model.

## Operational runner

```bash
python scripts/run_blind_future_test_b.py candidate-file-1.json candidate-file-2.json
```

Candidate files may be a JSON list or `{ "records": [...] }`.

The runner writes:

- an internal auditable accumulator artifact;
- a separate analyst-facing public status artifact.

If the target has been reached, a freeze may be explicitly requested with both `--freeze-id` and `--frozen-at`. The runner still does not calculate performance metrics.

## Current state

The canonical state begins at N=0. No future Test Set B rows are fabricated in the repository. Genuine future market, prediction, regime and settlement evidence must be accumulated after the challenger registration time.

Existing Gate4 thresholds and frozen P002 rules are unchanged. Capital remains `LOCKED`; `realMoney: NO`.
