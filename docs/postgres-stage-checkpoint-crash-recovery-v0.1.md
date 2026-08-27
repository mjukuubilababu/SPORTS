# PostgreSQL Stage Checkpoint & Crash Recovery v0.1

## Purpose

This layer closes the explicit v0.1 gap left by PostgreSQL Runtime Evidence Persistence: a completed `ASSURED` run was durable, but a process crash before `ASSURED` left no durable stage prefix.

The implementation does **not** create a second prediction or decision system. The canonical `reference-e2e` business functions, authorization checks, state machine, artifact store semantics, audit chain, assurance logic, P002 rules, and Gate6 ownership remain the source of truth.

## Execution model

`createVerticalSliceStepper()` exposes the existing vertical slice as the same ordered legal stages:

`INGEST → FEATURE → MODEL → PATTERN → DECISION → RISK → EXECUTION → START → SETTLEMENT → EVALUATION → ASSURANCE`

The legacy `runVerticalSlice()` still consumes that stepper synchronously, preserving existing behavior. The PostgreSQL recovery runner consumes the same stepper and commits one immutable checkpoint after every completed stage.

## Durable checkpoint

`reference_stage_checkpoints_v01` stores an immutable prefix ledger. Every checkpoint binds:

- correlation ID and exact stage sequence;
- legal state reached after the stage;
- SHA-256 of the complete runtime input envelope;
- previous checkpoint fingerprint and current checkpoint fingerprint;
- exact artifact JSON + SHA-256 for artifact-producing stages;
- exact audit event JSON + event hash for audited stages;
- trace entry;
- duplicate-execution state;
- `capital_state=LOCKED` and `real_money=NO`.

`START` is the only stage without a new artifact or audit event and is constrained that way at the database layer.

## Recovery behavior

On restart, the runner first verifies the complete stored prefix. It rejects gaps, reordered stages, input changes, checkpoint-chain changes, artifact changes, audit changes, and any fingerprint mismatch.

If the prefix is valid, the runtime:

1. hydrates the exact immutable artifacts into the existing `ArtifactStore`;
2. hydrates and cryptographically verifies the exact audit prefix into `AuditLog`;
3. restores trace, state, last causation ID, and execution-duplication state;
4. starts the canonical stepper at the first incomplete stage;
5. commits new checkpoints one stage at a time;
6. after `ASSURED`, calls the existing `archiveReferenceEvidence()` final archive transaction.

Completed stages are **not recomputed**, which prevents restart-time clock differences from silently rewriting old evidence.

A completed legacy archive created before checkpointing and lacking a checkpoint prefix is deliberately not auto-converted into a recoverable run. It fails closed instead of fabricating historical checkpoints.

## Crash test

The PostgreSQL integration test intentionally throws immediately after the `MODEL` checkpoint commit. It verifies that only `INGEST`, `FEATURE`, and `MODEL` survive the simulated crash, then restarts with a different clock and confirms:

- the first three checkpoint fingerprints are unchanged;
- recovery resumes from the durable prefix rather than rebuilding it;
- all 11 stage checkpoints become durable;
- the final audit chain remains valid;
- the completed evidence archive is created;
- a full retry is idempotent;
- changed inputs are rejected;
- checkpoint UPDATE is rejected by PostgreSQL.

## Governance boundary

This is durability/recovery infrastructure only. It does not change model probabilities, decision thresholds, P002, challenger governance, or Gate6. It does not provision production database credentials. Capital remains `LOCKED`; real money remains `NO`.

## Deferred

Distributed worker leasing/ownership and safe takeover of an actively running worker remain outside v0.1. This version recovers after an interrupted process using an exact immutable durable prefix.
