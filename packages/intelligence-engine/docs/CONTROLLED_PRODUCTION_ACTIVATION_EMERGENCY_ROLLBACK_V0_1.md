# Controlled Production Activation & Emergency Rollback v0.1 — Step 15

## Purpose

Step 15 is the first layer allowed to give the graduated Pattern Intelligence challenger a non-zero influence on production **prediction output**. It does not authorize capital execution, real-money use, champion replacement, automatic ramping, or automatic retuning.

The separation remains:

`PREDICTION != VALIDATION != EXECUTION`

A production prediction may change while Gate6 capital authority remains locked.

## Required lineage

Step 15 accepts only an exact Step 14 result with:

- safety review state `ZERO_WEIGHT_CHALLENGER_PRODUCTION_SAFETY_REVIEW_PASS_NOT_ACTIVATED`;
- every Step 14 production-safety control passing;
- authorization decision `APPROVE_FOR_CONTROLLED_PRODUCTION_ACTIVATION_NOT_ACTIVATED`;
- authorization state `ZERO_WEIGHT_CHALLENGER_APPROVED_FOR_CONTROLLED_PRODUCTION_ACTIVATION_NOT_ACTIVATED`;
- exact safety-review fingerprint lineage;
- candidate weight still equal to zero before Step 15 activation;
- Gate6 capital lock preserved.

HOLD or REJECT from Step 14 cannot activate Step 15.

## Initial activation boundary

The first controlled production activation is deliberately small:

- production decision weight must be `> 0` and `<= 0.05`;
- maximum absolute probability shift remains `0.02`;
- champion remains the primary fallback;
- champion replacement is false;
- capital execution is false;
- real money is `NO`;
- deployment reference is mandatory;
- kill-switch reference is mandatory;
- kill switch is armed before the activation exists;
- automatic weight ramp is false;
- automatic retuning is false.

The 5% decision-weight ceiling is a Step 15 safety cap. It does not modify P002.

## Prediction mutation

For a pre-event prediction:

1. Start with the champion probability.
2. Compute challenger minus champion.
3. Multiply that delta by the Step 15 decision weight.
4. Clamp the resulting probability shift to `[-0.02, +0.02]`.
5. Apply only that bounded shift to the champion probability.

The prediction must be generated after Step 15 activation and strictly before event start. Post-event-start mutation is rejected.

If an emergency rollback record is present, output is champion-only with weight `0` and probability influence `0`.

## Prospective evidence

Step 12/13 graduation evidence is not relabeled as new Step 15 evidence. New prospective Step 15 settlements are required.

Health evaluation uses the frozen P002 independent-validation minimum `N=30` and compares controlled production output against the champion on:

- Brier score non-degradation;
- log-loss non-degradation;
- ECE degradation no worse than `+0.01`.

Before N=30 the state is accumulating. Passing N=30 permits only continued bounded production influence; it does not increase weight automatically and does not unlock capital.

Healthy evidence points to:

`STEP_16_CONTROLLED_PRODUCTION_EVIDENCE_REVIEW_AND_WEIGHT_GOVERNANCE`

## Emergency rollback

Immediate rollback signals are:

- `PROVENANCE_OR_FINGERPRINT_FAILURE`
- `POST_EVENT_START_LEAKAGE`
- `CALIBRATION_OR_LINEAGE_DRIFT`
- `OBSERVABILITY_OR_KILL_PATH_FAILURE`
- `DEPLOYMENT_REVERSIBILITY_FAILURE`
- `GATE6_CAPITAL_LOCK_VIOLATION`
- `MANUAL_KILL_SWITCH`

After minimum N, statistically degraded Step 15 health also requires rollback.

Rollback is fail-closed:

- target: champion only;
- production decision weight: `0`;
- probability influence: `0`;
- same activation cannot be treated as reauthorized;
- future activation requires a new governed authorization path.

## Real-evidence honesty

CI fixtures are synthetic implementation checks. They are not real Step 14 approvals, real Step 15 activations, or real production evidence.

Current real status:

`NOT_RUN_WAITING_FOR_REAL_STEP14_APPROVAL_AND_PROSPECTIVE_CONTROLLED_PRODUCTION_EVIDENCE`

## Frozen governance preserved

Step 15 does not change:

- P002;
- Gate1–Gate6 ownership;
- Gate6 capital authority;
- champion replacement authority;
- real-money status.

Capital effect remains `NONE`; real money remains `NO`.
