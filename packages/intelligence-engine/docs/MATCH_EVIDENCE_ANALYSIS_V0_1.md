# Match Evidence Analysis Layer v0.1

Status: **IMPLEMENTED-ARTIFACT**

This is an additive evidence/feature layer for the existing SPORTS Decision Intelligence system. It does not replace the intelligence engine, model pipeline, SignalSnapshot, settlement, validation, execution, or Gate1–Gate6.

## Canonical flow

    source evidence
      -> immutable MatchEvidenceSnapshot
      -> reproducible evidence features
      -> existing score-distribution and market-mapping engines
      -> confidence/conflict/compatibility analysis
      -> existing evidence gates

The layer cannot activate capital. Its prediction weight is zero, capital effect is NONE, capital remains LOCKED, and real money remains NO.

## MatchEvidenceSnapshot

The buildMatchEvidenceSnapshot function freezes the event identity, kickoff and capture timestamps, source reference, source type, provider, feature/config versions, historical match observations, contextual evidence, market observations, derived feature records, and a SHA-256 fingerprint.

Every derived feature contains source metadata, capture time, aggregate event time, provider, feature version, sample size, confidence, source event identifiers, status, and an explicit fallback when unavailable.

Unknown data remains null with UNKNOWN; it is never silently imputed.

Manual screenshots use MANUAL_SCREENSHOT_CAPTURE. Setting verified true cannot turn an uncorroborated screenshot into provider truth. Only the explicit independentlyVerified state changes its verification status, and manual evidence retains a lower confidence ceiling.

All pre-match capture and historical feature timestamps must precede kickoff. Post-kickoff evidence is rejected. Market observations in one snapshot must share one provider and one snapshot identity.

## Structured features

Versioned recency weights are:

    RECENCY_WEIGHTS_V1 = [1.00, 0.85, 0.70, 0.55, 0.40]

Overall recent form and home/away venue form remain separate. FORM_CONTEXT_WEIGHTS_V1 uses overall 0.40 and venue 0.60; those are configuration, not hidden business-logic constants.

Opponent adjustment uses only provided strength values. Missing strength produces OPPONENT_STRENGTH_UNAVAILABLE; it does not create a neutral rating. The v0.1 transformation rewards goals and points achieved against stronger opponents while scaling goals conceded by opponent strength.

H2H uses exponential time decay with a 730-day half-life and sample confidence that reaches its configured ceiling only at ten observations. Raw H2H never decides the output by itself.

Goal-environment features include means, median, variance, threshold rates, BTTS, clean-sheet and failed-to-score rates. Classification is marked SUPPORTING_EVIDENCE_ONLY.

Time-segment features are emitted only from explicit scoring/conceding minute arrays. Final scores never create minute patterns.

## Model and market reuse

The evidence layer does not hand-write a second prediction model:

- buildBidirectionalMatchReasoning and buildScoreDistribution create the coherent score and market probability distribution.
- mapReasoningToMarketSelection maps only supported markets. Unsupported or unverified-half markets remain explicit.
- recomputeJointSelection derives pair compatibility from canonical score-distribution overlap.
- Existing immutable signal settlement remains separate.

The three-outcome cluster contains a primary, a compatible secondary, and—when available—a safer alternative. A safer alternative must have model probability at least as high as the primary and probability variance no higher than the primary. Bookmaker odds do not define safer.

## Conflict, completeness and confidence

Completeness scores eight explicit evidence groups: recent form, venue split, H2H, market, lineup, injuries, xG, and rest. The result includes the per-group truth table and versioned weights.

Conflict rules detect H2H/recent-goal disagreement, venue/overall disagreement, goals/xG disagreement, model/market disagreement, score outliers, and small H2H samples. Trap flags do not reverse a prediction; they reduce confidence or produce WATCH/ABSTAIN.

Confidence is deterministic and composed from model concentration, sample size, provenance, context completeness and market availability, less conflict and missing-data penalties. Same frozen input plus the same versions produces the same fingerprinted result.

## Governance and boundaries

- P002 is unchanged.
- Gate1 remains the truth owner.
- Gate6 remains the capital owner.
- Prediction is not validation and is not execution.
- Settlement cannot mutate the frozen prediction.
- Pattern discovery/promotion and retuning are not performed.
- The layer may always abstain.
- No accuracy claim is made by this implementation.
