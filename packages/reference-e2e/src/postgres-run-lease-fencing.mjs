import { Pool } from 'pg';
import { id, sha256 } from './utils.mjs';
import { runVerticalSliceWithPostgresCheckpointRecovery } from './postgres-checkpoint-recovery.mjs';

export const POSTGRES_RUN_LEASE_FENCING_VERSION = 'v0.1';
export const DEFAULT_REFERENCE_RUN_LEASE_MS = 30_000;
export const MIN_REFERENCE_RUN_LEASE_MS = 50;
export const MAX_REFERENCE_RUN_LEASE_MS = 300_000;

function leaseError(code, cause) {
  const error = new Error(code);
  if (cause) error.cause = cause;
  return error;
}

function correlationIdFor(rawEvent) {
  if (!rawEvent?.providerEventId || !rawEvent?.kickoffAt) {
    throw leaseError('POSTGRES_RUN_LEASE_RAW_EVENT_IDENTITY_REQUIRED');
  }
  return id('corr', [rawEvent.providerEventId, rawEvent.kickoffAt]);
}

function validateWorkerId(workerId) {
  const value = String(workerId ?? '').trim();
  if (!value) throw leaseError('POSTGRES_RUN_LEASE_WORKER_ID_REQUIRED');
  if (value.length > 160) throw leaseError('POSTGRES_RUN_LEASE_WORKER_ID_TOO_LONG');
  return value;
}

function validateLeaseMs(leaseMs) {
  const value = Number(leaseMs);
  if (!Number.isInteger(value) || value < MIN_REFERENCE_RUN_LEASE_MS || value > MAX_REFERENCE_RUN_LEASE_MS) {
    throw leaseError('POSTGRES_RUN_LEASE_DURATION_INVALID');
  }
  return value;
}

function leaseEventBase({ correlationId, eventSequence, eventType, workerId, fencingToken, previousEventHash, acquiredAt, heartbeatAt, expiresAt, leaseStatus, occurredAt }) {
  return { correlationId, eventSequence, eventType, workerId, fencingToken, previousEventHash, acquiredAt, heartbeatAt, expiresAt, leaseStatus, occurredAt };
}

function normalizeLeaseRow(row) {
  return {
    correlationId: row.correlation_id,
    workerId: row.worker_id,
    fencingToken: Number(row.fencing_token),
    eventSequence: Number(row.event_sequence),
    acquiredAt: new Date(row.lease_acquired_at).toISOString(),
    heartbeatAt: new Date(row.lease_heartbeat_at).toISOString(),
    expiresAt: new Date(row.lease_expires_at).toISOString(),
    status: row.lease_status,
    lastEventHash: row.last_event_hash
  };
}

async function appendLeaseEvent(client, { correlationId, eventSequence, eventType, workerId, fencingToken, previousEventHash, acquiredAt, heartbeatAt, expiresAt, leaseStatus, occurredAt }) {
  const base = leaseEventBase({ correlationId, eventSequence, eventType, workerId, fencingToken, previousEventHash, acquiredAt, heartbeatAt, expiresAt, leaseStatus, occurredAt });
  const eventHash = sha256(base);
  const eventId = id('leaseevt', [correlationId, eventSequence, eventHash]);
  await client.query(
    `INSERT INTO reference_run_lease_events_v01(
       lease_event_id, correlation_id, event_sequence, event_type, worker_id, fencing_token,
       previous_event_hash, event_hash, lease_acquired_at, lease_heartbeat_at, lease_expires_at,
       lease_status, occurred_at, event_json, capital_state, real_money
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,'LOCKED','NO')`,
    [eventId, correlationId, eventSequence, eventType, workerId, fencingToken, previousEventHash, eventHash, acquiredAt, heartbeatAt, expiresAt, leaseStatus, occurredAt, JSON.stringify({ ...base, leaseEventId: eventId, eventHash })]
  );
  return { eventId, eventHash };
}

async function readLeaseForUpdate(client, correlationId) {
  const result = await client.query(
    `SELECT correlation_id, worker_id, fencing_token, event_sequence,
            lease_acquired_at, lease_heartbeat_at, lease_expires_at,
            lease_status, last_event_hash
       FROM reference_run_leases_v01
      WHERE correlation_id=$1
      FOR UPDATE`,
    [correlationId]
  );
  return result.rowCount === 1 ? normalizeLeaseRow(result.rows[0]) : null;
}

