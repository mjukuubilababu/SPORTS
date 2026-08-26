# Staged Pattern Canary Expansion Activation & Monitoring v0.1 — Step 12

## Purpose

Step 12 activates only a manually approved Step 11 canary expansion and monitors the newly expanded routing stage without changing production decisions, Gate6 ownership, frozen P002 rules, or capital state.

This stage is **paper/research only**. It does not claim real-world activation merely because synthetic CI fixtures pass.

## Required lineage

Step 12 requires all of the following:

- a valid Step 10 `CONTROLLED_PATTERN_CANARY_ACTIVE_PAPER_ONLY` authorization;
- a valid Step 11 decision with state `NEXT_CANARY_STAGE_APPROVED_NOT_ACTIVATED`;
- Step 11 decision `APPROVE_NEXT_CANARY_STAGE`;
- the exact Step 10 canary authorization fingerprint referenced by Step 11;
- the same shadow-plan lineage, calibration lineage, deterministic routing method, and routing seed;
- activation strictly after the Step 11 governance decision.

Step 11 approval remains distinct from Step 12 activation.

## Activation boundary

The staged expansion may increase routing from the Step 10 stage (maximum 5%) to at most **10%**. The maximum absolute probability influence remains **±2 percentage points** and may not increase. Champion probabilities are never mutated in place.

Routing remains deterministic using SHA-256 over match/market/selection with the inherited routing seed. Cherry-picking is forbidden. Predictions generated before Step 12 activation are not eligible for Step 12 staged routing, and post-kickoff routing is forbidden.

Each routed decision is classified as:

- `BASE_CANARY_BAND` — deterministic routing value falls below the previous Step 10 threshold;
- `EXPANSION_BAND` — routing value falls inside the newly activated interval between the old and new thresholds;
- `CHAMPION_ONLY` — not routed or rollback is active.

This separation allows the newly added routing band to be evaluated independently rather than hiding its behavior inside aggregate results.

## Monitoring boundary

Step 12 health requires two independent sample gates before the stage can be called healthy:

- at least **30 new staged routed settlements**; and
- at least **30 routed settlements specifically from the expansion band**.

Both the full Step 12 routed cohort and the expansion-band cohort are compared against champion on:

- Brier score;
- log loss;
- expected calibration error (ECE), allowing no more than +0.01 degradation.

The thresholds are frozen. Step 12 spends no additional alpha and performs no automatic retuning.

Before the minimum samples are reached, health remains `STAGED_CANARY_HEALTH_ACCUMULATING_PAPER_ONLY`. Passing both sample gates without degradation produces `STAGED_CANARY_HEALTHY_CONTINUE_PAPER_ONLY`. It does **not** produce production promotion.

## Immediate rollback

The kill switch is armed at activation. Any of the following requires immediate rollback:

- `PROVENANCE_OR_FINGERPRINT_FAILURE`
- `POST_KICKOFF_LEAKAGE`
- `LINEAGE_OR_CALIBRATION_DRIFT`
- `MANUAL_KILL_SWITCH`

After minimum sample size, material Brier/log-loss/ECE degradation in either the full staged cohort or the expansion band also requires rollback.

Rollback state is `STAGED_CANARY_ROLLED_BACK_CHAMPION_ONLY`. The same activation cannot be reactivated. Routing and canary probability influence become zero, and future attempts require a new governed authorization.

## Governance invariants

Step 12 preserves:

- P002 unchanged;
- Gate1–Gate6 ownership unchanged;
- Gate6 as the capital/risk owner;
- production decision weight = 0;
- production mutation = false;
- capital execution = false;
- automatic further expansion = false;
- automatic full promotion = false;
- real money = NO.

## Real-evidence honesty

CI fixtures are synthetic and exist only to verify implementation behavior. They do not count as real Step 12 evidence.

Current real status:

`NOT_RUN_WAITING_FOR_REAL_STEP11_APPROVAL_AND_NEW_STAGED_EXPANSION_EVIDENCE`

## Next governed stage

Only a healthy Step 12 evidence set may proceed to:

`STEP_13_PATTERN_CANARY_GRADUATION_OR_RETIREMENT_GOVERNANCE`

That future stage remains a separate explicit governance decision; Step 12 does not activate it automatically.
