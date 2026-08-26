# Pattern Temporal & Context Stability v0.1 — Step 7

## Purpose

Step 7 asks a narrower question than Step 6:

> After a frozen pattern has survived confirmatory out-of-sample testing, does the effect remain directionally and practically stable across time and the context that the candidate claims to cover?

Step 7 is a robustness/validation layer. It is **not** a new discovery search and it does **not** spend additional statistical alpha.

## Inputs

Step 7 consumes only:

- the verified Step 4 discovery batch;
- the verified Step 5 confirmatory freeze;
- the verified Step 6 evaluation;
- the exact Step 3 behavioral corpus fingerprint used by Step 6.

A different corpus is rejected. This prevents post-OOS sample substitution after seeing the Step 6 result.

## Eligibility

A candidate is stability-assessed only when Step 6 produced:

`OUT_OF_SAMPLE_CONFIRMED_PENDING_STABILITY`

Step 6 failures remain rejected evidence and are not reopened. Step 6 waiting candidates remain waiting.

## Temporal stability

Subject opportunity-bearing match clusters are sorted chronologically and deterministically split into three contiguous windows:

1. EARLY
2. MIDDLE
3. LATE

No outcome-dependent boundary selection is allowed.

Each window requires at least:

- 10 subject opportunities;
- 10 reference opportunities;
- 10 subject match clusters;
- 10 reference match clusters.

The frozen Step 5 direction must hold in every ready window. In addition:

- minimum oriented effect in every window: 5 percentage points;
- median oriented effect across windows: at least 10 percentage points;
- maximum range between the strongest and weakest oriented window effect: 20 percentage points.

These are deterministic robustness gates. No new p-values are calculated and no additional alpha is spent.

## Venue context

For a Step 4 candidate whose frozen venue context is `ALL`, Step 7 separately checks HOME and AWAY slices. Both must have sufficient coverage, preserve the frozen direction, and retain at least a 5pp oriented effect.

For a candidate frozen as `HOME` or `AWAY`, Step 7 may validate the evidence only inside that frozen scope. It explicitly does **not** claim cross-venue generalization.

## Opponent diversity

A pattern must not be driven by a tiny set of repeated opponents. Subject opportunity clusters require:

- at least 10 unique opponents;
- no single opponent contributing more than 20% of subject opportunity clusters.

Opponent HHI and leading concentration are retained as diagnostics.

## Season context

Season slices are reported when present. A season slice becomes testable at 5 subject and 5 reference opportunity clusters. Cross-season generalization is claimed only when at least two seasons are testable and the frozen direction is consistent in each.

A single-season pattern may still become validated evidence **within its observed scope**, but carries the explicit limitation:

`CROSS_SEASON_GENERALIZATION_NOT_ESTABLISHED`

## Lifecycle outcomes

Possible Step 7 outcomes include:

- `VALIDATED_PATTERN_EVIDENCE_ZERO_WEIGHT`
- `INSUFFICIENT_STABILITY_COVERAGE_RETAIN_OOS_PASS`
- `REJECTED_TEMPORAL_STABILITY`
- `REJECTED_VENUE_CONTEXT_STABILITY`
- `REJECTED_OPPONENT_DIVERSITY_STABILITY`
- `REJECTED_CROSS_SEASON_DIRECTION_STABILITY`
- `NOT_ELIGIBLE_STEP6_OOS_REJECTED`

Rejected or insufficient evidence is retained. Nothing is deleted because it failed.

## What "validated" means here

`VALIDATED_PATTERN_EVIDENCE_ZERO_WEIGHT` means the evidence has survived discovery governance, preregistration, disjoint OOS confirmation, and Step 7 stability checks.

It does **not** mean:

- production promotion;
- automatic model retuning;
- probability or lambda mutation;
- capital authorization;
- real-money execution.

Decision weight remains exactly `0`.

## Real-evidence honesty

The Step 7 unit tests use synthetic fixtures only to verify implementation behavior. Synthetic fixtures do not establish a real football pattern. Until a real canonical Step 6 OOS pass exists, the real operational status remains:

`NOT_RUN_WAITING_FOR_REAL_STEP6_OOS_PASS`

## Next stage

The next stage is:

`STEP_8_PATTERN_PROMOTION_GOVERNANCE_AND_SHADOW_INTEGRATION`

Step 8 may decide whether validated evidence is allowed into shadow/challenger evaluation. Step 7 itself never assigns predictive weight.
