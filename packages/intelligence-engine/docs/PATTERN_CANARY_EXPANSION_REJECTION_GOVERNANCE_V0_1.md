# Pattern Canary Expansion or Rejection Governance v0.1 — Step 11

## Purpose

Step 11 governs whether a healthy Step 10 Pattern Intelligence canary should remain at its current bounded stage, be approved for a later staged expansion, or be rejected and retired back to champion-only operation.

It does **not** activate the next routing stage and it does **not** authorize capital.

## Why Step 10 N=30 is not enough for expansion

Step 10 uses a minimum of 30 routed settled canary observations to decide whether the first bounded canary is healthy or must roll back. A single healthy N=30 checkpoint is not treated as sufficient evidence for expansion.

Step 11 therefore freezes the exact healthy Step 10 checkpoint and requires a second, disjoint routed cohort:

- initial healthy routed settled N >= 30;
- new confirmation routed settled N >= 30;
- total routed settled N >= 60;
- every confirmation decision must be routed after the checkpoint freeze;
- every confirmation decision must still be routed before kickoff;
- every confirmation settlement must occur after kickoff;
- initial match/market/selection keys cannot be reused;
- the same Step 10 canary authorization must be used.

## Exact checkpoint reproduction

The checkpoint is not created from a status string alone. Step 11 requires the exact Step 10 settlement cohort and re-runs the canonical Step 10 health evaluator. The reproduced health fingerprint must match the supplied healthy Step 10 health artifact.

This protects the expansion decision from a detached or cherry-picked health summary.

## No-hindsight confirmation boundary

A self-consistent fingerprint is not sufficient evidence by itself. Step 11 re-checks temporal causality at its own boundary:

- `routed_at` must be strictly before `kickoff_at`;
- `settled_at` must be strictly after `kickoff_at`;
- evidence cannot be evaluated before its settlement timestamp.

This defense-in-depth rule prevents a forged or reconstructed downstream artifact from bypassing the original pre-match decision boundary.

## Two-cohort robustness requirement

When confirmation evidence is evaluated, Step 11 computes Step 10 health twice:

1. the full initial + confirmation cohort;
2. the new confirmation cohort by itself.

Both must remain healthy before the canary becomes eligible for a manual next-stage decision. An old strong cohort is therefore not allowed to hide a newly degrading cohort.

No additional significance alpha is spent in this robustness stage.

## Governance decisions

A named approver with rationale must choose one of:

- `APPROVE_NEXT_CANARY_STAGE`
- `HOLD_CURRENT_CANARY`
- `REJECT_AND_RETIRE_PATTERN_CANARY`

### Approve

Approval is allowed only when the second cohort and full cohort are healthy. The result is:

`NEXT_CANARY_STAGE_APPROVED_NOT_ACTIVATED`

For v0.1 the next stage may be approved up to 10% routing, while the absolute probability influence cap remains no larger than 2 percentage points.

Step 11 does not activate that 10% stage. Activation belongs to Step 12.

### Hold

A hold is valid while confirmation evidence is still accumulating. It keeps the Step 10 canary at its existing stage and does not increase routing or influence.

A hold is forbidden when current evidence requires rollback.

### Reject

Rejection reuses the existing Step 10 rollback owner. It records a manual kill-switch rollback and produces:

`CANARY_REJECTED_RETIRED_CHAMPION_ONLY`

The routing fraction becomes zero, pattern influence becomes zero, champion-only operation is required, and the same canary authorization cannot be reused for another attempt.

Rejected evidence is retained.

## Risk and ownership boundaries

Step 11 does not replace:

- Step 10 canary activation/health/rollback logic;
- Gate 6 capital and risk ownership;
- P002;
- Gate 1–6 ownership;
- champion/challenger governance.

The canary remains PAPER/RESEARCH only. Production decision weight remains 0. Capital execution remains forbidden. Real money remains `NO`.

## Real evidence honesty

CI uses synthetic fixtures to verify software behavior only. Synthetic rows do not count as real expansion evidence.

Current real status remains:

`NOT_RUN_WAITING_FOR_REAL_STEP10_HEALTHY_CANARY_AND_SECOND_DISJOINT_CANARY_COHORT`

## Next stage

`STEP_12_STAGED_CANARY_EXPANSION_ACTIVATION_AND_MONITORING`
