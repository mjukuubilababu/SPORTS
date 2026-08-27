import { Pool } from 'pg';
import { runVerticalSlice } from './orchestrator.mjs';
import { sha256 } from './utils.mjs';

export const POSTGRES_EVIDENCE_VERSION = 'v0.1';
export const REFERENCE_EVIDENCE_ARTIFACT_FIELDS = Object.freeze([
  'event',
  'features',
  'prediction',
  'pattern',
  'decision',
  'risk',
  'execution',
  'settlement',
  'evaluation',
  'assurance'
]);

function evidenceError(code, cause) {
  const error = new Error(code);
  if (cause) error.cause = cause;
  return error;
}

function artifactRows(result) {
  return REFERENCE_EVIDENCE_ARTIFACT_FIELDS.map((field) => {
    const artifact = result[field];
    if (!artifact?.id) throw evidenceError(`POSTGRES_EVIDENCE_ARTIFACT_MISSING:${field}`);
    return {
      artifactType: field === 'features' ? 'feature' : field,
      artifact,
      contentHash: sha256(artifact),
      eventId: field === 'event' ? artifact.id : (artifact.eventId ?? result.event?.id ?? null)
    };
  });
}

export function verifyEvidenceAuditChain(events) {
  if (!Array.isArray(events) || events.length === 0) return false;
  let previousHash = 'GENESIS';
  for (let sequence = 0; sequence < events.length; sequence += 1) {
    const event = events[sequence];
    if (event.sequence !== sequence || event.previousHash !== previousHash) return false;
    const { eventHash, ...base } = event;
    if (sha256(base) !== eventHash) return false;
    previousHash = eventHash;
  }
  return true;
}

function buildArchiveIdentity(result, artifacts) {
  const artifactSet = artifacts
    .map(({ artifactType, artifact, contentHash }) => `${artifactType}:${artifact.id}:${contentHash}`)
    .sort();
  const auditEventHashes = result.audit
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((event) => event.eventHash);
  const artifactSetHash = sha256(artifactSet);
  const auditChainHead = auditEventHashes.at(-1);
  const archiveFingerprint = sha256({
    correlationId: result.correlationId,
    artifactSet,
    auditEventHashes
  });
  return { artifactSetHash, auditChainHead, archiveFingerprint };
}

async function verifyExistingArtifact(client, row) {
  const existing = await client.query(
    `SELECT correlation_id, content_hash, payload_json
       FROM reference_artifacts_v01
      WHERE artifact_type=$1 AND artifact_id=$2`,
    [row.artifactType, row.artifact.id]
  );
  if (existing.rowCount !== 1) throw evidenceError('POSTGRES_EVIDENCE_ARTIFACT_READBACK_MISSING');
  const record = existing.rows[0];
  if (record.content_hash !== row.contentHash || sha256(record.payload_json) !== row.contentHash) {
    throw evidenceError(`POSTGRES_EVIDENCE_ARTIFACT_IMMUTABILITY_CONFLICT:${row.artifactType}:${row.artifact.id}`);
  }
}

async function verifyExistingAuditEvent(client, event) {
  const existing = await client.query(
    `SELECT event_hash, previous_hash, sequence, event_json
       FROM reference_audit_events_v01
      WHERE audit_id=$1`,
    [event.auditId]
  );
  if (existing.rowCount !== 1) throw evidenceError('POSTGRES_EVIDENCE_AUDIT_READBACK_MISSING');
  const record = existing.rows[0];
  const { eventHash, ...base } = record.event_json;
  if (
    record.event_hash !== event.eventHash ||
    record.previous_hash !== event.previousHash ||
    Number(record.sequence) !== event.sequence ||
    eventHash !== event.eventHash ||
    sha256(base) !== event.eventHash
  ) {
    throw evidenceError(`POSTGRES_EVIDENCE_AUDIT_IMMUTABILITY_CONFLICT:${event.auditId}`);
  }
}

