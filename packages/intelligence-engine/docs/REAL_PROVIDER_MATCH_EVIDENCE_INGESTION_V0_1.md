# Real Provider Match Evidence Ingestion v0.1

Status: **IMPLEMENTED-ARTIFACT**

This adapter closes the boundary between verified provider evidence packages and the canonical Match Evidence Analysis layer. It adds no parallel feature, model, prediction, or settlement store.

## Flow

    provider evidence package
      -> provider identity and timestamp checks
      -> existing buildMatchEvidenceSnapshot
      -> independent-model firewall
      -> existing analyzeMatchEvidence
      -> existing Gate1–Gate6 pipeline

The accepted provider schema is CANONICAL_PROVIDER_MATCH_EVIDENCE_V0_1. Provider-specific collectors must map their raw payloads into this explicit schema. The adapter does not guess field meanings and never converts season aggregates into invented historical match rows.

## Evidence behavior

A batch fixes provider, source type and capture time. Each event fixes event ID, provider event ID where available, evidence snapshot ID, kickoff, source reference and raw evidence groups.

Missing form, venue, H2H, lineup, injury, rest, xG or market inputs remain empty/null. The existing snapshot builder emits explicit UNKNOWN feature states.

All accepted events use the existing immutable, fingerprinted MatchEvidenceSnapshot. The adapter records an additional SHA-256 fingerprint of the exact provider payload:

- exact replay becomes IDEMPOTENT_REPLAY;
- changed payload with the same event/snapshot identity is rejected;
- one snapshot identity cannot be reused across events.

Manual screenshots remain MANUAL_SCREENSHOT_CAPTURE and cannot self-assert verified provider truth.

## Independent model firewall

Evidence ingestion does not require a model. Without a verified model the state is EVIDENCE_READY_MODEL_PENDING and the decision is ABSTAIN.

Analysis requires all of the following:

- model verified;
- model event matches evidence event;
- independentOfMarket true;
- model version and source reference;
- observed timestamp no later than the evidence snapshot;
- pre-kickoff timestamp;
- valid non-negative home and away lambdas.

An invalid model produces EVIDENCE_READY_MODEL_REJECTED but does not discard a valid evidence snapshot. Odds cannot create or rewrite model lambdas.

## Time and provider boundaries

- Historical match evidence at or after kickoff is rejected.
- Market evidence after snapshot capture is rejected.
- Market observations in one snapshot cannot mix providers or snapshot identities.
- An event-level provider cannot contradict the batch provider.
- Unsupported provider schema versions are rejected explicitly.

## Governance

P002 and Gate1–Gate6 are unchanged. Prediction, validation and execution remain separate. Settlement remains separate and immutable. Capital stays LOCKED, real money stays NO, and the adapter performs no automatic promotion or retuning.
