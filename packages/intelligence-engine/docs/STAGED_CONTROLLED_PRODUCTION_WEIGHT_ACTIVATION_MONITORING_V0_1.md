# Staged Controlled Production Weight Activation & Monitoring v0.1 — Step 17

## Purpose

Step 17 is the execution of an exact Step 16 manual weight-stage authorization. It may increase the challenger contribution to production prediction output only inside the Step 16 authorized ceiling. It does not replace the champion, authorize capital, retune the model, or spend additional alpha.

## Required lineage

Step 17 requires all of the following exact immutable inputs:

1. the Step 15 base controlled-production activation;
2. the Step 16 pre-health evidence cohort manifest;
3. the Step 16 evidence review that reproduces the manifest-bound Step 15 health result;
4. the Step 16 decision `AUTHORIZE_NEXT_CONTROLLED_WEIGHT_STAGE_NOT_APPLIED`;
5. the exact fingerprints connecting all four objects.

A HOLD or RETIRE decision is not a valid Step 17 activation input.

## Weight boundary

The staged target weight must be strictly greater than the current Step 15 weight and must not exceed the Step 16 authorized ceiling. The absolute staged ceiling is 0.10.

Step 17 does not increase the inherited absolute probability-shift cap. The cap remains ±0.02.

Example:

- current weight: 0.05
- Step 16 authorized ceiling: 0.10
- Step 17 valid target: >0.05 and <=0.10

If the current weight were 0.02 and Step 16 authorized only 0.04, Step 17 cannot jump directly to 0.10.

## Evidence firewall

Step 17 carries the exact Step 16 reviewed match/market/selection key set into the staged activation. Any prediction using one of those reviewed identities is rejected.

This prevents the evidence that justified the weight increase from being reused as evidence for the new weight stage.

New Step 17 prediction evidence must:

- be generated after Step 17 activation;
- be generated before event start;
- settle only after event start;
- be distinct from the Step 16 reviewed evidence cohort.

## Previous-weight counterfactual

Every active Step 17 decision preserves three probabilities:

- champion probability;
- previous-stage probability using the old decision weight;
- staged-production probability using the new decision weight.

This lets monitoring distinguish “challenger versus champion” from the more precise question: “did increasing the weight itself improve or degrade the output?”

## Prospective monitoring

Minimum new staged settled evidence is N>=30.

The staged output must satisfy all of these gates:

- Brier non-degradation versus champion;
- LogLoss non-degradation versus champion;
- ECE no more than +0.01 versus champion;
- Brier non-degradation versus the previous-weight counterfactual;
- LogLoss non-degradation versus the previous-weight counterfactual;
- ECE no more than +0.01 versus the previous-weight counterfactual.

Passing health does not automatically increase the weight again.

## Health states

- `STAGED_CONTROLLED_WEIGHT_HEALTH_ACCUMULATING_CAPITAL_LOCKED`
- `STAGED_CONTROLLED_WEIGHT_HEALTHY_CONTINUE_CAPITAL_LOCKED`
- `STAGED_CONTROLLED_WEIGHT_ROLLBACK_TO_CHAMPION_REQUIRED`

## Emergency rollback

Immediate integrity failures or performance degradation after N>=30 require rollback to:

- champion-only output;
- production decision weight 0 for the rolled-back staged activation;
- probability influence 0;
- no reactivation of the same staged activation without a new governed authorization.

Immediate signals include provenance/fingerprint failure, post-event-start leakage, calibration/lineage drift, observability or kill-path failure, deployment reversibility failure, Gate6 capital-lock violation, Step 16 authorization/review drift, staged-weight boundary violation, and manual kill switch.

## Governance boundary

Step 17 keeps:

- champion replacement: false;
- automatic weight ramp: false;
- automatic retuning: false;
- capital execution: false;
- Gate6 as capital/risk owner;
- P002 unchanged;
- real money: NO.

## Real evidence status

CI uses synthetic fixtures only. They prove implementation behavior but do not count as real Step 17 activation or evidence.

Current real status:

`NOT_RUN_WAITING_FOR_REAL_STEP16_AUTHORIZATION_AND_NEW_STAGED_WEIGHT_EVIDENCE`

## Next governed stage

Healthy new prospective staged evidence may proceed only to:

`STEP_18_STAGED_CONTROLLED_PRODUCTION_WEIGHT_EVIDENCE_REVIEW_AND_GOVERNANCE`