export async function archiveReferenceEvidence({ result, client }) {
  if (!client?.query) throw evidenceError('POSTGRES_EVIDENCE_CLIENT_REQUIRED');
  if (!result?.correlationId || result.state !== 'ASSURED') {
    throw evidenceError('POSTGRES_EVIDENCE_COMPLETED_ASSURED_RUN_REQUIRED');
  }
  if (!verifyEvidenceAuditChain(result.audit)) {
    throw evidenceError('POSTGRES_EVIDENCE_AUDIT_CHAIN_INVALID');
  }

  const artifacts = artifactRows(result);
  if (result.audit.length !== artifacts.length) {
    throw evidenceError('POSTGRES_EVIDENCE_ARTIFACT_AUDIT_CARDINALITY_MISMATCH');
  }
  const identity = buildArchiveIdentity(result, artifacts);

  await client.query('BEGIN');
  try {
    for (const row of artifacts) {
      await client.query(
        `INSERT INTO reference_artifacts_v01(
           correlation_id, artifact_type, artifact_id, event_id, content_hash, payload_json,
           capital_state, real_money
         ) VALUES($1,$2,$3,$4,$5,$6::jsonb,'LOCKED','NO')
         ON CONFLICT (artifact_type, artifact_id) DO NOTHING`,
        [
          result.correlationId,
          row.artifactType,
          row.artifact.id,
          row.eventId,
          row.contentHash,
          JSON.stringify(row.artifact)
        ]
      );
      await verifyExistingArtifact(client, row);
    }

    for (const event of result.audit.slice().sort((a, b) => a.sequence - b.sequence)) {
      await client.query(
        `INSERT INTO reference_audit_events_v01(
           audit_id, correlation_id, causation_id, actor, action, artifact_type, artifact_id,
           sequence, previous_hash, event_hash, occurred_at, event_json, capital_state, real_money
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,'LOCKED','NO')
         ON CONFLICT (audit_id) DO NOTHING`,
        [
          event.auditId,
          event.correlationId,
          event.causationId,
          event.actor,
          event.action,
          event.artifactType,
          event.artifactId,
          event.sequence,
          event.previousHash,
          event.eventHash,
          event.occurredAt,
          JSON.stringify(event)
        ]
      );
      await verifyExistingAuditEvent(client, event);
    }

    await client.query(
      `INSERT INTO reference_evidence_runs_v01(
         correlation_id, state, assurance_gate, artifact_count, audit_event_count,
         artifact_set_hash, audit_chain_head, archive_fingerprint, capital_state, real_money
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'LOCKED','NO')
       ON CONFLICT (correlation_id) DO NOTHING`,
      [
        result.correlationId,
        result.state,
        result.assurance?.gate ?? null,
        artifacts.length,
        result.audit.length,
        identity.artifactSetHash,
        identity.auditChainHead,
        identity.archiveFingerprint
      ]
    );

    const runReadback = await client.query(
      `SELECT state, assurance_gate, artifact_count, audit_event_count,
              artifact_set_hash, audit_chain_head, archive_fingerprint, capital_state, real_money
         FROM reference_evidence_runs_v01
        WHERE correlation_id=$1`,
      [result.correlationId]
    );
    if (runReadback.rowCount !== 1) throw evidenceError('POSTGRES_EVIDENCE_RUN_READBACK_MISSING');
    const stored = runReadback.rows[0];
    if (
      stored.state !== result.state ||
      stored.assurance_gate !== (result.assurance?.gate ?? null) ||
      Number(stored.artifact_count) !== artifacts.length ||
      Number(stored.audit_event_count) !== result.audit.length ||
      stored.artifact_set_hash !== identity.artifactSetHash ||
      stored.audit_chain_head !== identity.auditChainHead ||
      stored.archive_fingerprint !== identity.archiveFingerprint ||
      stored.capital_state !== 'LOCKED' ||
      stored.real_money !== 'NO'
    ) {
      throw evidenceError(`POSTGRES_EVIDENCE_RUN_IMMUTABILITY_CONFLICT:${result.correlationId}`);
    }

    await client.query('COMMIT');
    return Object.freeze({
      version: POSTGRES_EVIDENCE_VERSION,
      mode: 'postgres',
      status: 'DURABLY_ARCHIVED',
      correlationId: result.correlationId,
      artifactCount: artifacts.length,
      auditEventCount: result.audit.length,
      artifactSetHash: identity.artifactSetHash,
      auditChainHead: identity.auditChainHead,
      archiveFingerprint: identity.archiveFingerprint,
      capitalState: 'LOCKED',
      realMoney: 'NO'
    });
  } catch (cause) {
    await client.query('ROLLBACK').catch(() => {});
    if (cause?.code === '23505') throw evidenceError('POSTGRES_EVIDENCE_UNIQUE_CONFLICT', cause);
    if (cause?.message?.startsWith('POSTGRES_EVIDENCE_')) throw cause;
    throw evidenceError('POSTGRES_EVIDENCE_TRANSACTION_FAILED', cause);
  }
}

export async function runVerticalSliceWithPostgresEvidence({
  databaseUrl = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL,
  pool = null,
  ...verticalSliceInput
}) {
  if (!pool && !databaseUrl) throw evidenceError('POSTGRES_EVIDENCE_DATABASE_URL_REQUIRED');
  const ownedPool = pool ? null : new Pool({ connectionString: databaseUrl });
  const effectivePool = pool ?? ownedPool;
  let client;
  try {
    client = await effectivePool.connect();
    await client.query('SELECT 1');
    const result = runVerticalSlice(verticalSliceInput);
    const persistence = await archiveReferenceEvidence({ result, client });
    return Object.freeze({ ...result, persistence });
  } catch (cause) {
    if (cause?.message?.startsWith('POSTGRES_EVIDENCE_')) throw cause;
    throw evidenceError('POSTGRES_EVIDENCE_FAIL_CLOSED', cause);
  } finally {
    client?.release();
    if (ownedPool) await ownedPool.end();
  }
}