export async function acquireReferenceRunLease({ client, correlationId, workerId, leaseMs = DEFAULT_REFERENCE_RUN_LEASE_MS }) {
  if (!client?.query) throw leaseError('POSTGRES_RUN_LEASE_CLIENT_REQUIRED');
  const owner = validateWorkerId(workerId);
  const durationMs = validateLeaseMs(leaseMs);
  await client.query('BEGIN');
  try {
    const existing = await readLeaseForUpdate(client, correlationId);
    const dbNowResult = await client.query('SELECT clock_timestamp() AS now');
    const now = new Date(dbNowResult.rows[0].now);
    if (existing && existing.status === 'ACTIVE' && new Date(existing.expiresAt) > now) {
      if (existing.workerId === owner) {
        await client.query('COMMIT');
        return Object.freeze({ ...existing, acquisition: 'ALREADY_OWNED' });
      }
      throw leaseError(`POSTGRES_RUN_LEASE_HELD_BY_OTHER_WORKER:${existing.workerId}`);
    }
    const fencingToken = existing ? existing.fencingToken + 1 : 1;
    const eventSequence = existing ? existing.eventSequence + 1 : 0;
    const previousEventHash = existing?.lastEventHash ?? 'GENESIS';
    const acquiredAt = now.toISOString();
    const heartbeatAt = acquiredAt;
    const expiresAt = new Date(now.getTime() + durationMs).toISOString();
    const eventType = existing ? 'TAKEN_OVER_AFTER_EXPIRY' : 'ACQUIRED';
    const leaseStatus = 'ACTIVE';
    const event = await appendLeaseEvent(client, { correlationId, eventSequence, eventType, workerId: owner, fencingToken, previousEventHash, acquiredAt, heartbeatAt, expiresAt, leaseStatus, occurredAt: acquiredAt });
    await client.query(
      `INSERT INTO reference_run_leases_v01(
         correlation_id, worker_id, fencing_token, event_sequence,
         lease_acquired_at, lease_heartbeat_at, lease_expires_at,
         lease_status, last_event_hash, capital_state, real_money
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'LOCKED','NO')
       ON CONFLICT (correlation_id) DO UPDATE SET
         worker_id=EXCLUDED.worker_id,
         fencing_token=EXCLUDED.fencing_token,
         event_sequence=EXCLUDED.event_sequence,
         lease_acquired_at=EXCLUDED.lease_acquired_at,
         lease_heartbeat_at=EXCLUDED.lease_heartbeat_at,
         lease_expires_at=EXCLUDED.lease_expires_at,
         lease_status=EXCLUDED.lease_status,
         last_event_hash=EXCLUDED.last_event_hash`,
      [correlationId, owner, fencingToken, eventSequence, acquiredAt, heartbeatAt, expiresAt, leaseStatus, event.eventHash]
    );
    await client.query('COMMIT');
    return Object.freeze({ correlationId, workerId: owner, fencingToken, eventSequence, acquiredAt, heartbeatAt, expiresAt, status: leaseStatus, lastEventHash: event.eventHash, acquisition: eventType });
  } catch (cause) {
    await client.query('ROLLBACK').catch(() => {});
    if (cause?.message?.startsWith('POSTGRES_RUN_LEASE_')) throw cause;
    throw leaseError('POSTGRES_RUN_LEASE_ACQUIRE_FAILED', cause);
  }
}

async function mutateOwnedLease({ client, lease, leaseMs, eventType, targetStatus }) {
  const durationMs = validateLeaseMs(leaseMs);
  await client.query('BEGIN');
  try {
    const current = await readLeaseForUpdate(client, lease.correlationId);
    if (!current) throw leaseError('POSTGRES_RUN_LEASE_MISSING');
    if (current.workerId !== lease.workerId || current.fencingToken !== lease.fencingToken || current.status !== 'ACTIVE') throw leaseError('POSTGRES_RUN_LEASE_FENCE_STALE');
    const dbNowResult = await client.query('SELECT clock_timestamp() AS now');
    const now = new Date(dbNowResult.rows[0].now);
    if (new Date(current.expiresAt) <= now) throw leaseError('POSTGRES_RUN_LEASE_EXPIRED');
    const eventSequence = current.eventSequence + 1;
    const heartbeatAt = now.toISOString();
    const expiresAt = targetStatus === 'ACTIVE' ? new Date(now.getTime() + durationMs).toISOString() : heartbeatAt;
    const event = await appendLeaseEvent(client, { correlationId: current.correlationId, eventSequence, eventType, workerId: current.workerId, fencingToken: current.fencingToken, previousEventHash: current.lastEventHash, acquiredAt: current.acquiredAt, heartbeatAt, expiresAt, leaseStatus: targetStatus, occurredAt: heartbeatAt });
    await client.query(
      `UPDATE reference_run_leases_v01
          SET event_sequence=$2, lease_heartbeat_at=$3, lease_expires_at=$4, lease_status=$5, last_event_hash=$6
        WHERE correlation_id=$1`,
      [current.correlationId, eventSequence, heartbeatAt, expiresAt, targetStatus, event.eventHash]
    );
    await client.query('COMMIT');
    return Object.freeze({ correlationId: current.correlationId, workerId: current.workerId, fencingToken: current.fencingToken, eventSequence, acquiredAt: current.acquiredAt, heartbeatAt, expiresAt, status: targetStatus, lastEventHash: event.eventHash });
  } catch (cause) {
    await client.query('ROLLBACK').catch(() => {});
    if (cause?.message?.startsWith('POSTGRES_RUN_LEASE_')) throw cause;
    throw leaseError('POSTGRES_RUN_LEASE_MUTATION_FAILED', cause);
  }
}

