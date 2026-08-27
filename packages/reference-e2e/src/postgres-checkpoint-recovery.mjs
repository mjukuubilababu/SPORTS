import { Pool } from 'pg';
import { ArtifactStore } from './store.mjs';
import { AuditLog } from './audit.mjs';
import {
  createVerticalSliceStepper,
  VERTICAL_SLICE_STAGE_ORDER
} from './orchestrator.mjs';
import { archiveReferenceEvidence } from './postgres-evidence.mjs';
import { id, sha256 } from './utils.mjs';

export const POSTGRES_CHECKPOINT_RECOVERY_VERSION = 'v0.1';
export const POSTGRES_CHECKPOINT_TABLE = 'reference_stage_checkpoints_v01';

const ARTIFACT_OUTPUT_FIELD = Object.freeze({
  event: 'event',
  feature: 'features',
  prediction: 'prediction',
  pattern: 'pattern',
  decision: 'decision',
  risk: 'risk',
  execution: 'execution',
  settlement: 'settlement',
  evaluation: 'evaluation',
  assurance: 'assurance'
});

function checkpointError(code, cause) {
  const error = new Error(code);
  if (cause) error.cause = cause;
  return error;
}

function buildRunIdentity({ rawEvent, rawFeatures, lineupGate = 'PASS', result, closingPrice }) {
  if (!rawEvent?.providerEventId || !rawEvent?.kickoffAt) {
    throw checkpointError('POSTGRES_CHECKPOINT_RAW_EVENT_IDENTITY_REQUIRED');
  }
  const correlationId = id('corr', [rawEvent.providerEventId, rawEvent.kickoffAt]);
  const runInputHash = sha256({
    rawEvent,
    rawFeatures,
    lineupGate: String(lineupGate),
    result: result ?? null,
    closingPrice: closingPrice ?? null
  });
  return { correlationId, runInputHash };
}

function checkpointBase({
  correlationId,
  sequence,
  stage,
  state,
  runInputHash,
  previousCheckpointFingerprint,
  artifactType,
  artifactId,
  artifactHash,
  auditId,
  auditEventHash,
  traceEntry,
  duplicateExecution
}) {
  return {
    correlationId,
    sequence,
    stage,
    state,
    runInputHash,
    previousCheckpointFingerprint,
    artifactType: artifactType ?? null,
    artifactId: artifactId ?? null,
    artifactHash: artifactHash ?? null,
    auditId: auditId ?? null,
    auditEventHash: auditEventHash ?? null,
    traceEntry,
    duplicateExecution: Boolean(duplicateExecution)
  };
}

function normalizeCheckpointRow(row) {
  return {
    correlationId: row.correlation_id,
    sequence: Number(row.stage_sequence),
    stage: row.stage,
    state: row.state,
    runInputHash: row.run_input_hash,
    previousCheckpointFingerprint: row.previous_checkpoint_fingerprint,
    checkpointFingerprint: row.checkpoint_fingerprint,
    artifactType: row.artifact_type,
    artifactId: row.artifact_id,
    artifactHash: row.artifact_hash,
    artifact: row.artifact_json,
    auditId: row.audit_id,
    auditEventHash: row.audit_event_hash,
    auditEvent: row.audit_event_json,
    traceEntry: row.trace_json,
    duplicateExecution: Boolean(row.duplicate_execution)
  };
}

