# PostgreSQL Runtime Evidence Persistence v0.1

## Purpose

This layer connects the existing `packages/reference-e2e` vertical slice to PostgreSQL as a durable evidence archive. It does **not** create a second prediction/decision system and it does not replace `ArtifactStore` or `AuditLog`.

The existing path remains:

`provider event → features → prediction → pattern → decision → risk → paper execution → settlement → evaluation → assurance`

When `REFERENCE_EVIDENCE_PERSISTENCE_MODE=postgres`, a database connection is preflighted before the run. After the canonical vertical slice reaches `ASSURED`, its exact artifact set and hash-chained audit ledger are written in one PostgreSQL transaction. The caller receives the completed result only after `COMMIT`.

## PostgreSQL evidence

Three append-only tables are introduced:

- `reference_artifacts_v01` — canonical artifact payloads with SHA-256 content hashes.
- `reference_audit_events_v01` — the existing ordered audit events, including `previous_hash` and `event_hash`.
- `reference_evidence_runs_v01` — one immutable run manifest binding the exact artifact-set hash, audit-chain head and archive fingerprint.

The run fingerprint binds the sorted set of `artifact_type:artifact_id:content_hash` entries and the ordered audit-event hashes. This prevents a same-metric or same-count evidence cohort from being silently substituted.

## Fail-closed behavior

PostgreSQL mode requires a reachable database before the vertical slice begins. A completed result is not returned unless:

1. the existing audit chain verifies;
2. all ten expected reference artifacts are present;
3. artifacts and audit events are inserted or verified as exact idempotent replays;
4. the immutable run manifest matches the exact evidence set; and
5. the transaction commits.

A conflicting replay rolls back and raises a `POSTGRES_EVIDENCE_*` error.

## Immutability and compatibility

Database triggers reject `UPDATE` and `DELETE` on all three evidence tables. Exact reruns are allowed only when their stored hashes and run fingerprint match.

The legacy SQLite migration `0001_reference_e2e.sql` remains unchanged and continues to be used for the local migration test. Normal E2E behavior remains unchanged when persistence mode is `disabled`.

## v0.1 boundary

This version atomically archives **completed `ASSURED` runs**. It does not yet persist a checkpoint after every in-progress stage. That limitation is explicit so a later stage-by-stage crash-recovery layer can be added without pretending it already exists.

## Governance

This change does not alter P002, model probabilities, pattern logic, decision thresholds, Gate6, or capital authority. `capital_state=LOCKED` and `real_money=NO` are enforced in the PostgreSQL schema and runtime writes.
