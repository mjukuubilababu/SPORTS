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

Run:

```bash
npm test
```
