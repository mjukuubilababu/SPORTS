# Team & Match Intelligence Layer v0.1

## Purpose

This layer analyzes football teams and matchup reality **before bookmaker-market mapping**. It is designed to answer *why* a team may succeed or fail, not only what its historical goal rate was.

## Eleven reasoning domains

1. **Player matchup** — individual player capability against the direct/tactical opponent.
2. **Team cohesion** — collective coordination independent from star quality.
3. **Player quality + cohesion** — teams that combine individual quality with collective performance.
4. **Transfer impact** — incoming/outgoing player impact, role replacement, adaptation and squad continuity.
5. **Attack vs defence** — each attack against the opposing defensive vulnerability, in both directions.
6. **Temporal scoring/defending** — when teams score/concede, plus lead-retention behaviour.
7. **League and club strength** — cross-league and cross-competition strength context.
8. **Shot and chance quality** — shot quality, shots on target and defensive shot vulnerability, not raw shot count alone.
9. **Position/home-away/environment** — league position, venue split, away performance and psychology/environment evidence.
10. **Head-to-head relevance** — H2H is weighted by relevance; old matches with different managers/squads should contribute less.
11. **Match-statistics patterns** — evidence-backed patterns such as late concessions, poor lead retention, high-quality chance creation or press vulnerability.

## Data contract

Upstream football data is normalized to `0..1` before entering this layer. Every signal must carry:

- source;
- observation time;
- verification state;
- confidence;
- sample size;
- correlation group.

Directional signal values use `-1..1`: positive favours the home side, negative favours the away side.

## Double-counting control

The explanation layer preserves every domain. The composite model, however, counts each correlation family only once. For example, xG, shots on target, big chances and attack-vs-defence evidence may all describe the same chance-creation process. They may remain visible for explanation while contributing only once to the composite/calibration path.

## Positive and negative evidence

The engine keeps evidence supporting both sides. Counter-evidence is not discarded. Contradiction pressure reduces reliability when substantial evidence exists in both directions.

Examples of valid negative conclusions include:

- team likely to fail to win;
- team vulnerable to conceding late;
- team poor at protecting leads;
- attack likely to be neutralized by opponent defence.

## Lambda integration

Raw football intelligence **cannot rewrite expected-goal lambdas**. Lambda adjustment requires an independently verified, out-of-sample calibration set with at least 30 observations and explicit domain coefficients. Bookmaker odds are forbidden from creating this calibration.

When a calibration is verified:

- only de-correlated composite groups contribute;
- every contribution is explicit;
- home and away multipliers are capped by default to `0.80..1.20`;
- the baseline model remains recorded separately from the effective model.

Without verified calibration, the intelligence layer still affects decision confidence: partial intelligence prevents a high-probability claim from being labelled `ROBUST_MODEL_TRUTH`.

## Decision flow

`independent team model -> team/match intelligence -> counter evidence + correlation control -> optional calibrated lambda adjustment -> team reality map -> bidirectional match truths -> half reasoning -> market mapping -> price/fair probability/edge -> final canonical gates`

## Runtime

From `packages/intelligence-engine`:

```bash
npm run team:match -- <input.json> [output.json]
```

The input JSON is passed directly to `buildMatchDecisionUniverse` and may include `teamIntelligenceFeatureSet`, `teamIntelligenceSignals`, `teamIntelligenceAsOf`, and an optional verified `intelligenceCalibration`.

## Governance

- Team analysis comes before market selection.
- Unverified/stale evidence contributes zero weight.
- Correlated evidence cannot create artificial confidence.
- Bookmaker prices cannot create football truth or calibration.
- Probability is not value and is not a guarantee.
- Existing lineup, context, evidence and final pre-match gates remain authoritative.
- Capital remains locked; `realMoney = NO`.
