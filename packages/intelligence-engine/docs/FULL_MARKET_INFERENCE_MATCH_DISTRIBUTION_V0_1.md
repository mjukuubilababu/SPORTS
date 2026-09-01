# Full-Market Inference & Match Distribution v0.1

Status: `IMPLEMENTED-ARTIFACT`

This additive orchestration layer reuses the canonical intelligence engine. It does not replace Gate1–Gate6, P002, team intelligence, score-distribution reasoning, market mapping, SignalSnapshot, settlement, validation, calibration or execution-risk ownership.

## Direction

`FOOTBALL EVIDENCE -> INDEPENDENT TEAM STATES -> MATCHUP AUDIT -> MATCH DISTRIBUTION -> MARKET MAPPING -> DE-VIGGED MARKET INTERPRETATION -> CONTRADICTIONS -> EVIDENCE-GATED RANK/ABSTAIN`

Bookmaker price is evidence, never the prediction. The model derives all supported probabilities from the same score distribution. A market without a legitimate distribution/event model is returned as `UNSUPPORTED`.

## Added capabilities

- Independent time-aware team states with explicit previous-season prior, current-season weight, low-N penalty, XI confidence, missing values and state uncertainty.
- Quality separation: player quality, team quality, cohesion and tactical quality remain distinct.
- Explicit matchup audit concepts. Possession quality is not treated as control.
- Exhaustive, mutually exclusive match worlds whose probability mass sums to one.
- Complete-market de-vigging with immutable observation history.
- Related-market contradiction objects that provide hypotheses without anthropomorphizing bookmaker intent or declaring an automatic trap.
- Deterministic tiered candidates using model probability, fair market probability, edge, completeness, XI state, uncertainty and contradiction pressure.
- Exact same-match joint probability from the score matrix; independent multiplication is not used.
- Component-level settlement that keeps SYSTEM_SIGNAL separate from USER_EXECUTION.

## Boundaries

Half markets require the existing verified half model. Corners, cards and player-event markets remain unsupported without specialized models. Candidate output still requires the existing canonical evidence gates before SignalSnapshot freeze. Prediction weight is 0, capital effect is NONE and real money is NO.

The implementation and CI fixtures establish software mechanics only. They do not establish calibration, validation, execution readiness or real football performance.
