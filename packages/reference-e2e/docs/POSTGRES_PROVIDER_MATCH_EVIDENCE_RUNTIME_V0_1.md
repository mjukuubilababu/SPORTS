# PostgreSQL Provider Match Evidence Runtime v0.1

Status: **IMPLEMENTED-ARTIFACT**

This increment operationally connects the existing real-provider Match Evidence adapter to the existing PostgreSQL provenance and feature-lineage bridge. It creates no new table and does not introduce a second evidence, feature, model, prediction, validation, settlement, or execution store.

## Runtime route

```text
canonical provider batch + exact per-event timing
  -> existing ingestRealProviderMatchEvidenceBatch
  -> existing prepareProviderMatchEvidencePersistence
  -> one PostgreSQL transaction for every unique event and feature
  -> exact durable readback attestation
  -> sanitized runtime receipt
```

The callable runtime is `runProviderMatchEvidencePersistence`. The CLI accepts a JSON envelope with `providerBatch` and `timingByEvent` and uses `DATABASE_URL` or `TEST_DATABASE_URL`:

```text
npm run provider-match-evidence:persist -- <runtime-envelope.json> [output.json]
```

Each event must have an exact timing record keyed by canonical `eventId`:

```json
{
  "timingByEvent": {
    "event-001": {
      "observedAt": "2026-09-01T09:55:00.000Z",
      "availableAt": "2026-09-01T09:56:00.000Z",
      "predictionCutoff": "2026-09-01T10:30:00.000Z"
    }
  }
}
```

Timing is never fabricated. Missing or extra event timing rejects the batch before a database transaction begins.

## Fail-closed behavior

- Any provider event rejected by the canonical adapter blocks every write in the batch.
- Exact duplicate events inside a batch are persisted once and reported as replays.
- All unique observations and their complete feature lineage are written in one transaction.
- A failure in any later event or feature rolls back all earlier writes.
- The runtime checks out one `PoolClient`, uses it for health, transaction, and readback, then releases it. A pool created by the runtime is also closed.
- Exact replay remains idempotent; changed content using the same immutable identity conflicts.

## Durable readback

Readback reconstructs the expected observation and complete feature set from the archived immutable snapshot. It recomputes the observation, archived source-payload, snapshot, feature, and lineage fingerprints and checks exact event binding. The archived provider-payload fingerprint is presence/format checked but cannot be recomputed because the raw provider payload is deliberately not stored in this layer. The returned receipt is sanitized: it does not contain the raw provider payload or raw snapshot.

## Governance

P002 is unchanged. Gate1 remains the authoritative truth owner and Gate6 remains the capital owner. Prediction, validation, and execution remain separate. Settlement remains separate. Capital is `LOCKED`, capital effect is `NONE`, real money is `NO`, and no promotion or retuning is automatic.
