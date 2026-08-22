# Independent Real Model Inputs v0.1

This capability joins the immutable real bookmaker capture to a separate, independently sourced football model dataset by `eventId`.

## Model baseline

`PREVIOUS_SEASON_VENUE_POISSON_SHRUNK_V0_1`

Inputs are previous-season home/away goals for and against plus league home/away goal rates. Team venue rates are shrunk toward the league venue average using 5 prior-equivalent matches.

Bookmaker prices are explicitly excluded from lambda construction.

## First real model dataset

Target fixtures: 23 August 2026 EPL opening weekend.

Historical source season: 2025/26.

Venue data: StatBunker Premier League 25/26. Season totals are cross-checked against PremierLeague.com.

League baseline: 580 home goals and 465 away goals over 380 matches, or 1.5263157895 home goals and 1.2236842105 away goals per match.

## Context gate

Opening-weekend manager changes, transfers, injuries and unconfirmed lineups create transition risk. `HIGH` transition risk caps evidence maturity at 65. The minimum qualification threshold remains 70 and the lineup gate must be `PASS`.

Context risk is a reliability gate only. It does not silently rewrite lambdas.

## First joined runtime result

- 3 real events received
- 3 market-ready
- 3 model-verified
- 3 WATCH
- 0 QUALIFIED
- 1 model-vs-market direction conflict
- 1 high-transition large divergence

Manchester City vs AFC Bournemouth baseline: lambda 2.4923 / 1.0024; HOME 69.86%, DRAW 16.90%, AWAY 13.24%; market HOME consensus 63.82%; state WATCH because evidence maturity is 65 and lineup is pending.

Brighton vs Aston Villa baseline: lambda 1.4824 / 1.1161; HOME 45.60%, DRAW 25.88%, AWAY 28.53%; market HOME consensus 42.61%; state WATCH, including edge below +5pp.

Newcastle vs Liverpool baseline: lambda 2.0165 / 1.7996; model HOME 43.70%, DRAW 21.13%, AWAY 35.17%, while the observed bookmaker consensus has AWAY about 50.65%. This is explicitly flagged `MODEL_MARKET_DIRECTION_CONFLICT` and `HIGH_TRANSITION_RISK_LARGE_MARKET_DIVERGENCE`. The system does not auto-retune from this disagreement.

## Commands

From `packages/intelligence-engine`:

```bash
npm run real:model-market
```

To write a report:

```bash
npm run real:model-market:write
```

## Governance

Prediction remains separate from validation and execution. Lineups and context must pass evidence gates before qualification. Capital remains locked and `realMoney` remains `NO`.
