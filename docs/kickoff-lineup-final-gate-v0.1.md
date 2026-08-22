# Kickoff + Confirmed Starting Lineups Final Gate v0.1

This capability performs the last governed pre-match refresh without rewriting earlier market or model snapshots.

## Flow

`baseline real market capture -> independent model -> verified kickoff observation -> confirmed starting XI -> latest multi-bookmaker odds -> optional verified lineup impact -> verified final context -> final 1X2 refresh -> WATCH / REJECTED / QUALIFIED -> immutable FINAL_PREMATCH_DECISION snapshot`

## Kickoff rules

- Kickoff status must come from a verified attributable source.
- `DELAYED` requires a verified later `revisedKickoffAt`.
- `POSTPONED` and `CANCELLED` terminate the final pre-match decision as `REJECTED`.
- Final capture must occur before the effective kickoff time.

## Confirmed lineup rules

- `status=CONFIRMED` is required.
- Source must be verified and attributable.
- Home and away must each contain exactly 11 unique identified starters.
- `confirmedAt` must be before effective kickoff.
- Confirmed XI opens `lineupGate=PASS` but does not automatically change expected-goal lambdas.

## Lambda adjustment policy

A lineup change may alter lambdas only when a separate lineup-impact input is marked `verified=true`, has explicit bounded home/away lambda multipliers, and records provenance/version. Missing or unverified lineup-impact data leaves baseline lambdas unchanged.

## Final context policy

Evidence maturity can change only through a verified final-context assessment with provenance. Confirmed lineups alone do not manufacture a higher evidence score.

## Market refresh

At least two fresh attributable bookmaker snapshots are required. Each provider is canonicalized and de-vigged independently before consensus. A model-vs-market direction conflict or a high-transition large divergence blocks final qualification and leaves the event at `WATCH`.

## Snapshot separation

The final decision is stored as a separate immutable `FINAL_PREMATCH_DECISION` snapshot. Earlier market captures, model outputs, WATCH states, and signal snapshots are never mutated. This preserves no-hindsight evaluation.

## Runner

```bash
node scripts/run_final_prematch_intelligence.mjs \
  packages/intelligence-engine/data/real-market-batch-2026-08-23T001346+0300.json \
  packages/intelligence-engine/data/independent-model-inputs-2026-08-23.json \
  <final-confirmed-lineup-and-odds-capture.json> \
  <optional-output.json>
```

There is intentionally no fabricated default final-capture file. The runner should execute only after genuine confirmed starting lineups and a fresh pre-kickoff odds capture are available.

`realMoney` remains `NO`; capital remains locked.
