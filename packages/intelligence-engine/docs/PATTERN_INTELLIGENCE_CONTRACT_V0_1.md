# Pattern Intelligence Contract v0.1 — Step 0 Architecture Freeze

## Status

`ARCHITECTURE_FROZEN_SPEC_ONLY`

This step defines the constitutional contract for future Pattern Intelligence work. It does **not** implement pattern mining, behavioral fingerprints, similarity search, portfolio construction, or automatic learning.

## Why this layer exists

The canonical system must learn from the full football record, not only from successful predictions or winning teams. A loss, draw, win, correct prediction, and incorrect prediction are all valid observations of reality. They may differ in relevance, reliability, freshness, or uncertainty, but they are not deleted because they are inconvenient.

The purpose of Pattern Intelligence is to convert retained, provenance-backed observations into testable behavioral hypotheses while preserving the existing separation:

`PREDICTION != VALIDATION != EXECUTION`

## Existing system remains authoritative

Pattern Intelligence is additive. It does not replace the current owners:

- Gate1 remains owner of truth and provenance.
- Gate2 remains owner of feature/model backfill.
- Gate3 remains owner of statistical validation.
- Gate4 remains owner of robustness and champion/challenger governance.
- Gate5 remains owner of immutable forward signal freeze and settlement.
- Gate6 remains owner of capital/execution risk.
- `packages/intelligence-engine` remains the reusable reasoning/learning subsystem.
- `contracts/p002-frozen-rules.json` remains independently frozen and is not modified by this contract.

Existing intelligence components such as evidence graph, error taxonomy, confidence budget, governed learning loop, bidirectional reasoning, bookmaker learning, and champion/challenger logic are reused rather than duplicated.

## Non-destructive construction rule

For this program of work:

1. Existing files, packages, models, gates, contracts, evidence, and historical rows are preserved by default.
2. No existing artifact is deleted or replaced without explicit user approval.
3. If a future Pattern Intelligence requirement conflicts with an existing canonical artifact, the conflict must be surfaced before destructive or replacement action.
4. Silent conflict resolution is forbidden.

Step 0 itself is additive-only.

## Core observation principle

> Every retained observation may matter; not every observation has equal evidence weight.

A canonical observation must carry provenance and time semantics. For pre-match influence, `available_at` must be at or before the prediction cutoff. Post-match information can inform future matches and error analysis, but can never rewrite the frozen prediction that preceded it.

Outcome status must not drive truth retention. The system keeps:

- wins,
- draws,
- losses,
- successful predictions,
- failed predictions,
- validated patterns,
- rejected patterns.

## Pattern is a hypothesis before it is evidence

A pattern begins as a discovered hypothesis. Discovery is not proof.

Frozen lifecycle:

`DISCOVERED -> CANDIDATE -> MIN_N_MET -> OUT_OF_SAMPLE_TESTED -> FORWARD_TESTING -> STABLE -> VALIDATED`

A pattern can be rejected at any pre-validation stage. A validated pattern can later be retired. Direct shortcuts such as `DISCOVERED -> VALIDATED` are forbidden.

Until independent validation and separate governed approval, a pattern has decision weight `0`.

## Pattern classes reserved by the contract

The architecture reserves support for:

- team behavior,
- player behavior,
- lineup combinations,
- opponent interactions,
- game-state behavior,
- time-segment behavior,
- tactical matchup,
- environment/context,
- similarity clusters,
- system-error patterns,
- market disagreement,
- cross-market dependencies.

These are reserved categories, not claims that the implementation already exists.

## Behavioral fingerprints

Step 3 will eventually build time-aware team/player fingerprints. Reserved dimensions include attack, defence, tempo, first/second-half behavior, lead protection, comeback behavior, scoring/conceding timing, shot quality, chance creation, transitions, fatigue/rest, travel, lineup strength, and late-game volatility.

A fingerprint must be contextual and opponent-aware. A historical value that became available after a target prediction cutoff cannot influence that target.

## Error memory

Incorrect predictions are first-class learning evidence. Future Step 9 must link a settled error to the exact frozen prediction, model version, feature version, patterns used, expected probability, actual result, settlement, and error category.

A single error cannot trigger retuning. Repeated error structures may become pattern hypotheses, but those hypotheses must pass the same validation lifecycle as football behavior patterns.

## Market boundary

Bookmaker information may support benchmark, disagreement, calibration research, closing-line context, and later governed portfolio context. It must not silently become independent model truth or leak into a model whose contract excludes market inputs.

Same-provider/timestamp requirements and existing provenance rules remain authoritative.

## Pattern hallucination defence

A large feature space will always produce attractive accidental correlations. Therefore Pattern Intelligence requires:

- sample size recording,
- effect size and uncertainty,
- discovery/confirmatory separation,
- frozen feature definition before confirmatory testing,
- multiple-testing/data-snooping recording,
- out-of-sample testing,
- prospective forward testing,
- temporal stability,
- retention of failed patterns.

Narrative plausibility alone cannot promote a pattern.

## Multi-market and future bundle boundary

Future market mapping can cover 1X2, BTTS, totals, team totals, draw-no-bet, double chance, first-half result, and first-team-to-score families.

A future bundle/portfolio engine may not count correlated legs as independent evidence. Dependency adjustment must exist before combination-level confidence claims are permitted. Portfolio construction cannot bypass individual market validation.

## Step 0 Definition of Done

Step 0 is complete only when all of these are true:

- machine-readable contract exists;
- this architecture note exists;
- validator/test exists and passes;
- dedicated CI exists and passes;
- zero existing artifacts were deleted;
- zero canonical owners were replaced;
- P002 remains unchanged;
- no runtime pattern miner is falsely claimed as implemented.

The only next stage after Step 0 is **Step 1: Canonical Match Memory**.
