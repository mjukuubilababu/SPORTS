# Pattern Discovery Candidates v0.1 — Step 4

## Purpose

Step 4 is the first stage allowed to label a recurring behavioral difference as a **pattern candidate**. It does not validate the pattern, change model probability, alter lambda, inject a Team Match Intelligence signal, retune a model, promote a challenger, or unlock execution.

The source is the verified `BEHAVIORAL_STATE_FEATURES_V0_1` corpus created in Step 3. Step 4 consumes the per-team-side observations rather than trusting a narrative summary.

## Frozen candidate language

The v0.1 discovery language is finite and declared before confirmatory testing:

1. `LEAD_SURRENDER_RATE`
2. `POINTS_DROPPED_AFTER_LEADING_RATE`
3. `EQUALIZE_AFTER_TRAILING_RATE`
4. `WIN_AFTER_TRAILING_RATE`
5. `COMEBACK_GO_AHEAD_RATE`
6. `LATE_GOAL_SCORED_MATCH_RATE`
7. `LATE_GOAL_CONCEDED_MATCH_RATE`
8. `OPENING_GOAL_SCORED_SHARE`

Each family is evaluated for `ALL`, `HOME`, and `AWAY` contexts. Step 4 does not invent arbitrary combinations after seeing outcomes.

## Reference baseline

A subject-team rate is compared with observations that are:

- from the same league,
- from the same venue context,
- from other teams,
- and from match IDs that do **not** include the subject team.

Therefore the opponent-side row from a direct subject match cannot quietly enter the reference baseline.

## Denominators

The P002 discovery minimum remains 30. Step 4 requires all of the following before a candidate may exist:

- subject match N >= 30,
- subject metric opportunity N >= 30,
- reference metric opportunity N >= 30.

For example, 30 team matches are not enough to discover `WIN_AFTER_TRAILING_RATE` if the team trailed in only 12 of those matches. The opportunity denominator is the relevant evidence denominator.

## Exploratory screen

The v0.1 screen is prospectively frozen at:

- absolute subject-vs-reference difference >= 0.10,
- conservative Newcombe/Wilson 95% difference interval must not cross zero.

This is an exploratory candidate screen, not a confirmatory significance claim. It does not weaken P002 and it does not replace Gate3/Gate4 validation.

## Multiple testing

Every batch records the number of exploratory comparisons, candidate families, and context scopes. Step 4 spends no confirmatory alpha and uses no p-value as validation proof. A selected discovery row cannot later be reused as independent confirmatory evidence.

## No hindsight

Each batch freezes:

- `training_cutoff`,
- `discovered_at`,
- exact subject discovery match IDs,
- exact reference match IDs,
- source observation fingerprints,
- candidate-definition fingerprint,
- evaluation fingerprints,
- candidate fingerprints,
- batch fingerprint.

Observations after the training cutoff may remain in the source corpus but are excluded from the discovery calculation.

## Lifecycle

A qualifying Step 4 artifact is created only as:

`CANDIDATE`

It may not jump to `VALIDATED`. Its confirmatory fields remain:

- `out_of_sample_result = NOT_RUN_STEP_4`
- `forward_result = NOT_RUN_STEP_4`
- `temporal_stability = NOT_TESTED_STEP_4`

Step 5 must freeze the candidate definition and confirmatory boundary before any transition toward `MIN_N_MET` / out-of-sample testing.

## Existing intelligence integration

A candidate may be represented as an `EvidenceGraph` node so the existing intelligence system can see that the research artifact exists. The node is deliberately:

- `sourceVerified = true`
- `patternValidated = false`
- `verified = false`
- `decisionWeight = 0`

Therefore `EvidenceGraph.decisionEligible()` remains false.

The future bridge target remains the existing `TEMPORAL_SCORING_DEFENDING` intelligence domain. Step 4 does not inject an impact score into that domain.

## Governance invariants

Step 4 preserves:

- Gate1–6 ownership,
- P002 unchanged,
- prediction / validation / execution separation,
- no market or bookmaker truth leakage,
- no automatic retuning,
- no automatic pattern promotion,
- no automatic production mutation,
- capital effect `NONE`,
- real money `NO`.

## Next stage

`STEP_5_PATTERN_CANDIDATE_CONFIRMATORY_FREEZE`

The next stage should preregister the candidate definition, frozen discovery lineage, disjoint holdout/forward evidence boundary, confirmatory multiple-testing control, and failure criteria before testing any candidate for stability.
