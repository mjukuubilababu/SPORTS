# Transfer Impact Intelligence v0.1

## Purpose

This capability closes the previously pending `TRANSFER_IMPACT` football-intelligence domain without using transfer fees, player reputation, social sentiment or bookmaker prices as football evidence.

It converts a complete, verified pre-match roster-change audit into a normalized transition signal that matches the existing `featureSet.transferImpact` contract consumed by Team & Match Intelligence.

## Evidence model

Every material incoming/outgoing player must have:

- canonical player ID;
- canonical football role(s);
- prior minutes share;
- normalized role-specific capability;
- minimum sample of 8;
- competition-strength adjustment;
- source, observed timestamp and `verified=true`;
- transfer effective at or before the match `asOf` time.

Each team must also have a verified before/after roster reconciliation with `allMaterialMovesCovered=true`.

If the roster audit is incomplete, the domain remains unavailable. Missing transfers are never silently assigned a neutral value.

## Calculation

Incoming contribution uses prior minutes, capability, competition adjustment and deterministic role replacement fit. Outgoing loss uses prior minutes, capability and competition adjustment. A bounded churn penalty captures transition load.

The raw net is transformed into a 0–1 readiness score:

`0.5 + 0.5 * tanh(netRaw)`

0.5 is neutral. Scores above/below 0.5 represent positive/negative verified transition evidence, not predicted goals.

## Role fit

- exact canonical role: `1.00`
- same role family: `0.75`
- unrelated role: `0.40`
- no outgoing vacancy reference: `0.75`

This is an explicit v0.1 heuristic. It remains explanation/intelligence evidence until independently calibrated; it cannot rewrite lambda by itself.

## No-hindsight and fail-closed rules

Evidence observed after `asOf`, transfers effective after `asOf`, roster mismatches, duplicate identities, unverified evidence, insufficient samples and incomplete material-move coverage are rejected.

A player cannot appear as both incoming and outgoing in one team audit.

## Integration

`transferAuditToFeatureSet()` produces the existing fields:

- `homeNetImpact`
- `awayNetImpact`
- `homeIncomingImpact`
- `homeOutgoingLoss`
- `awayIncomingImpact`
- `awayOutgoingLoss`

`deriveTeamMatchSignals()` then activates the existing `TRANSFER_IMPACT` domain under correlation group `SQUAD_TRANSITION`.

## Governance

Transfer fees, reputation scores and bookmaker odds are forbidden. Raw directional transfer intelligence cannot silently modify Poisson/Negative-Binomial lambdas. Any lambda rewrite requires an independently validated calibration layer.

Capital effect: none. Real-money execution remains disabled.