function verifyCheckpointRecord(record, { expectedCorrelationId, expectedRunInputHash, expectedPreviousFingerprint }) {
  if (record.correlationId !== expectedCorrelationId) {
    throw checkpointError('POSTGRES_CHECKPOINT_CORRELATION_MISMATCH');
  }
  if (record.runInputHash !== expectedRunInputHash) {
    throw checkpointError('POSTGRES_CHECKPOINT_INPUT_CONFLICT');
  }
  if (record.sequence < 0 || record.sequence >= VERTICAL_SLICE_STAGE_ORDER.length) {
    throw checkpointError('POSTGRES_CHECKPOINT_SEQUENCE_INVALID');
  }
  if (record.stage !== VERTICAL_SLICE_STAGE_ORDER[record.sequence]) {
    throw checkpointError(`POSTGRES_CHECKPOINT_STAGE_ORDER_INVALID:${record.sequence}`);
  }
  if (record.previousCheckpointFingerprint !== expectedPreviousFingerprint) {
    throw checkpointError(`POSTGRES_CHECKPOINT_CHAIN_PREVIOUS_INVALID:${record.sequence}`);
  }
  if (!record.traceEntry || record.traceEntry.stage !== record.stage || record.traceEntry.correlationId !== record.correlationId) {
    throw checkpointError(`POSTGRES_CHECKPOINT_TRACE_INVALID:${record.sequence}`);
  }

  if (record.stage === 'START') {
    if (
      record.artifactType !== null || record.artifactId !== null || record.artifactHash !== null || record.artifact !== null ||
      record.auditId !== null || record.auditEventHash !== null || record.auditEvent !== null
    ) {
      throw checkpointError('POSTGRES_CHECKPOINT_START_PAYLOAD_INVALID');
    }
  } else {
    if (!record.artifactType || !record.artifactId || !record.artifactHash || !record.artifact) {
      throw checkpointError(`POSTGRES_CHECKPOINT_ARTIFACT_MISSING:${record.sequence}`);
    }
    if (record.artifact.id !== record.artifactId || sha256(record.artifact) !== record.artifactHash) {
      throw checkpointError(`POSTGRES_CHECKPOINT_ARTIFACT_HASH_INVALID:${record.sequence}`);
    }
    if (!record.auditId || !record.auditEventHash || !record.auditEvent) {
      throw checkpointError(`POSTGRES_CHECKPOINT_AUDIT_MISSING:${record.sequence}`);
    }
    if (record.auditEvent.auditId !== record.auditId || record.auditEvent.eventHash !== record.auditEventHash) {
      throw checkpointError(`POSTGRES_CHECKPOINT_AUDIT_IDENTITY_INVALID:${record.sequence}`);
    }
    const { eventHash, ...auditBase } = record.auditEvent;
    if (sha256(auditBase) !== eventHash) {
      throw checkpointError(`POSTGRES_CHECKPOINT_AUDIT_HASH_INVALID:${record.sequence}`);
    }
  }

  const base = checkpointBase(record);
  if (sha256(base) !== record.checkpointFingerprint) {
    throw checkpointError(`POSTGRES_CHECKPOINT_FINGERPRINT_INVALID:${record.sequence}`);
  }
  return true;
}

async function readCheckpointRows(client, correlationId) {
  const result = await client.query(
    `SELECT correlation_id, stage_sequence, stage, state, run_input_hash,
            previous_checkpoint_fingerprint, checkpoint_fingerprint,
            artifact_type, artifact_id, artifact_hash, artifact_json,
            audit_id, audit_event_hash, audit_event_json, trace_json,
            duplicate_execution
       FROM reference_stage_checkpoints_v01
      WHERE correlation_id=$1
      ORDER BY stage_sequence`,
    [correlationId]
  );
  return result.rows.map(normalizeCheckpointRow);
}

async function completedArchiveExists(client, correlationId) {
  const result = await client.query(
    'SELECT 1 FROM reference_evidence_runs_v01 WHERE correlation_id=$1',
    [correlationId]
  );
  return result.rowCount === 1;
}

export async function loadReferenceCheckpointPrefix({ client, correlationId, runInputHash }) {
  if (!client?.query) throw checkpointError('POSTGRES_CHECKPOINT_CLIENT_REQUIRED');
  const rows = await readCheckpointRows(client, correlationId);
  if (rows.length > VERTICAL_SLICE_STAGE_ORDER.length) {
    throw checkpointError('POSTGRES_CHECKPOINT_PREFIX_TOO_LONG');
  }

  let previousCheckpointFingerprint = 'GENESIS';
  for (let sequence = 0; sequence < rows.length; sequence += 1) {
    const record = rows[sequence];
    if (record.sequence !== sequence) {
      throw checkpointError(`POSTGRES_CHECKPOINT_PREFIX_GAP:${sequence}`);
    }
    verifyCheckpointRecord(record, {
      expectedCorrelationId: correlationId,
      expectedRunInputHash: runInputHash,
      expectedPreviousFingerprint: previousCheckpointFingerprint
    });
    previousCheckpointFingerprint = record.checkpointFingerprint;
  }

  return Object.freeze({
    records: rows,
    checkpointHead: previousCheckpointFingerprint
  });
}

