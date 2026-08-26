# Pattern Shadow Forward Monitoring & Promotion Approval v0.1 — Step 9

## Purpose

Step 9 sits after Step 8 shadow challenger eligibility. It does **not** activate a pattern in production. It freezes the exact Step 8 evidence cohort, requires a new forward-only cohort, monitors whether the shadow advantage survives, and records an explicit governance decision about whether a controlled canary may be implemented in the next stage.

## Why Step 8 evidence is not enough

Step 8 may reach `ELIGIBLE_FOR_MANUAL_GOVERNANCE_REVIEW_ZERO_WEIGHT` after at least 100 settled shadow rows. Those rows are consumed evidence. Step 9 forbids reusing them as forward monitoring evidence.

A Step 9 promotion dossier therefore freezes:

- the exact Step 8 evaluation fingerprint;
- the exact Step 8 settlement fingerprints;
- the exact Step 8 match/market/selection keys;
- the champion and shadow metrics at review time;
- the monitoring and rollback policy.

The dossier itself remains decision weight 0.

## New forward evidence boundary

Every Step 9 observation must originate from a shadow prediction generated **after** the dossier freeze and **before** kickoff. Settlement remains post-kickoff. The settlement must point back to the exact shadow prediction fingerprint.

A match/market/selection key consumed by Step 8 cannot enter Step 9 again.

The minimum new forward settled sample is 30, aligned with P002 independent validation minimum N. This is an additional cohort; it does not replace or reinterpret the Step 8 N=100 shadow requirement.

Synthetic CI fixtures only test mechanics and never count toward real football validation.

## Forward monitoring gates

After N >= 30 new rows, all of the following must hold:

1. Shadow Brier is better than champion Brier overall.
2. Shadow LogLoss is better than champion LogLoss overall.
3. Shadow ECE does not degrade by more than 0.01.
4. Verified market CLV is present for every row and mean CLV is positive.
5. Both chronological halves are non-degraded on Brier and LogLoss.
6. No additional significance-test alpha is spent in Step 9.

If N < 30, state is `FORWARD_MONITORING_ACCUMULATING_ZERO_WEIGHT`.

If N >= 30 but one or more gates fail, state is `FORWARD_MONITORING_DEGRADED_RETAIN_SHADOW_ZERO_WEIGHT`.

Only a fully passing cohort may reach `ELIGIBLE_FOR_EXPLICIT_CONTROLLED_CANARY_APPROVAL_ZERO_WEIGHT`.

## Explicit approval is not activation

Step 9 accepts only two governance decisions:

- `APPROVE_CONTROLLED_CANARY`
- `REJECT_OR_CONTINUE_SHADOW`

Approval requires a named approver, a rationale, and a decision timestamp after the forward evaluation.

Even an approved record becomes only:

`CONTROLLED_CANARY_APPROVED_NOT_ACTIVATED_ZERO_WEIGHT`

It does not change model weights, probabilities, lambda, production routing, capital state, or the authoritative champion output.

## Pre-registered rollback policy

Before any future canary activation, the dossier records rollback-to-champion triggers for:

- provenance or fingerprint failure;
- post-kickoff leakage;
- Brier degradation;
- LogLoss degradation;
- ECE degradation above 0.01;
- calibration or pattern-lineage drift.

Step 10 must enforce these controls if controlled canary activation is implemented.

## Existing-system integration

Step 9 extends, rather than replaces:

- `pattern-promotion-shadow-integration.mjs` from Step 8;
- `champion-challenger.mjs`;
- `governed-learning-loop.mjs`.

Gate1–6 ownership is unchanged. P002 is unchanged. The champion remains authoritative throughout Step 9.

## Real evidence status

Implementation and CI do not claim that a real football pattern has passed this stage.

Current real status remains:

`NOT_RUN_WAITING_FOR_REAL_STEP8_ELIGIBILITY_AND_NEW_FORWARD_SHADOW_EVIDENCE`

until real canonical Step 8 eligibility exists and a genuinely new forward cohort is accumulated.

## Next stage

`STEP_10_CONTROLLED_PATTERN_CANARY_ACTIVATION_AND_ROLLBACK_ENFORCEMENT`
