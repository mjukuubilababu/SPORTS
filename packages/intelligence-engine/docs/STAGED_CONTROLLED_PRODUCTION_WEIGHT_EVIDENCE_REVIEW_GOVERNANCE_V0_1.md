# Staged Controlled Production Weight Evidence Review & Governance v0.1 — Step 18

## Purpose

Step 18 reviews only new prospective evidence produced under one exact Step 17 staged-weight activation. It does not activate another weight, replace the champion, retune the challenger, or unlock capital.

The core protection is a **pre-health Step 17 staged evidence cohort manifest**. Step 17 health summarizes metrics and counts but does not independently bind every staged settlement fingerprint. Step 18 therefore freezes the exact settlement cohort before health evaluation, binds both ordered fingerprints and match/market/selection identities, and reproduces the exact Step 17 health result from that cohort before any manual governance decision can exist.

## Required lineage

Step 18 requires:

- exact `STAGED_CONTROLLED_PRODUCTION_WEIGHT_ACTIVE_CAPITAL_LOCKED` activation;
- exact healthy Step 17 health state `STAGED_CONTROLLED_WEIGHT_HEALTHY_CONTINUE_CAPITAL_LOCKED`;
- Step 17 next stage `STEP_18_STAGED_CONTROLLED_PRODUCTION_WEIGHT_EVIDENCE_REVIEW_AND_GOVERNANCE`;
- a pre-health manifest frozen after every included settlement but before Step 17 health evaluation;
- minimum new prospective settled N = 30;
- exact ordered settlement fingerprints and identity keys;
- exact health reproduction from the manifest-bound cohort;
- no rollback requirement and all Step 17 health gates passing.

Historical Step 17 health without this manifest is deliberately ineligible for Step 18 governance.

## Evidence firewall

The review evidence cannot be reused for training or retuning. Step 16 reviewed evidence does not count as Step 18 evidence. Same-metric cohort substitution is rejected even when Brier, LogLoss and ECE are numerically identical.

## Weight boundary

Step 18 preserves the existing staged discipline:

- maximum governed multiplier per stage: `2x`;
- absolute staged decision-weight maximum: `0.10`;
- next ceiling: `min(current staged weight * 2, 0.10)`;
- maximum absolute probability shift remains `±0.02`;
- probability-shift cap is not increased;
- Step 18 itself applies no weight change.

If the current staged weight is already `0.10`, another weight-increase authorization is invalid. Healthy evidence at the absolute maximum can be held at the current stage or retired, but cannot be used to exceed the established 10% boundary.

## Manual governance decisions

### `AUTHORIZE_NEXT_STAGED_WEIGHT_STAGE_NOT_APPLIED`

Allowed only when the computed next ceiling is strictly above the current staged weight. The authorization does not activate the new weight. It points to `STEP_19_NEXT_STAGED_CONTROLLED_PRODUCTION_WEIGHT_ACTIVATION_AND_MONITORING`.

### `HOLD_CURRENT_STAGED_WEIGHT`

Keeps the exact current staged weight. No increase is authorized. A future increase requires a new pre-health manifest and new healthy evidence review.

### `RETIRE_AND_ROLLBACK_TO_CHAMPION`

Reuses the Step 17 emergency rollback owner with `MANUAL_KILL_SWITCH`. The result is champion-only, decision weight `0`, probability influence `0`, and the same Step 17 activation cannot reactivate.

## Governance invariants

- automatic weight increase: false;
- automatic retuning: false;
- automatic promotion: false;
- champion replacement: false;
- capital execution: false;
- Gate6 capital/risk ownership unchanged;
- P002 unchanged;
- real money: `NO`.

## Real evidence status

CI fixtures are synthetic only and do not count as real Step 18 evidence.

Current real status:

`NOT_RUN_WAITING_FOR_REAL_MANIFEST_BOUND_HEALTHY_STEP17_EVIDENCE`