function restoreResumeState({ records, correlationId, store, audit }) {
  if (store.snapshotHashes().length !== 0 || audit.list().length !== 0) {
    throw checkpointError('POSTGRES_CHECKPOINT_RECOVERY_REQUIRES_EMPTY_RUNTIME_STATE');
  }

  const outputs = {};
  const auditEvents = [];
  const trace = [];
  for (const record of records) {
    trace.push(record.traceEntry);
    if (record.artifact) {
      const outputField = ARTIFACT_OUTPUT_FIELD[record.artifactType];
      if (!outputField) throw checkpointError(`POSTGRES_CHECKPOINT_ARTIFACT_TYPE_UNSUPPORTED:${record.artifactType}`);
      store.putImmutable(record.artifactType, record.artifact);
      outputs[outputField] = record.artifact;
    }
    if (record.auditEvent) auditEvents.push(record.auditEvent);
  }
  audit.hydrate(auditEvents);
  if (!audit.verifyChain()) throw checkpointError('POSTGRES_CHECKPOINT_RESTORED_AUDIT_CHAIN_INVALID');

  const latest = records.at(-1);
  return {
    correlationId,
    stageIndex: records.length,
    state: latest?.state ?? 'DISCOVERED',
    lastCause: auditEvents.at(-1)?.auditId ?? null,
    trace,
    outputs,
    duplicateExecution: latest?.duplicateExecution ?? false
  };
}

