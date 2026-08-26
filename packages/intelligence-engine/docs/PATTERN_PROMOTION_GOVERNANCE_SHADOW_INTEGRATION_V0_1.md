# Pattern Promotion Governance & Shadow Integration v0.1 — Step 8

## Purpose

Step 8 connects validated Pattern Intelligence evidence to the existing prediction governance system without allowing a pattern to alter the authoritative prediction path.

A Step 7 result may be statistically and behaviorally credible while still having `decision_weight = 0`. Step 8 preserves that distinction. The pattern can only enter a parallel **shadow** calculation after a separate, verified pattern-to-prediction calibration exists.

## Existing-system integration

Step 8 does not replace existing owners:

- `champion-challenger.mjs` remains the champion/challenger comparison owner.
- `governed-learning-loop.mjs` remains the learning-change proposal owner and keeps `autoApply=false` and `productionMutationAllowed=false`.
- `calibrated-intelligence-adjustment.mjs` remains unchanged and is not silently repurposed as Pattern Intelligence calibration.
- Gate1–6, P002, M015 and the authoritative prediction path remain unchanged.

## Why a separate calibration is mandatory

A behavioral effect is not automatically a probability coefficient.

For example, a validated `+20pp` lead-surrender behavioral difference does **not** mean the model probability should move by `+20pp`. Step 8 therefore requires an independent calibration artifact that maps validated pattern activations to bounded logit coefficients.

Calibration requirements:

- verified and independently produced;
- sample N >= 30;
- provenance and version required;
- trained before the shadow plan is created;
- bookmaker odds forbidden as calibration inputs;
- each validated pattern requires an explicit coefficient;
- absolute logit adjustment capped at 0.35;
- absolute probability movement capped at 0.10.

If calibration is missing or invalid, Step 8 remains `SHADOW_PLAN_WAITING_FOR_VALIDATED_PATTERN_OR_CALIBRATION`.

## Shadow prediction boundary

Each shadow prediction keeps both values:

1. authoritative baseline probability;
2. parallel pattern-adjusted shadow probability.

The baseline is never rewritten. Pattern activations require pre-kickoff provenance and may only reference Step 7 validated pattern IDs. Post-kickoff activations are forbidden.

Settlement is a separate post-kickoff record. A settled shadow row contains paired baseline/shadow losses against the same outcome.

## Promotion evidence

Step 8 requires at least **100 settled shadow rows** before governance eligibility can be considered. This is intentionally stricter than the earlier minimum discovery/independent-validation N=30 gates and does not modify P002.

At N >= 100, the shadow challenger must:

- beat champion Brier score;
- beat champion LogLoss;
- avoid ECE degradation greater than 0.01;
- satisfy the existing `compareChallenger()` governance gate, including its verified market-benchmark requirement when used;
- produce a `proposeLearningChange()` result that remains non-auto-applying.

Passing all Step 8 gates yields only:

`ELIGIBLE_FOR_MANUAL_GOVERNANCE_REVIEW_ZERO_WEIGHT`

It does not promote the pattern and does not assign prediction weight.

## Market boundary

Bookmaker/market information is forbidden from the pattern-to-prediction calibration and forbidden from shadow prediction generation.

A verified market benchmark may be attached after predictions for governance comparison because the existing champion/challenger framework already uses market-relative evidence. This does not make the market behavioral truth or a model input.

## Failure behavior

- N < 100: `SHADOW_EVIDENCE_ACCUMULATING`.
- Shadow fails Brier/LogLoss, calibration, or existing champion/challenger gate: `RETAIN_CHAMPION_SHADOW_NOT_PROVEN`.
- Invalid calibration, fingerprints, duplicate settlements, post-kickoff prediction/activation, or unvalidated pattern activation: fail closed.

Rejected or weak shadow evidence is retained; it is not deleted to make the pattern look stronger later.

## Real-evidence honesty

CI uses synthetic fixtures only to verify implementation mechanics. Synthetic rows do not establish a real Pattern Intelligence promotion case.

Current real state remains:

`NOT_RUN_WAITING_FOR_REAL_STEP7_VALIDATION_CALIBRATION_AND_SHADOW_EVIDENCE`

until separate canonical evidence exists.

## Governance

Step 8 keeps:

- `decision_weight = 0`;
- automatic promotion = false;
- automatic retuning = false;
- production mutation = false;
- champion path authoritative = true;
- P002 unchanged;
- Gate1–6 ownership unchanged;
- capital effect = NONE;
- real money = NO.

## Next stage

`STEP_9_PATTERN_SHADOW_FORWARD_MONITORING_AND_PROMOTION_APPROVAL`
