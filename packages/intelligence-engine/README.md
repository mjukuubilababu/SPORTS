# Intelligence Engine Consolidation & Governed Learning Loop v0.1

Explicit intelligence subsystem for the canonical Decision Intelligence system.

It consolidates approved reusable intelligence from the preserved v0.4.3 research workbook while keeping failed/unvalidated challengers at zero decision weight.

## Match Outcome 1X2 + Live State v0.1

The engine now includes a league-agnostic football match-outcome capability for:

- pre-match `HOME_WIN / DRAW / AWAY_WIN` probabilities from home/away expected-goal lambdas;
- immutable pre-match snapshots for no-hindsight evaluation;
- separate live probability snapshots based on verified current score, elapsed time, and explicit evidence-driven rate multipliers;
- final-result settlement with `CORRECT / INCORRECT` attribution;
- multiclass Brier Score and Log Loss;
- confusion-matrix and per-class evaluation, including draw precision/recall.

Live observations never rewrite the frozen pre-match prediction. Live modifiers are explicit inputs and are not silently inferred from unverified match events. This capability does not unlock capital or real-money execution.

Implementation:

- `src/outcome-1x2.mjs`
- `src/live-outcome.mjs`
- `src/outcome-settlement.mjs`
- `src/outcome-evaluation.mjs`
- `tests/outcome-1x2.test.mjs`

## Multi-Bookmaker Market Intelligence v0.1

Provider-agnostic odds intelligence is added with an initial Tanzania-facing registry for betPawa, SportPesa, MBet, Parimatch, and SokaBet. The registry does not imply that a private or public feed is authorized or available: ingestion remains blocked until the endpoint and terms are explicitly verified.

Capabilities:

- normalize decimal odds and de-vig each provider independently before cross-provider comparison;
- compare the same event and same market across multiple bookmakers with a bounded timestamp skew;
- compute source-weighted market consensus, provider overround, fair-probability dispersion, and best available price by selection;
- produce evidence-backed hypotheses for bookmaker differences without claiming unobserved internal intent;
- build historical bookmaker profiles for average overround, consensus deviation, selection bias, disagreement rate, and outcome Brier score when settlement exists;
- build at most one or two governed paper-only combination sets from already-qualified, positive-edge, positive-EV, evidence-mature, independence-verified legs;
- preserve `realMoney: NO` and prohibit auto-execution.

Acquisition policy permits only verified official APIs, licensed data vendors, approved public-web sources, or controlled manual capture. Private endpoint reverse engineering and credential bypass are forbidden.

Implementation:

- `src/bookmaker-registry.mjs`
- `src/bookmaker-comparison.mjs`
- `src/bookmaker-learning.mjs`
- `src/paper-combination.mjs`
- `tests/multi-bookmaker.test.mjs`
- `contracts/multi-bookmaker-market-intelligence-v0.1.json`

Run:

```bash
npm test
```
