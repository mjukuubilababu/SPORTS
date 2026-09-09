# PostgreSQL API-Football Prematch Evidence Runtime v0.1

Status: **IMPLEMENTED**

This runtime closes the acquisition-to-persistence gap without adding a second
feature, model, prediction, or evidence store. It adds one narrow constraint
migration to the existing ingestion-provenance table.

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
written to the runtime envelope or PostgreSQL. The acquisition timestamp is
required, must exactly equal the declared capture timestamp, and is included in
the source-bundle fingerprint.

## Fail-closed boundaries

- The target provider fixture ID, team IDs, team names, kickoff, registered
  competition, and scheduled status must exactly match the Gate1 target.
- Capture must be pre-kickoff and at or before the explicit prediction cutoff.
- Historical rows must be settled, no later than capture, and strictly before the target kickoff.
- Every H2H row must contain both exact target team IDs, regardless of historical home/away orientation.
- Home/away form remains distinct from overall form.
- Unavailable opponent strength, xG, lineups, injuries, suspensions, and market
  evidence remain null or empty.
- No independent model is invented. The output remains
  `EVIDENCE_READY_MODEL_PENDING` / `ABSTAIN` until a separately verified
  market-independent model is supplied.
- Offline package replay uses `PROVIDER_API_REPLAY` and `verified=false`.
  The public replay builder exposes no authentication override; verification is
  emitted only by the function that performs the authenticated fetch and builds
  its envelope in one operation. The canonical snapshot consumer and generic
  PostgreSQL ingestion preparation both force replay verification off.
- PostgreSQL migration
  `0011_api_football_replay_verification_firewall_v0_1.sql` adds a table-level
  check that rejects any replay row marked verified or prematch eligible and
  requires the archived snapshot's independent-verification flag to be exactly
  false.
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

Offline package mode is for tests/replay of a separately captured response. Its
package must carry the exact acquisition timestamp used as `--captured-at`.
Replay is deliberately unverified, enforces the same identity,
source-fingerprint, and no-hindsight rules, and never copies raw response bodies
into the output envelope. Calling the package fetch helper and later replaying
its returned data also remains unverified; only the coupled live CLI path can
emit an authenticated envelope.

## Governance

P002 and Gate1-Gate6 are unchanged. Gate1 remains the truth owner and Gate6
remains the capital owner. Prediction, validation, and execution remain
separate. Capital is `LOCKED`, real money is `NO`, settlement is separate,
and there is no automatic promotion or retuning.
