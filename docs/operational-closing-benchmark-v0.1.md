# Operational Closing Benchmark v0.1

## Why this exists

A public bookmaker or odds-comparison page normally shows a current quote, not a source-declared final closing price. Test B therefore needs a deterministic market benchmark that can be captured before kickoff without retrospectively choosing the most favorable time.

This policy is effective from **2026-08-23T17:00:00Z**, before any operational-close row is accepted.

## Definition

`OPERATIONAL_PREKICKOFF_CLOSE_300S_V0_1` is the last accepted system observation in the fixed interval:

`[kickoff - 300 seconds, kickoff)`

It is an **operational pre-kickoff closing benchmark**, not a claim that the provider or exchange has published its literal final closing tick.

## Source rules

An observation is valid only when:

- it comes directly from a public bookmaker, or an approved public aggregator that attributes both sides to one named provider;
- O3.5 and U3.5 come from the same provider;
- both decimal prices are greater than 1.0;
- source URL and provider are stored;
- the raw observation is hashed with SHA-256;
- the observation is captured no earlier than five minutes before kickoff and strictly before kickoff.

Best O3.5 from provider A plus best U3.5 from provider B is not a market pair and is rejected.

## No hindsight

The prediction and regime snapshot must already be frozen before this market observation. The market benchmark cannot be backfilled after kickoff under this semantics ID. Settlement remains a separate later transition.

The market snapshot hash commits to the operational semantics ID and the hash of the raw observed evidence. The upstream record retains its parent hash.

## Relationship to true closing sources

A source that explicitly and independently supplies a true historical closing quote may use a separate source-declared semantics ID. This v0.1 policy does not silently treat ordinary current prices as provider-declared true closes.

## Test B

The market capture itself does not evaluate Poisson, Negative Binomial, edge, ROI, Brier or LogLoss. Once a verified settlement exists, the record may proceed to the blind Test B accumulator. Interim Test B performance remains hidden until the frozen cohort reaches N=100.

## Governance

No P002 frozen rule, Gate4 minimum N, model coefficient or capital state is changed. `realMoney` remains `NO`.