export async function persistReferenceStageCheckpoint({
  client,
  correlationId,
  runInputHash,
  previousCheckpointFingerprint,
  checkpoint
}) {
  if (!client?.query) throw checkpointError('POSTGRES_CHECKPOINT_CLIENT_REQUIRED');
  const artifactType = checkpoint.kind ?? null;
  const artifactId = checkpoint.artifact?.id ?? null;
  const artifactHash = checkpoint.artifact ? sha256(checkpoint.artifact) : null;
  const auditId = checkpoint.auditEvent?.auditId ?? null;
  const auditEventHash = checkpoint.auditEvent?.eventHash ?? null;
  const base = checkpointBase({
    correlationId,
    sequence: checkpoint.sequence,
    stage: checkpoint.stage,
    state: checkpoint.state,
    runInputHash,
    previousCheckpointFingerprint,
    artifactType,
    artifactId,
    artifactHash,
    auditId,
    auditEventHash,
    traceEntry: checkpoint.traceEntry,
    duplicateExecution: checkpoint.duplicateExecution
  });
  const checkpointFingerprint = sha256(base);

  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO reference_stage_checkpoints_v01(
         correlation_id, stage_sequence, stage, state, run_input_hash,
         previous_checkpoint_fingerprint, checkpoint_fingerprint,
         artifact_type, artifact_id, artifact_hash, artifact_json,
         audit_id, audit_event_hash, audit_event_json, trace_json,
         duplicate_execution, capital_state, real_money
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14::jsonb,$15::jsonb,$16,'LOCKED','NO')
       ON CONFLICT (correlation_id, stage_sequence) DO NOTHING`,
      [
        correlationId,
        checkpoint.sequence,
        checkpoint.stage,
        checkpoint.state,
        runInputHash,
        previousCheckpointFingerprint,
        checkpointFingerprint,
        artifactType,
        artifactId,
        artifactHash,
        checkpoint.artifact ? JSON.stringify(checkpoint.artifact) : null,
        auditId,
        auditEventHash,
        checkpoint.auditEvent ? JSON.stringify(checkpoint.auditEvent) : null,
        JSON.stringify(checkpoint.traceEntry),
        Boolean(checkpoint.duplicateExecution)
      ]
    );

    const readback = await client.query(
      `SELECT correlation_id, stage_sequence, stage, state, run_input_hash,
              previous_checkpoint_fingerprint, checkpoint_fingerprint,
              artifact_type, artifact_id, artifact_hash, artifact_json,
              audit_id, audit_event_hash, audit_event_json, trace_json,
              duplicate_execution
         FROM reference_stage_checkpoints_v01
        WHERE correlation_id=$1 AND stage_sequence=$2`,
      [correlationId, checkpoint.sequence]
    );
    if (readback.rowCount !== 1) throw checkpointError('POSTGRES_CHECKPOINT_READBACK_MISSING');
    const stored = normalizeCheckpointRow(readback.rows[0]);
    verifyCheckpointRecord(stored, {
      expectedCorrelationId: correlationId,
      expectedRunInputHash: runInputHash,
      expectedPreviousFingerprint: previousCheckpointFingerprint
    });
    if (stored.checkpointFingerprint !== checkpointFingerprint) {
      throw checkpointError(`POSTGRES_CHECKPOINT_IMMUTABILITY_CONFLICT:${checkpoint.sequence}`);
    }

    await client.query('COMMIT');
    return Object.freeze(stored);
  } catch (cause) {
    await client.query('ROLLBACK').catch(() => {});
    if (cause?.message?.startsWith('POSTGRES_CHECKPOINT_')) throw cause;
    throw checkpointError('POSTGRES_CHECKPOINT_TRANSACTION_FAILED', cause);
  }
}

export async function runVerticalSliceWithPostgresCheckpointRecovery({
  databaseUrl = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL,
  pool = null,
  afterCheckpoint = null,
  store = new ArtifactStore(),
  audit = new AuditLog(),
  ...verticalSliceInput
}) {
  if (!pool && !databaseUrl) throw checkpointError('POSTGRES_CHECKPOINT_DATABASE_URL_REQUIRED');
  const ownedPool = pool ? null : new Pool({ connectionString: databaseUrl });
  const effectivePool = pool ?? ownedPool;
  let client;

  try {
    client = await effectivePool.connect();
    await client.query('SELECT 1');

    const identity = buildRunIdentity(verticalSliceInput);
    const prefix = await loadReferenceCheckpointPrefix({
      client,
      correlationId: identity.correlationId,
      runInputHash: identity.runInputHash
    });
    const archiveExists = await completedArchiveExists(client, identity.correlationId);
    if (archiveExists && prefix.records.length === 0) {
      throw checkpointError('POSTGRES_CHECKPOINT_LEGACY_ARCHIVE_WITHOUT_CHECKPOINT_PREFIX');
    }

    const resume = prefix.records.length > 0
      ? restoreResumeState({
          records: prefix.records,
          correlationId: identity.correlationId,
          store,
          audit
        })
      : null;

    const stepper = createVerticalSliceStepper({
      ...verticalSliceInput,
      store,
      audit
    }, { resume });

    let checkpointHead = prefix.checkpointHead;
    while (true) {
      const checkpoint = stepper.next();
      if (!checkpoint) break;
      const persisted = await persistReferenceStageCheckpoint({
        client,
        correlationId: identity.correlationId,
        runInputHash: identity.runInputHash,
        previousCheckpointFingerprint: checkpointHead,
        checkpoint
      });
      checkpointHead = persisted.checkpointFingerprint;
      if (afterCheckpoint) await afterCheckpoint(persisted);
    }

    const result = stepper.result();
    const persistence = await archiveReferenceEvidence({ result, client });
    return Object.freeze({
      ...result,
      persistence,
      recovery: Object.freeze({
        version: POSTGRES_CHECKPOINT_RECOVERY_VERSION,
        status: prefix.records.length > 0 ? 'RESUMED_FROM_DURABLE_CHECKPOINT' : 'FRESH_CHECKPOINTED_RUN',
        resumedCheckpointCount: prefix.records.length,
        checkpointCount: VERTICAL_SLICE_STAGE_ORDER.length,
        checkpointHead,
        capitalState: 'LOCKED',
        realMoney: 'NO'
      })
    });
  } catch (cause) {
    if (cause?.message?.startsWith('POSTGRES_CHECKPOINT_')) throw cause;
    if (cause?.message?.startsWith('POSTGRES_EVIDENCE_')) throw cause;
    throw checkpointError('POSTGRES_CHECKPOINT_FAIL_CLOSED', cause);
  } finally {
    client?.release();
    if (ownedPool) await ownedPool.end();
  }
}
