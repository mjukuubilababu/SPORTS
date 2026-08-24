# Real-Time Live Provider Runtime Activation v0.1

## Purpose

Provides the controlled production-style verification path for the documented API-Football provider boundary already merged in canonical.

The runtime workflow can be started by `workflow_dispatch` or by a controlled push to the canonical branch that changes only a marker under `runtime-triggers/api-football/**`. It does not run with secrets on pull requests. The canonical marker path exists so the runtime can still be activated when connected GitHub tooling cannot invoke `workflow_dispatch` directly.

## Credential policy

`APISPORTS_KEY` must exist only as a GitHub Actions secret. It is injected into the provider request as a request header by the existing Gate1 runner. It is never written into source code, artifact JSON, request URLs, trigger markers, runtime ledger comments or audit output.

## Controlled canonical trigger

A marker is harmless repository metadata and contains no credential. A pull request may add a new marker, but the authenticated provider workflow runs only after that marker reaches `import/decision-intelligence-v0.5-qualified-set` through a canonical push/merge. This keeps repository secrets away from pull-request execution while providing an auditable one-shot trigger.

If `workflow_dispatch` provides competitions, those are used. For a canonical marker trigger, the workflow defaults to EPL, La Liga, Serie A, Bundesliga and Ligue 1.

## Observable runtime evidence

Every canonical runtime attempt writes a sanitized evidence summary with `scripts/write_api_football_runtime_evidence.py`. The summary is uploaded as a workflow artifact and posted to GitHub issue #44, `Runtime Evidence Ledger — API-Football`, before the final success gate is enforced.

This makes failures observable even when the connected GitHub tooling cannot enumerate push-triggered workflow runs. The ledger stores no API key, authorization header or raw provider response. It records only workflow identity, stage outcomes, provider observation time and row counts when available, assurance state, failure class and immutable governance flags.

The evidence states distinguish:

- `BLOCKED_CREDENTIAL_NOT_CONFIGURED`
- `PROVIDER_FETCH_FAILED`
- `ARTIFACT_VERIFICATION_FAILED`
- `UNIFIED_ASSURANCE_FAILED`
- `VERIFIED_AUTHENTICATED_PROVIDER_RUNTIME_ZERO_LIVE`
- `VERIFIED_AUTHENTICATED_PROVIDER_RUNTIME_WITH_LIVE_CAPTURE`

The final workflow gate succeeds only for the two verified authenticated-provider states and only while capital assurance remains `LOCKED`.

## What a successful run proves

A successful canonical workflow run proves that the configured credential can authenticate against the documented provider endpoint, that the provider response can be parsed into the canonical sanitized artifact, and that repository assurance remains `PROMOTE` with capital `LOCKED`.

The sanitized artifact verifier also requires each `live_model_input` to match exactly one `LIVE_IN_PLAY` provider snapshot by canonical event ID, elapsed minute, home/away score, observation timestamp and verified provider provenance hash. Snapshot observation timestamps must match the artifact observation timestamp, and canonical fixture IDs must match the provider fixture and competition identity. Mixed or cross-wired live inputs fail closed.

## Zero-live semantics

The provider may legitimately return zero live fixtures. A successful authenticated response with `live_in_play_n = 0` proves provider network/auth runtime only. It does **not** prove that a live match was captured.

Only a run with one or more verified `LIVE_IN_PLAY` rows may claim a real live-match capture.

## Current state

The activation workflow, artifact verifier and controlled canonical trigger are engineering capabilities. Persistent observable evidence is added so the next canonical trigger can produce an inspectable runtime result in issue #44 even if the run itself cannot be listed by the connected tooling.

No model parameter, P002 rule, Gate4 threshold, Test B state or capital rule is changed. `realMoney` remains `NO`.
