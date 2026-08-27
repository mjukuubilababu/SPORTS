import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Pool } from 'pg';
import { ArtifactStore } from '../src/store.mjs';
import { AuditLog } from '../src/audit.mjs';
import {
  runVerticalSliceWithPostgresEvidence,
  verifyEvidenceAuditChain
} from '../src/postgres-evidence.mjs';

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/controlled-match.json', import.meta.url), 'utf8'));

test('completed reference E2E evidence is transactionally archived and immutable in PostgreSQL', {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  const fixedClock = () => new Date('2025-05-11T03:00:00.000Z');
  try {
    const first = await runVerticalSliceWithPostgresEvidence({
      ...fixture,
      store: new ArtifactStore(),
      audit: new AuditLog(),
      clock: fixedClock,
      pool
    });

    assert.equal(first.state, 'ASSURED');
    assert.equal(first.persistence.status, 'DURABLY_ARCHIVED');
    assert.equal(first.persistence.artifactCount, 10);
    assert.equal(first.persistence.auditEventCount, 10);
    assert.equal(first.persistence.capitalState, 'LOCKED');
    assert.equal(first.persistence.realMoney, 'NO');

    const artifacts = await pool.query(
      'SELECT count(*)::int AS count FROM reference_artifacts_v01 WHERE correlation_id=$1',
      [first.correlationId]
    );
    const audits = await pool.query(
      'SELECT event_json FROM reference_audit_events_v01 WHERE correlation_id=$1 ORDER BY sequence',
      [first.correlationId]
    );
    const runs = await pool.query(
      'SELECT * FROM reference_evidence_runs_v01 WHERE correlation_id=$1',
      [first.correlationId]
    );
    assert.equal(artifacts.rows[0].count, 10);
    assert.equal(audits.rowCount, 10);
    assert.equal(runs.rowCount, 1);
    assert.equal(verifyEvidenceAuditChain(audits.rows.map((row) => row.event_json)), true);
    assert.equal(runs.rows[0].archive_fingerprint, first.persistence.archiveFingerprint);

    const second = await runVerticalSliceWithPostgresEvidence({
      ...fixture,
      store: new ArtifactStore(),
      audit: new AuditLog(),
      clock: fixedClock,
      pool
    });
    assert.equal(second.persistence.archiveFingerprint, first.persistence.archiveFingerprint);
    const afterRetry = await pool.query(
      'SELECT count(*)::int AS count FROM reference_evidence_runs_v01 WHERE correlation_id=$1',
      [first.correlationId]
    );
    assert.equal(afterRetry.rows[0].count, 1);

    const changedClock = () => new Date('2025-05-11T03:00:01.000Z');
    await assert.rejects(
      runVerticalSliceWithPostgresEvidence({
        ...fixture,
        store: new ArtifactStore(),
        audit: new AuditLog(),
        clock: changedClock,
        pool
      }),
      /POSTGRES_EVIDENCE_(ARTIFACT_IMMUTABILITY_CONFLICT|AUDIT_IMMUTABILITY_CONFLICT|UNIQUE_CONFLICT|RUN_IMMUTABILITY_CONFLICT)/
    );

    await assert.rejects(
      pool.query(
        'UPDATE reference_evidence_runs_v01 SET artifact_count=artifact_count WHERE correlation_id=$1',
        [first.correlationId]
      ),
      /reference evidence is immutable/i
    );
    await assert.rejects(
      pool.query(
        'DELETE FROM reference_audit_events_v01 WHERE correlation_id=$1',
        [first.correlationId]
      ),
      /reference evidence is immutable/i
    );
  } finally {
    await pool.end();
  }
});
