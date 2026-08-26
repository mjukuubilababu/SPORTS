# Pattern Confirmatory Out-of-Sample Evaluation v0.1 — Step 6

## Purpose

Step 6 is the first confirmatory evaluation layer for behavioral pattern candidates. It consumes the complete Step 5 frozen family and a verified Step 3 behavioral corpus, but only observations that satisfy the frozen post-freeze/disjoint boundary may contribute to the confirmatory estimand.

Step 6 does **not** create real pattern evidence by itself. Unit tests use synthetic fixtures only. A real result requires a real canonical Step 4 discovery batch, its Step 5 freeze, and real post-freeze disjoint behavioral observations.

## Statistical estimand

For each frozen candidate:

`effect = subject success proportion - disjoint reference success proportion`

The success definition, opportunity definition, team, league, venue context and direction are inherited from the immutable Step 5 plan.

The subject and reference must each satisfy the frozen N=30 gates. Step 6 additionally requires at least 30 independent `canonical_match_id` clusters on each side. This extra cluster gate is conservative and does not weaken P002.

## Match clustering

Reference evidence may contain two team-side observations from the same match. Treating those rows as independent would understate uncertainty. Step 6 therefore uses match-level CR1 cluster-robust variance.

The preregistered v0.1 raw test is:

`ONE_SIDED_MATCH_CLUSTER_ROBUST_SCORE_CR1_NORMAL`

The null variance is centered on the pooled null success rate and aggregated by canonical match cluster. A two-sided 95% cluster-robust normal interval is retained as uncertainty evidence.

## Family-wise error control

The family remains every candidate frozen together in Step 5. No hypothesis may be dropped because its confirmatory result looks inconvenient.

Step 6 spends alpha only when **all** frozen hypotheses satisfy:

- subject match N >= 30;
- subject relevant opportunity N >= 30;
- reference relevant opportunity N >= 30;
- subject independent match cluster N >= 30;
- reference independent match cluster N >= 30.

Until then the family state is `WAITING_FOR_ALL_FROZEN_HYPOTHESES_MIN_N` and no raw p-values are calculated.

When ready, raw one-sided p-values are corrected with Holm-Bonferroni at family-wise alpha 0.05, ordered by raw p-value and then `pattern_id` for deterministic ties.

A different corpus cannot be used to retest the same family after alpha has been spent. Exact repeat use of the same locked result is idempotent.

## Confirmatory pass

A candidate passes Step 6 only when all three are true:

1. the effect repeats in the frozen direction;
2. oriented absolute proportion difference is at least 0.10 (10 percentage points);
3. Holm-Bonferroni rejects the null at family-wise alpha 0.05.

A passing candidate becomes `OUT_OF_SAMPLE_CONFIRMED_PENDING_STABILITY`.

That state is **not** final validation. It remains decision weight 0 and must proceed to temporal/context stability.

## Failure is retained evidence

A failed candidate is not deleted. The result is retained with one of:

- `REJECTED_OOS_DIRECTION_NOT_REPLICATED`;
- `REJECTED_OOS_PRACTICAL_EFFECT_NOT_MET`;
- `REJECTED_OOS_HOLM_SIGNIFICANCE_NOT_MET`.

This preserves the system's own mistakes and failed hypotheses as governed learning evidence without automatically retuning the model.

## Evidence boundaries

Historical and discovery observations may remain in the full corpus. They are retained for audit but cannot contribute to Step 6 if they are pre-freeze or their match IDs were used in Step 4 discovery/reference evidence.

The opponent-side row from a match involving the subject team cannot be counted as independent reference evidence.

Market/bookmaker data remain outside behavioral truth.

## Decision boundary

Even after an OOS pass:

- `patternValidated = false`;
- `decisionWeight = 0`;
- no lambda/probability mutation;
- no automatic signal injection;
- no automatic retuning;
- no automatic promotion;
- capital effect `NONE`;
- real money `NO`.

## Real current status

This implementation does not claim that a real canonical pattern family has already been discovered, frozen, or confirmed. Real execution remains `NOT_RUN_WAITING_FOR_REAL_EVIDENCE` until those artifacts exist.

## Next stage

`STEP_7_PATTERN_TEMPORAL_AND_CONTEXT_STABILITY`
