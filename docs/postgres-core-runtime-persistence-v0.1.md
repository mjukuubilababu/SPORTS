# PostgreSQL Core Runtime Persistence v0.1

## Purpose

This layer connects the existing canonical Prediction HTTP API to PostgreSQL. It does not replace the intelligence engine, alter model probabilities, modify P002, promote a challenger, or grant Gate6/capital authority.

## Runtime behavior

`PREDICTION_PERSISTENCE_MODE=postgres` enables durable persistence and requires `DATABASE_URL`. If the mode is not set, the API selects PostgreSQL when `DATABASE_URL` exists and otherwise preserves the explicit non-persistent development/test behavior as `DISABLED`.

When PostgreSQL mode is active:

1. `/health` verifies the database and the `prediction_snapshots_v01` table.
2. `/v1/predict` and `/v1/predict/live` run the existing intelligence logic unchanged.
3. The public prediction plus its exact input/output SHA-256 bindings are inserted before the HTTP 200 response is sent.
4. A database write failure returns a failure response instead of emitting an unpersisted prediction.
5. `(request_id, endpoint)` is the idempotency key. An exact retry returns the already-persisted row; a retry with different input/output fails with `PERSISTENCE_IDEMPOTENCY_CONFLICT`.
6. PostgreSQL triggers reject UPDATE and DELETE on prediction snapshots.

## Data stored

Each immutable row records request identity, endpoint, PREMATCH/LIVE type, event/market/selection identity, exact input and output hashes, JSON input, JSON public prediction, model/feature lineage where available, source observation time, persistence time, and the locked capital/real-money state.

## Deployment

The repository does not provision a production database or commit credentials. Deployment supplies `DATABASE_URL`. Optional pool controls are `PREDICTION_DB_POOL_MAX`, `PREDICTION_DB_CONNECT_TIMEOUT_MS`, and `PREDICTION_DB_IDLE_TIMEOUT_MS`.

CI uses an ephemeral PostgreSQL 16 service, applies migration `0015_prediction_snapshots_v0_1.sql`, exercises real API writes/reads/idempotency, proves immutable mutation rejection, reruns the existing PostgreSQL migration assurance, and reruns intelligence-engine regressions.

## Governance invariants

- Prediction logic remains owned by the existing intelligence engine.
- PostgreSQL is persistence, not a second decision engine.
- No historical evidence is converted into new forward evidence by this change.
- Gate6 remains the only capital/risk authority.
- Capital remains `LOCKED`; real money remains `NO`.
