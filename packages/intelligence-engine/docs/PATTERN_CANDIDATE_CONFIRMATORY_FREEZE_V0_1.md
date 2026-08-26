# Pattern Candidate Confirmatory Freeze v0.1 — Step 5

## Purpose

Step 5 freezes the exact Step 4 candidate set before any confirmatory testing. It exists to stop hindsight, candidate cherry-picking, hypothesis rewriting, direction flipping, metric changes, and reuse of discovery evidence as independent confirmation.

Step 5 does **not** validate a pattern, calculate confirmatory p-values, alter model probability, assign predictive weight, retune a model, or unlock execution.

## Input

A valid `PATTERN_DISCOVERY_CANDIDATES_V0_1` discovery batch from Step 4.

The source batch must pass its existing fingerprint and governance validator. Every source candidate must remain in `CANDIDATE` state with decision weight 0.

## Whole-batch freeze

The runtime freezes every candidate in the Step 4 batch in deterministic `pattern_id` order.

Manual subset selection is deliberately unsupported. This means a human or later process cannot inspect the discovery batch and freeze only the most attractive candidate.

The frozen candidate fingerprint set must exactly equal the source Step 4 candidate fingerprint set.

## Frozen definition

For each candidate Step 5 freezes:

- pattern ID and candidate fingerprint;
- hypothesis;
- pattern class;
- success definition;
- opportunity definition;
- discovery direction;
- feature definition;
- subject team, league and venue context;
- discovery training cutoff;
- discovery effect estimate and uncertainty;
- source discovery fingerprint.

Any later mutation makes the Step 5 fingerprint invalid.

## Independent evidence boundary

Confirmatory evidence starts on the next UTC calendar date after `frozen_at`.

Every Step 4 subject and reference match ID used to discover the candidate is explicitly forbidden from confirmatory evidence. The Step 5 classifier separates new Step 3 observations into:

- `SUBJECT` — observation for the frozen subject team;
- `REFERENCE` — same-scope observation not involving the subject team;
- `EXCLUDED_DIRECT_SUBJECT_MATCH_COUNTERPART` — opponent-side row from a subject match, which may not leak into the independent reference baseline.

Pre-freeze-date observations and reused discovery match IDs are ineligible.

## Confirmatory sample gates

Step 5 preregisters but does not execute these gates:

- subject match N >= 30;
- subject metric opportunity N >= 30;
- reference metric opportunity N >= 30;
- minimum practical absolute effect = 0.10 (10 percentage points);
- same metric success/opportunity definitions as Step 4;
- same league and venue context;
- discovery direction frozen.

The N=30 values preserve the existing P002 minimums and do not weaken Gate3/Gate4 requirements.

## Multiple testing

The confirmatory family is all Step 4 candidates frozen in the batch.

Step 5 preregisters:

- family-wise alpha = 0.05;
- correction = Holm-Bonferroni;
- raw p-values sorted ascending with `pattern_id` as deterministic tiebreak;
- Step 4 exploratory comparison count retained.

No alpha is spent and no significance test is run in Step 5.

## Existing intelligence integration

A frozen confirmatory plan can be represented in the existing `EvidenceGraph`, but the node has:

- `patternValidated=false`;
- `verified=false`;
- `decisionWeight=0`;
- `decisionEligible=false`.

The governed-learning loop remains non-mutating.

## Governance

Step 5 preserves:

- PREDICTION != VALIDATION != EXECUTION;
- Step 4 discovery != confirmation;
- P002 unchanged;
- Gate1-Gate6 ownership unchanged;
- market/bookmaker data not used as behavioral truth;
- automatic retuning disabled;
- automatic promotion disabled;
- capital effect `NONE`;
- real money `NO`.

## Definition of done

Step 5 is complete when the contract, runtime, tests, documentation and dedicated CI exist and the exact-head regression comparison shows no new intelligence-engine failure names.

The next stage is `STEP_6_PATTERN_CONFIRMATORY_OUT_OF_SAMPLE_EVALUATION`, where the frozen plan may be applied to genuinely disjoint evidence. Step 6 must not change the Step 5 hypothesis or evidence boundary.
