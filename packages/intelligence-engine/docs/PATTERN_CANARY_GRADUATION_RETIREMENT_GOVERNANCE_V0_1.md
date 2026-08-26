# Pattern Canary Graduation or Retirement Governance v0.1 — Step 13

## Purpose

Step 13 governs what happens after a Step 12 staged Pattern Intelligence canary becomes healthy. It does not automatically promote the pattern to production and it does not replace the champion. It first requires a cryptographically bound Step 12 settlement cohort, then freezes a reproducible graduation dossier, then requires an explicit manual lifecycle decision.

## Why Step 13 adds a pre-health cohort manifest

Step 12 health fingerprints bind counts and aggregate health metrics, but they do not contain the settlement fingerprint set. Two different cohorts with identical metrics could therefore reproduce the same Step 12 health fingerprint.

Step 13 closes that gap without modifying Step 12. Before Step 12 health is evaluated, the exact settlement cohort intended for graduation must be frozen into a Step 13 cohort manifest containing:

- the Step 12 activation fingerprint;
- every staged settlement fingerprint;
- every match/market/selection key;
- full-stage N;
- expansion-band N;
- a manifest timestamp after all included settlements.

The manifest must exist no later than the Step 12 health evaluation. A cohort substitution with identical metrics is rejected because its settlement fingerprint set no longer matches the manifest.

Historical Step 12 health evidence that was never bound by this manifest does not qualify for Step 13 graduation. That is intentional fail-closed behavior.

## Required lineage

Step 13 requires the exact chain:

1. Step 10 controlled canary authorization.
2. Step 11 `APPROVE_NEXT_CANARY_STAGE` decision.
3. Step 12 staged expansion activation created from that exact Step 10/11 lineage.
4. Step 13 pre-health cohort manifest for the exact Step 12 settlement set.
5. Step 12 health state `STAGED_CANARY_HEALTHY_CONTINUE_PAPER_ONLY` evaluated from that same bound cohort.
6. A Step 13 graduation dossier frozen after the Step 12 health evaluation.

Shadow-plan fingerprint, calibration lineage, deterministic routing method, and routing seed must remain unchanged.

## Evidence requirements

A graduation dossier can be frozen only when:

- Step 12 full-stage routed settled N >= 30;
- Step 12 expansion-band routed settled N >= 30;
- every Step 12 health gate passes;
- rollback is false;
- the settlement fingerprint set exactly matches the pre-health manifest;
- the match/market/selection key set exactly matches the manifest;
- the supplied cohort reproduces the Step 12 health fingerprint;
- the dossier is frozen after the Step 12 health evaluation.

The dossier stores the bound settlement fingerprint set, full-stage and expansion-band metrics, Step 10–12 lineage fingerprints, calibration lineage, routing lineage, and approved pattern IDs. Later evidence cannot rewrite the frozen dossier.

## Manual decisions

Exactly one governed decision is recorded:

- `GRADUATE_TO_ZERO_WEIGHT_CHALLENGER_CANDIDATE`
- `HOLD_STAGED_CANARY`
- `RETIRE_PATTERN_CANARY`

### Graduate

Graduation creates only a zero-weight challenger candidate. It explicitly does **not**:

- activate production;
- replace the champion;
- authorize capital;
- increase routing;
- increase the probability-influence cap;
- perform automatic retuning.

A future explicit promotion authorization and production safety review is still required.

### Hold

Hold permits the existing Step 12 staged canary to continue collecting evidence under the same bounded Step 12 authorization. Step 13 cannot increase the 10% routing cap or the ±2pp influence cap. A later graduation decision requires a newly captured pre-health cohort manifest and a new graduation dossier.

### Retire

Retirement reuses the Step 12 rollback owner with a manual kill switch and forces:

- champion-only routing;
- routing fraction 0;
- canary influence 0;
- no reactivation of the same Step 12 activation;
- retention of historical evidence.

A future attempt requires a new governed lineage.

## Frozen governance preserved

- P002 unchanged.
- Gate1–Gate6 ownership unchanged.
- Gate6 remains capital/risk owner.
- Production decision weight remains 0.
- Champion replacement remains unauthorized.
- Capital effect remains `NONE`.
- Real money remains `NO`.

## Real-evidence honesty

CI uses synthetic fixtures only. Synthetic rows do not count as real graduation evidence. Existing historical Step 12 health rows without a pre-health cohort manifest are deliberately ineligible for graduation.

Current real status:

`NOT_RUN_WAITING_FOR_NEW_REAL_HEALTHY_STEP12_EVIDENCE_WITH_PRE_HEALTH_COHORT_MANIFEST`

## Next governed stage after graduation

`STEP_14_ZERO_WEIGHT_CHALLENGER_PROMOTION_AUTHORIZATION_AND_PRODUCTION_SAFETY_REVIEW`
