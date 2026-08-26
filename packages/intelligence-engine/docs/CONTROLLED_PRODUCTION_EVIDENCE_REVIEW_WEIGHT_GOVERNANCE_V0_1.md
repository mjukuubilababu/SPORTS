# Controlled Production Evidence Review & Weight Governance v0.1 — Step 16

## Purpose

Step 16 reviews the first prospective Step 15 production evidence without allowing the evidence review itself to change production weight, replace the champion, retune the model, or unlock capital.

It exists because Step 15 health contains metrics and counts but does not bind the individual settlement fingerprint set. Step 16 therefore introduces a pre-health evidence cohort manifest. Historical Step 15 health that was not preceded by this manifest is intentionally ineligible for weight-governance authorization.

## Required lineage

Step 16 accepts only:

1. an exact valid Step 15 activation;
2. at least 30 prospective Step 15 settlements from that activation;
3. a pre-health cohort manifest frozen after every included settlement and before health evaluation;
4. an exact healthy Step 15 health state;
5. the exact manifest-bound settlement cohort in the exact evaluation order;
6. successful reproduction of the supplied Step 15 health fingerprint from that cohort.

The manifest binds both ordered and set forms of:

- `controlled_production_settlement_fingerprint`;
- `match_id|market_key|selection` identity.

A different cohort with identical Brier, log-loss, ECE, or N is not equivalent evidence.

## Weight boundary

Step 15 initial weight remains bounded at `<= 0.05`.

Step 16 may only authorize a ceiling for a later governed stage:

`next_weight_ceiling = min(current_weight * 2, 0.10)`

Step 16 does **not** apply that new weight. The current Step 15 weight remains active until a separate later activation step.

The inherited maximum absolute probability shift remains `0.02`. Step 16 does not increase this cap.

## Manual decisions

### `AUTHORIZE_NEXT_CONTROLLED_WEIGHT_STAGE_NOT_APPLIED`

Creates a bounded authorization for Step 17. It does not mutate current production weight.

### `HOLD_CURRENT_CONTROLLED_WEIGHT`

Keeps the current Step 15 weight unchanged. A later increase requires a new pre-health manifest and new health review.

### `RETIRE_AND_ROLLBACK_TO_CHAMPION`

Reuses the Step 15 emergency rollback owner with `MANUAL_KILL_SWITCH`, forcing champion-only output, production decision weight `0`, and probability influence `0`. The same Step 15 activation cannot be treated as reauthorized.

## Invariants

- minimum prospective settled N = 30;
- manifest must precede Step 15 health evaluation;
- manifest must follow all included settlements;
- exact health reproduction required;
- same-metric cohort substitution forbidden;
- no automatic weight increase;
- no automatic retuning;
- no champion replacement;
- no capital execution;
- Gate6 remains capital/risk owner;
- P002 remains unchanged;
- real money remains `NO`.

## Evidence firewall

Step 12/13 graduation evidence does not become Step 16 production evidence. Step 16 uses the new manifest-bound Step 15 settlements only. The reviewed evidence is not reused for training or retuning in this step, and no additional alpha is spent.

Synthetic CI fixtures verify implementation behavior only. They do not count as real Step 16 evidence.

Current real status:

`NOT_RUN_WAITING_FOR_REAL_MANIFEST_BOUND_HEALTHY_STEP15_EVIDENCE`

## Next stage

A successful manual authorization points only to:

`STEP_17_STAGED_CONTROLLED_PRODUCTION_WEIGHT_ACTIVATION_AND_MONITORING`

Step 17 must remain separately governed and must not infer capital permission from Step 16.
