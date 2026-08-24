# Real-Time Live Provider Runtime Activation v0.1

## Purpose

Provides the controlled production-style verification path for the documented API-Football provider boundary already merged in canonical.

The workflow is manual (`workflow_dispatch`) because it requires the private `APISPORTS_KEY` credential and must not run on pull requests or expose the credential to untrusted code.

## Credential policy

`APISPORTS_KEY` must exist only as a GitHub Actions secret. It is injected into the provider request as a request header by the existing Gate1 runner. It is never written into source code, artifact JSON, request URLs or audit output.

## What a successful run proves

A successful canonical workflow run proves that the configured credential can authenticate against the documented provider endpoint, that the provider response can be parsed into the canonical sanitized artifact, and that repository assurance remains `PROMOTE` with capital `LOCKED`.

The sanitized artifact verifier also requires each `live_model_input` to match exactly one `LIVE_IN_PLAY` provider snapshot by canonical event ID, elapsed minute, home/away score, observation timestamp and verified provider provenance hash. Snapshot observation timestamps must match the artifact observation timestamp, and canonical fixture IDs must match the provider fixture and competition identity. Mixed or cross-wired live inputs fail closed.

The run writes an attestation containing the GitHub run ID, commit SHA, provider observation timestamp and row counts.

## Zero-live semantics

The provider may legitimately return zero live fixtures. A successful authenticated response with `live_in_play_n = 0` proves provider network/auth runtime only. It does **not** prove that a live match was captured.

Only a run with one or more verified `LIVE_IN_PLAY` rows may claim a real live-match capture.

## Current state

The workflow and verifier can be implemented and CI-tested without the credential. Genuine external runtime evidence remains pending until `APISPORTS_KEY` is configured and the workflow is manually run from the canonical branch.

No model parameter, P002 rule, Gate4 threshold, Test B state or capital rule is changed. `realMoney` remains `NO`.
