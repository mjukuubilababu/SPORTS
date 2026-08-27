import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { Pool } from 'pg';
import { id } from '../src/utils.mjs';
import {
  acquireReferenceRunLease,
  assertReferenceRunLeaseFence,
  renewReferenceRunLease,
  runVerticalSliceWithPostgresLeaseFencing
} from '../src/postgres-run-lease-fencing.mjs';

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const baseFixture = JSON.parse(fs.readFileSync(new URL('../fixtures/controlled-match.json', import.meta.url), 'utf8'));

function leaseFixture() {
  return {
    ...baseFixture,
    rawEvent: {
      ...baseFixture.rawEvent,
      providerEventId: 'CONTROL-LEASE-001',
      kickoffAt: '2025-05-12T23:30:00.000Z',
      observedAt: '2025-05-12T20:00:00.000Z',
      source: { ...baseFixture.rawEvent.source, uri: 'fixture://controlled/lease-fencing' }
    }
  };
}

test('expired worker is fenced and takeover resumes exact checkpoint prefix', { skip: !connectionString }, async () => {
  const pool = new Pool({ connectionString, max: 6 });
  const fixture = leaseFixture();
  const correlationId = id('corr', [fixture.rawEvent.providerEventId, fixture.rawEvent.kickoffAt]);
  const workerA = 'worker-A-stale';
  const workerB = 'worker-B-takeover';
  const leaseMs = 120;
  const clientA = await pool.connect();
  const clientB = await pool.connect();
  try {
    const leaseA = await acquireReferenceRunLease({ client: clientA, correlationId, workerId: workerA, leaseMs });
    assert.equal(leaseA.fencingToken, 1);
    assert.equal(leaseA.acquisition, 'ACQUIRED');

    let crashedAfterModel = false;
    await assert.rejects(
      runVerticalSliceWithPostgresLeaseFencing({
        ...fixture,
        pool,
        workerId: workerA,
        leaseMs,
        clock: () => new Date('2025-05-13T03:00:00.000Z'),
        afterCheckpoint: async (checkpoint) => {
          if (checkpoint.stage === 'MODEL') {
            crashedAfterModel = true;
            throw new Error('SIMULATED_WORKER_CRASH_AFTER_MODEL');
          }
        }
      }),
      /POSTGRES_CHECKPOINT_FAIL_CLOSED/
    );
    assert.equal(crashedAfterModel, true);

    const crashedPrefix = await pool.query(`SELECT stage_sequence, stage FROM reference_stage_checkpoints_v01 WHERE correlation_id=$1 ORDER BY stage_sequence`, [correlationId]);
    assert.deepEqual(crashedPrefix.rows.map((row) => row.stage), ['INGEST', 'FEATURE', 'MODEL']);

    await sleep(leaseMs + 100);
    const leaseB = await acquireReferenceRunLease({ client: clientB, correlationId, workerId: workerB, leaseMs: 1000 });
    assert.equal(leaseB.fencingToken, 2);
    assert.equal(leaseB.acquisition, 'TAKEN_OVER_AFTER_EXPIRY');

    await assert.rejects(assertReferenceRunLeaseFence({ client: clientA, lease: leaseA }), /POSTGRES_RUN_LEASE_FENCE_STALE/);
    await assert.rejects(renewReferenceRunLease({ client: clientA, lease: leaseA, leaseMs: 1000 }), /POSTGRES_RUN_LEASE_FENCE_STALE/);

    await clientA.query("SELECT set_config('app.reference_worker_id',$1,false)", [workerA]);
    await clientA.query("SELECT set_config('app.reference_fencing_token',$1,false)", ['1']);
    await assert.rejects(
      clientA.query(
        `INSERT INTO reference_evidence_runs_v01(
           correlation_id, state, assurance_gate, artifact_count, audit_event_count,
           artifact_set_hash, audit_chain_head, archive_fingerprint, capital_state, real_money
         ) VALUES($1,'ASSURED','BLOCK',1,1,$2,$3,$4,'LOCKED','NO')`,
        [correlationId, 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)]
      ),
      /reference run lease fence rejected stale worker/i
    );

    const completed = await runVerticalSliceWithPostgresLeaseFencing({
      ...fixture,
      pool,
      workerId: workerB,
      leaseMs: 1000,
      clock: () => new Date('2025-05-13T03:00:05.000Z')
    });
    assert.equal(completed.state, 'ASSURED');
    assert.equal(completed.assurance.gate, 'PROMOTE');
    assert.equal(completed.recovery.status, 'RESUMED_FROM_DURABLE_CHECKPOINT');
    assert.equal(completed.recovery.resumedCheckpointCount, 3);
    assert.equal(completed.ownership.fencingToken, 2);
    assert.equal(completed.ownership.status, 'COMPLETED_AND_RELEASED');
    assert.equal(completed.ownership.capitalState, 'LOCKED');
    assert.equal(completed.ownership.realMoney, 'NO');

    const checkpoints = await pool.query(`SELECT stage_sequence, stage FROM reference_stage_checkpoints_v01 WHERE correlation_id=$1 ORDER BY stage_sequence`, [correlationId]);
    assert.equal(checkpoints.rowCount, 11);

    const receipts = await pool.query(`SELECT stage_sequence, worker_id, fencing_token FROM reference_checkpoint_fence_receipts_v01 WHERE correlation_id=$1 ORDER BY stage_sequence`, [correlationId]);
    assert.equal(receipts.rowCount, 11);
    assert.deepEqual(receipts.rows.slice(0, 3).map((row) => Number(row.fencing_token)), [1, 1, 1]);
    assert.deepEqual(receipts.rows.slice(3).map((row) => Number(row.fencing_token)), Array(8).fill(2));
    assert.deepEqual(receipts.rows.slice(0, 3).map((row) => row.worker_id), Array(3).fill(workerA));
    assert.deepEqual(receipts.rows.slice(3).map((row) => row.worker_id), Array(8).fill(workerB));

    const leaseEvents = await pool.query(`SELECT event_sequence, event_type, worker_id, fencing_token, previous_event_hash, event_hash, event_json FROM reference_run_lease_events_v01 WHERE correlation_id=$1 ORDER BY event_sequence`, [correlationId]);
    assert.ok(leaseEvents.rowCount >= 6);
    assert.equal(leaseEvents.rows[0].event_type, 'ACQUIRED');
    assert.ok(leaseEvents.rows.some((row) => row.event_type === 'TAKEN_OVER_AFTER_EXPIRY' && Number(row.fencing_token) === 2));
    assert.equal(leaseEvents.rows.at(-1).event_type, 'RELEASED_AFTER_SUCCESS');
    for (let index = 0; index < leaseEvents.rows.length; index += 1) {
      const row = leaseEvents.rows[index];
      assert.equal(Number(row.event_sequence), index);
      assert.equal(row.event_json.eventHash, row.event_hash);
      assert.equal(row.previous_event_hash, index === 0 ? 'GENESIS' : leaseEvents.rows[index - 1].event_hash);
    }

    await assert.rejects(pool.query('UPDATE reference_checkpoint_fence_receipts_v01 SET worker_id=worker_id WHERE correlation_id=$1 AND stage_sequence=0', [correlationId]), /reference lease history is immutable/i);
    await assert.rejects(pool.query('DELETE FROM reference_run_lease_events_v01 WHERE correlation_id=$1', [correlationId]), /reference lease history is immutable/i);
  } finally {
    clientA.release();
    clientB.release();
    await pool.end();
  }
});
