# Controlled Pattern Canary Activation & Rollback v0.1 — Step 10

## Purpose

Step 10 converts a Step 9 controlled-canary approval into a tightly bounded **PAPER/RESEARCH-only canary**. It does not authorize real-money execution, does not replace Gate6, and does not fully promote a pattern.

The controlled canary exists to answer one question safely:

> Does the already validated and forward-approved pattern contribution remain useful when it is allowed to influence a very small deterministic slice of paper/research predictions under an immediate champion fallback?

## Mandatory evidence chain

Activation requires all of the following, and all fingerprints must agree:

1. Step 9 approval state `CONTROLLED_CANARY_APPROVED_NOT_ACTIVATED_ZERO_WEIGHT`.
2. Exact Step 9 forward evaluation in state `ELIGIBLE_FOR_EXPLICIT_CONTROLLED_CANARY_APPROVAL_ZERO_WEIGHT`.
3. At least 30 Step 9 forward settled observations with every preregistered Step 9 gate passing.
4. Exact Step 9 promotion dossier.
5. Exact Step 8 settlement cohort locked by that dossier, with at least 100 settled rows.
6. Exact Step 8 shadow predictions that produced those settlements.
7. Every Step 8 shadow prediction must reference the same shadow-plan fingerprint that Step 10 proposes to use.

This closes the lineage boundary. A new calibration or different pattern set cannot be substituted after governance approval.

## Canary scope

The canary is deliberately smaller than the Step 8 shadow envelope:

- allowed channels: `PAPER`, `RESEARCH` only;
- maximum routed prediction-unit fraction: **5%**;
- routing is deterministic SHA-256 of match/market/selection plus immutable authorization seed;
- cherry-picking routed matches is forbidden;
- maximum absolute probability influence: **2 percentage points**;
- the champion probability is preserved and recorded separately;
- Gate6 capital execution remains forbidden;
- real money remains `NO`.

Step 8 may create a larger shadow delta, but Step 10 clips the applied canary delta to ±2pp.

## Routing semantics

For every eligible shadow prediction, Step 10 deterministically produces one of:

- `CANARY_APPLIED_PAPER_ONLY`
- `CHAMPION_FALLBACK_NOT_ROUTED`
- `CHAMPION_FALLBACK_CANARY_ROLLED_BACK`

The same authorization + match + market + selection always gives the same routing decision. This prevents manual selection of favorable fixtures.

Only routed canary decisions count toward canary health evidence. Unrouted champion fallbacks cannot dilute canary metrics.

## No hindsight

Both the Step 8 shadow prediction and Step 10 routing must occur before kickoff. Settlement is separate and must occur after kickoff.

A post-kickoff routing attempt fails closed.

## Health monitoring

A routed canary cohort remains observational until at least **30 settled routed units** exist. At N ≥ 30:

- canary Brier must not be worse than champion Brier;
- canary LogLoss must not be worse than champion LogLoss;
- canary ECE may not degrade by more than 1 percentage point.

No additional significance alpha is spent in Step 10.

A healthy state is only:

`CANARY_HEALTHY_CONTINUE_PAPER_ONLY`

It is **not** full promotion.

## Immediate rollback

The kill switch is armed at activation. These signals require immediate rollback without waiting for N=30:

- `PROVENANCE_OR_FINGERPRINT_FAILURE`
- `POST_KICKOFF_LEAKAGE`
- `LINEAGE_OR_CALIBRATION_DRIFT`
- `MANUAL_KILL_SWITCH`

After N=30, Brier/LogLoss degradation or ECE degradation above the cap also requires rollback.

Rollback produces:

`CANARY_ROLLED_BACK_CHAMPION_ONLY`

and enforces:

- routing fraction = 0;
- canary probability influence = 0;
- champion only;
- the same authorization cannot be reactivated;
- a new governed authorization is required for any future canary.

## Existing-system integration

Step 10 reuses rather than replaces:

- Step 8 shadow plan and shadow predictions;
- Step 9 dossier, forward evaluation, and explicit approval;
- Gate6 as canonical Capital & Risk owner.

Gate6 already owns capital modes, stake/exposure caps, drawdown controls, and evidence-gated capital promotion. Step 10 does not duplicate those controls.

## Governance locks

- P002 unchanged.
- Gate1–6 ownership unchanged.
- production decision weight = 0.
- production mutation = false.
- automatic full promotion = false.
- automatic retuning = false.
- capital effect = `NONE`.
- real money = `NO`.

## Real-evidence honesty

CI synthetic fixtures test mechanics only. They do not count as real canary evidence and do not prove any football pattern is safe for canary activation.

Current real status:

`NOT_RUN_WAITING_FOR_REAL_STEP9_APPROVAL_AND_CONTROLLED_CANARY_EVIDENCE`

## Next stage

`STEP_11_PATTERN_CANARY_EXPANSION_OR_REJECTION_GOVERNANCE`

Step 11 may decide whether a healthy paper canary remains capped, expands under a new governed envelope, or is rejected/retired. Step 10 itself cannot expand exposure or unlock capital.
