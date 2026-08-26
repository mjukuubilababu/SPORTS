# Pattern Canary Graduation or Retirement Governance v0.1 — Step 13

## Purpose

Step 13 governs what happens after a Step 12 staged Pattern Intelligence canary has become healthy. It does not automatically promote the pattern to production and it does not replace the champion. It freezes reproducible Step 12 evidence, then requires an explicit manual lifecycle decision.

## Required lineage

Step 13 requires the exact chain:

1. Step 10 controlled canary authorization.
2. Step 11 `APPROVE_NEXT_CANARY_STAGE` decision.
3. Step 12 staged expansion activation created from that exact Step 10/11 lineage.
4. Step 12 health state `STAGED_CANARY_HEALTHY_CONTINUE_PAPER_ONLY`.
5. The exact Step 12 settlement cohort that reproduces the supplied Step 12 health fingerprint.

Shadow-plan fingerprint, calibration lineage, deterministic routing method, and routing seed must remain unchanged.

## Evidence freeze

A graduation dossier can be frozen only when:

- Step 12 full-stage routed settled N >= 30;
- Step 12 expansion-band routed settled N >= 30;
- every Step 12 health gate passes;
- rollback is false;
- the exact settlement cohort reproduces the exact Step 12 health fingerprint;
- the dossier is frozen after the Step 12 health evaluation.

The dossier stores the settlement fingerprint set, the full-stage and expansion-band metrics, the Step 10–12 lineage fingerprints, calibration lineage, routing lineage, and approved pattern IDs. Later evidence cannot rewrite the frozen dossier.

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

Hold permits the existing Step 12 staged canary to continue collecting evidence under the same bounded Step 12 authorization. Step 13 cannot increase the 10% routing cap or the ±2pp influence cap. A later graduation decision requires a newly frozen dossier rather than mutating the old dossier.

### Retire

Retirement reuses the Step 12 rollback owner with a manual kill switch and forces:

- champion-only routing;
- routing fraction 0;
- canary influence 0;
- no reactivation of the same Step 12 activation;
- retention of the historical evidence.

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

CI uses synthetic fixtures only. Synthetic rows do not count as real graduation evidence. Implementation completeness must not be described as a real-world graduation result.

Current real status:

`NOT_RUN_WAITING_FOR_REAL_HEALTHY_STEP12_STAGED_CANARY_EVIDENCE`

## Next governed stage after graduation

`STEP_14_ZERO_WEIGHT_CHALLENGER_PROMOTION_AUTHORIZATION_AND_PRODUCTION_SAFETY_REVIEW`
