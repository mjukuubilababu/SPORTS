# PostgreSQL Run Lease Ownership & Fencing v0.1

This layer closes the multi-worker ownership gap on top of the canonical PostgreSQL stage checkpoint/crash-recovery path.

## Problem

Crash recovery makes a durable prefix resumable, but without an ownership fence two workers could race on the same correlation. A worker that pauses long enough for another worker to take over must not be allowed to return later and extend the old lineage.

## Design

`reference_run_leases_v01` stores the current mutable owner. A takeover is allowed only after the current lease expires and increments a monotonically increasing fencing token.

`reference_run_lease_events_v01` is immutable history. ACQUIRED, RENEWED, TAKEN_OVER_AFTER_EXPIRY and RELEASED_AFTER_SUCCESS events form a SHA-256 chain.

`reference_checkpoint_fence_receipts_v01` is an immutable receipt created by PostgreSQL for every checkpoint inserted while a lease exists. It binds the checkpoint fingerprint to the worker, fencing token, lease event and expiry that authorized that write.

Database triggers enforce the current worker/token on inserts into checkpoints, archived artifacts, archived audit events and the final completed-run record. A stale process therefore cannot bypass fencing merely because it still has a live database connection.

## Runtime lifecycle

1. Derive the canonical correlation ID.
2. Acquire an unexpired lease or fail if another worker owns it.
3. Put worker ID and fencing token into the PostgreSQL session.
4. Run the existing checkpoint-recovery wrapper.
5. Renew the same token after each committed checkpoint.
6. On crash/failure, leave the lease in place; expiry is the takeover boundary.
7. After expiry a new worker takes ownership with token N+1 and resumes the exact durable prefix.
8. The old token is rejected by both runtime checks and PostgreSQL triggers.
9. On successful ASSURED archive, release the lease.

## Compatibility

No historical checkpoint is rewritten or retroactively assigned a fencing receipt. Existing non-leased paths continue to work when no lease row exists. New leased runs receive durable fence receipts.

## Governance

This layer changes no model probability, P002 rule, champion/challenger rule, or Gate6 capital authority. Capital remains `LOCKED`; real money remains `NO`.
