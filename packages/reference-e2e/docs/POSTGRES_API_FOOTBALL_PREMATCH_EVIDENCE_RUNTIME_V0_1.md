# PostgreSQL API-Football Prematch Evidence Runtime v0.1

Status: **IMPLEMENTED**

This runtime closes the acquisition-to-persistence gap without adding a second
feature, model, prediction, or evidence store.

## Canonical flow

```text
authenticated API-Football fixture responses
  -> exact target identity and time firewall
  -> sanitized CANONICAL_PROVIDER_MATCH_EVIDENCE_V0_1 batch
  -> existing MatchEvidenceSnapshot builder
  -> existing PostgreSQL provider evidence runtime
  -> existing immutable ingestion provenance + feature lineage tables
```

The adapter fetches only the target fixture, each team's settled history, and
their settled head-to-head history. It does not fetch or consume provider
predictions or bookmaker odds. Every source document is hashed; their ordered
manifest is hashed again and the exact bundle fingerprint is embedded in the
snapshot source reference. Raw provider response bodies and the API key are not
written to the runtime envelope or PostgreSQL.

## Fail-closed boundaries

- The target provider fixture ID, team IDs, team names, kickoff, registered
  competition, and scheduled status must exactly match the Gate1 target.
- Capture must be pre-kickoff and at or before the explicit prediction cutoff.
- Historical rows must be settled and strictly before the target kickoff.
- Home/away form remains distinct from overall form.
- Unavailable opponent strength, xG, lineups, injuries, suspensions, and market
  evidence remain null or empty.
- No independent model is invented. The output remains
  `EVIDENCE_READY_MODEL_PENDING` / `ABSTAIN` until a separately verified
  market-independent model is supplied.
- Exact replay is idempotent. Altered content under the same snapshot identity
  is rejected by the existing provider/runtime immutability boundary.
- The existing dedicated PoolClient transaction, full rollback, readback
  attestation, and database triggers remain authoritative.

## CLI

Authenticated acquisition:

```bash
APISPORTS_KEY=... python scripts/run_api_football_match_evidence_ingestion.py \
  targets.json runtime-envelope.json
node packages/reference-e2e/scripts/run-provider-match-evidence-persistence.mjs \
  runtime-envelope.json sanitized-receipt.json
```

Deterministic offline verification:

```bash
python scripts/run_api_football_match_evidence_ingestion.py \
  targets.json runtime-envelope.json \
  --package-file captured-provider-package.json \
  --captured-at 2026-09-10T12:00:00.000Z
```

Offline package mode is for tests/replay of a separately captured authenticated
response. It enforces the same identity, source-fingerprint, and no-hindsight
rules and never copies raw response bodies into the output envelope.

## Governance

P002 and Gate1-Gate6 are unchanged. Gate1 remains the truth owner and Gate6
remains the capital owner. Prediction, validation, and execution remain
separate. Capital is `LOCKED`, real money is `NO`, settlement is separate,
and there is no automatic promotion or retuning.