export async function renewReferenceRunLease({ client, lease, leaseMs = DEFAULT_REFERENCE_RUN_LEASE_MS }) {
  return mutateOwnedLease({ client, lease, leaseMs, eventType: 'RENEWED', targetStatus: 'ACTIVE' });
}

export async function releaseReferenceRunLease({ client, lease, leaseMs = DEFAULT_REFERENCE_RUN_LEASE_MS }) {
  return mutateOwnedLease({ client, lease, leaseMs, eventType: 'RELEASED_AFTER_SUCCESS', targetStatus: 'RELEASED' });
}

export async function assertReferenceRunLeaseFence({ client, lease }) {
  if (!client?.query) throw leaseError('POSTGRES_RUN_LEASE_CLIENT_REQUIRED');
  const result = await client.query(`SELECT worker_id, fencing_token, lease_status, lease_expires_at FROM reference_run_leases_v01 WHERE correlation_id=$1`, [lease.correlationId]);
  if (result.rowCount !== 1) throw leaseError('POSTGRES_RUN_LEASE_MISSING');
  const current = result.rows[0];
  const dbNowResult = await client.query('SELECT clock_timestamp() AS now');
  const now = new Date(dbNowResult.rows[0].now);
  if (current.worker_id !== lease.workerId || Number(current.fencing_token) !== lease.fencingToken || current.lease_status !== 'ACTIVE' || new Date(current.lease_expires_at) <= now) throw leaseError('POSTGRES_RUN_LEASE_FENCE_STALE');
  return true;
}

async function setFenceSession(client, lease) {
  await client.query("SELECT set_config('app.reference_worker_id',$1,false)", [lease.workerId]);
  await client.query("SELECT set_config('app.reference_fencing_token',$1,false)", [String(lease.fencingToken)]);
}

function sameClientPool(client) {
  return { connect: async () => ({ query: (...args) => client.query(...args), release: () => {} }) };
}

export async function runVerticalSliceWithPostgresLeaseFencing({ databaseUrl = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL, pool = null, workerId, leaseMs = DEFAULT_REFERENCE_RUN_LEASE_MS, afterCheckpoint = null, ...verticalSliceInput }) {
  if (!pool && !databaseUrl) throw leaseError('POSTGRES_RUN_LEASE_DATABASE_URL_REQUIRED');
  const ownedPool = pool ? null : new Pool({ connectionString: databaseUrl });
  const effectivePool = pool ?? ownedPool;
  let client;
  let lease;
  try {
    client = await effectivePool.connect();
    await client.query('SELECT 1');
    const correlationId = correlationIdFor(verticalSliceInput.rawEvent);
    lease = await acquireReferenceRunLease({ client, correlationId, workerId, leaseMs });
    await setFenceSession(client, lease);
    const result = await runVerticalSliceWithPostgresCheckpointRecovery({
      ...verticalSliceInput,
      pool: sameClientPool(client),
      afterCheckpoint: async (checkpoint) => {
        lease = await renewReferenceRunLease({ client, lease, leaseMs });
        await setFenceSession(client, lease);
        if (afterCheckpoint) await afterCheckpoint(checkpoint, lease);
      }
    });
    await assertReferenceRunLeaseFence({ client, lease });
    const released = await releaseReferenceRunLease({ client, lease, leaseMs });
    return Object.freeze({ ...result, ownership: Object.freeze({ version: POSTGRES_RUN_LEASE_FENCING_VERSION, workerId: released.workerId, fencingToken: released.fencingToken, finalLeaseEventSequence: released.eventSequence, status: 'COMPLETED_AND_RELEASED', capitalState: 'LOCKED', realMoney: 'NO' }) });
  } catch (cause) {
    if (cause?.message?.startsWith('POSTGRES_RUN_LEASE_')) throw cause;
    if (cause?.message?.startsWith('POSTGRES_CHECKPOINT_')) throw cause;
    if (cause?.message?.startsWith('POSTGRES_EVIDENCE_')) throw cause;
    if (cause?.message?.includes('reference run lease fence rejected')) throw leaseError('POSTGRES_RUN_LEASE_FENCE_REJECTED_BY_DATABASE', cause);
    throw leaseError('POSTGRES_RUN_LEASE_FAIL_CLOSED', cause);
  } finally {
    client?.release();
    if (ownedPool) await ownedPool.end();
  }
}
