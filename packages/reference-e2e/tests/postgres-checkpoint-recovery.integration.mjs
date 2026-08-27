import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Pool } from 'pg';
import { ArtifactStore } from '../src/store.mjs';
import { AuditLog } from '../src/audit.mjs';
import {
  runVerticalSliceWithPostgresCheckpointRecovery,
  loadReferenceCheckpointPrefix
} from '../src/postgres-checkpoint-recovery.mjs';
import { id, sha256 } from '../src/utils.mjs';

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const baseFixture = JSON.parse(fs.readFileSync(new URL('../fixtures/controlled-match.json', import.meta.url), 'utf8'));

function checkpointFixture() {
  return {
    ...baseFixture,
    rawEvent: {
      ...baseFixture.rawEvent,
      providerEventId: 'CONTROL-CHECKPOINT-001',
      homeTeam: 'Checkpoint Chicago',
      awayTeam: 'Checkpoint Atlanta',
      source: {
        ...baseFixture.rawEvent.source,
        uri: 'fixture://controlled/checkpoint-chicago-atlanta'
      }
    }
  };
}

function inputIdentity(fixture) {
  return {
    correlationId: id('corr', [fixture.rawEvent.providerEventId, fixture.rawEvent.kickoffAt]),
    runInputHash: sha256({
      rawEvent: fixture.rawEvent,
      rawFeatures: fixture.rawFeatures,
      lineupGate: String(fixture.lineupGate),
      result: fixture.result,
      closingPrice: fixture.closingPrice
    })
  };
}

test('PostgreSQL stage checkpoints recover an interrupted run without rewriting the durable prefix', {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  const fixture = checkpointFixture();
  const identity = inputIdentity(fixture);
  const firstClock = () => new Date('2025-05-11T03:00:00.000Z');
  const recoveryClock = () => new Date('2025-05-11T03:00:10.000Z');
  const retryClock = () => new Date('2025-05-11T03:00:20.000Z');

  try {
    await assert.rejects(
      runVerticalSliceWithPostgresCheckpointRecovery({
        ...fixture,
        store: new ArtifactStore(),
        audit: new AuditLog(),
        clock: firstClock,
        pool,
        afterCheckpoint: async (checkpoint) => {
          if (checkpoint.stage === 'MODEL') throw new Error('SIMULATED_PROCESS_CRASH_AFTER_MODEL');
        }
      }),
      /POSTGRES_CHECKPOINT_FAIL_CLOSED/
    );

    const interrupted = await pool.query(
      `SELECT stage_sequence, stage, checkpoint_fingerprint
         FROM reference_stage_checkpoints_v01
        WHERE correlation_id=$1
        ORDER BY stage_sequence`,
      [identity.correlationId]
    );
    assert.deepEqual(interrupted.rows.map((row) => row.stage), ['INGEST', 'FEATURE', 'MODEL']);
    const prefixFingerprints = interrupted.rows.map((row) => row.checkpoint_fingerprint);

    const noFinalArchiveYet = await pool.query(
      'SELECT count(*)::int AS count FROM reference_evidence_runs_v01 WHERE correlation_id=$1',
      [identity.correlationId]
    );
    assert.equal(noFinalArchiveYet.rows[0].count, 0);

    const resumed = await runVerticalSliceWithPostgresCheckpointRecovery({
      ...fixture,
      store: new ArtifactStore(),
      audit: new AuditLog(),
      clock: recoveryClock,
      pool
    });

    assert.equal(resumed.state, 'ASSURED');
    assert.equal(resumed.assurance.gate, 'PROMOTE');
    assert.equal(resumed.recovery.status, 'RESUMED_FROM_DURABLE_CHECKPOINT');
    assert.equal(resumed.recovery.resumedCheckpointCount, 3);
    assert.equal(resumed.recovery.checkpointCount, 11);
    assert.equal(resumed.persistence.status, 'DURABLY_ARCHIVED');
    assert.equal(resumed.persistence.capitalState, 'LOCKED');
    assert.equal(resumed.persistence.realMoney, 'NO');
    assert.equal(resumed.audit.length, 10);

    const completed = await pool.query(
      `SELECT stage_sequence, stage, checkpoint_fingerprint
         FROM reference_stage_checkpoints_v01
        WHERE correlation_id=$1
        ORDER BY stage_sequence`,
      [identity.correlationId]
    );
    assert.equal(completed.rowCount, 11);
    assert.deepEqual(
      completed.rows.slice(0, 3).map((row) => row.checkpoint_fingerprint),
      prefixFingerprints
    );

    const prefix = await pool.connect();
    try {
      const verified = await loadReferenceCheckpointPrefix({
        client: prefix,
        correlationId: identity.correlationId,
        runInputHash: identity.runInputHash
      });
      assert.equal(verified.records.length, 11);
      assert.equal(verified.checkpointHead, resumed.recovery.checkpointHead);
    } finally {
      prefix.release();
    }

    const retry = await runVerticalSliceWithPostgresCheckpointRecovery({
      ...fixture,
      store: new ArtifactStore(),
      audit: new AuditLog(),
      clock: retryClock,
      pool
    });
    assert.equal(retry.recovery.status, 'RESUMED_FROM_DURABLE_CHECKPOINT');
    assert.equal(retry.recovery.resumedCheckpointCount, 11);
    assert.equal(retry.persistence.archiveFingerprint, resumed.persistence.archiveFingerprint);
    assert.equal(retry.recovery.checkpointHead, resumed.recovery.checkpointHead);

    await assert.rejects(
      runVerticalSliceWithPostgresCheckpointRecovery({
        ...fixture,
        rawFeatures: { ...fixture.rawFeatures, lambdaBase: fixture.rawFeatures.lambdaBase + 0.01 },
        store: new ArtifactStore(),
        audit: new AuditLog(),
        clock: retryClock,
        pool
      }),
      /POSTGRES_CHECKPOINT_INPUT_CONFLICT/
    );

    await assert.rejects(
      pool.query(
        `UPDATE reference_stage_checkpoints_v01
            SET stage=stage
          WHERE correlation_id=$1 AND stage_sequence=0`,
        [identity.correlationId]
      ),
      /reference evidence is immutable/i
    );
  } finally {
    await pool.end();
  }
});
