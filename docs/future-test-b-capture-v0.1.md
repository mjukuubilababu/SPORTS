# Future Test B Capture Pipeline v0.1

## Purpose

This capability creates genuine future Test Set B records without hindsight. It is upstream of the blind accumulator. It does not evaluate model performance.

## State machine

`DISCOVERED -> PREMATCH_FROZEN -> CLOSING_MARKET_CAPTURED -> SETTLED_ELIGIBLE -> BLIND_ACCUMULATOR`

### PREMATCH_FROZEN

The system downloads the current MLS UTC fixture export, verifies the pinned 2025 historical sources, uses only settled fixtures whose kickoff precedes the capture timestamp, and computes the target fixture independently from the same settled history.

The frozen prediction contains:

- Gate2 pre-lineup lambda;
- Poisson U3.5 probability;
- preregistered NB2 U3.5 probability;
- immutable snapshot ID and SHA-256;
- model versions and challenger specification hash.

Bookmaker odds are not model inputs.

The regime snapshot is also frozen before kickoff and is sourced independently of results and market prices.

### CLOSING_MARKET_CAPTURED

A market can only be attached if:

- it is captured after or at the model freeze;
- it is captured before kickoff;
- source provenance is present;
- source verification is explicit;
- closing semantics are explicitly verified;
- both O3.5 and U3.5 decimal prices are present.

The fair U3.5 probability is de-vigged from the two-sided market. An ordinary earlier bookmaker snapshot is not silently promoted to a closing quote.

### SETTLED_ELIGIBLE

Settlement is attached only after kickoff with a verified result source. This produces the exact candidate schema consumed by `blind_test_set.py`.

A row does not increment Test B before this state.

## No-hindsight rules

Every target fixture is modeled independently. A future fixture placeholder is never appended to the history used for another future fixture. Results are never read to construct the prediction snapshot. Market odds are excluded from model generation. Prior record hashes are retained as lineage parents through later transitions.

## Initial genuine targets

The first discovery file contains two fixtures that were still future at the time this capability was authored on 2026-08-23:

- New England Revolution vs New York City FC — 2026-08-23T20:30:00Z;
- Atlanta United vs Sporting Kansas City — 2026-08-23T23:00:00Z.

Source: FixtureDownload MLS 2026 UTC schedule. Competition-season regime source: official MLS 2026 regular-season schedule announcement.

No result or closing quote is stored in the discovery file.

## Verification

- `scripts/test_future_test_b_capture.py`
- `scripts/test_future_test_b_transitions.py`
- `scripts/capture_future_test_b_prematch.py`
- dedicated GitHub Actions workflow
- unified repository verifier integration

## Governance

This capability does not change Gate4 N=100, P002 frozen rules, model parameters, or capital state. It exposes no Brier, LogLoss, ROI, EV, edge, calibration or model ranking.
