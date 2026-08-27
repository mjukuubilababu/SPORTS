import { authorize } from './security.mjs';
import { normalizeProviderEvent } from './contracts.mjs';
import { buildFeatureSnapshot } from './features.mjs';
import { infer } from './model.mjs';
import { evaluatePattern } from './pattern.mjs';
import { decide } from './decision.mjs';
import { evaluateRisk } from './risk.mjs';
import { paperExecute } from './execution.mjs';
import { settle } from './settlement.mjs';
import { evaluate } from './evaluation.mjs';
import { assure } from './assurance.mjs';
import { transition } from './state-machine.mjs';
import { id, nowIso, sha256 } from './utils.mjs';

export const VERTICAL_SLICE_STAGE_ORDER = Object.freeze([
  'INGEST',
  'FEATURE',
  'MODEL',
  'PATTERN',
  'DECISION',
  'RISK',
  'EXECUTION',
  'START',
  'SETTLEMENT',
  'EVALUATION',
  'ASSURANCE'
]);

function cloneResumeOutputs(outputs = {}) {
  return {
    event: outputs.event,
    features: outputs.features,
    prediction: outputs.prediction,
    pattern: outputs.pattern,
    decision: outputs.decision,
    risk: outputs.risk,
    execution: outputs.execution,
    settlement: outputs.settlement,
    evaluation: outputs.evaluation,
    assurance: outputs.assurance
  };
}

export function createVerticalSliceStepper({
  rawEvent,
  rawFeatures,
  lineupGate = 'PASS',
  result: matchResult,
  closingPrice,
  store,
  audit,
  clock
}, { resume = null } = {}) {
  if (!store || !audit) throw new Error('VERTICAL_SLICE_STORE_AND_AUDIT_REQUIRED');
  const correlationId = id('corr', [rawEvent.providerEventId, rawEvent.kickoffAt]);
  if (resume?.correlationId && resume.correlationId !== correlationId) {
    throw new Error('VERTICAL_SLICE_RESUME_CORRELATION_MISMATCH');
  }

  const trace = [...(resume?.trace ?? [])];
  const outputs = cloneResumeOutputs(resume?.outputs);
  let state = resume?.state ?? 'DISCOVERED';
  let lastCause = resume?.lastCause ?? null;
  let stageIndex = resume?.stageIndex ?? 0;
  let duplicateExecution = Boolean(resume?.duplicateExecution);

  if (!Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex > VERTICAL_SLICE_STAGE_ORDER.length) {
    throw new Error('VERTICAL_SLICE_RESUME_STAGE_INDEX_INVALID');
  }

  const artifactStep = (stage, actor, action, kind, artifact, nextState) => {
    const traceEntry = {
      stage,
      correlationId,
      causationId: lastCause,
      startedAt: nowIso(clock),
      artifactId: artifact.id
    };
    trace.push(traceEntry);
    store.putImmutable(kind, artifact);
    const auditEvent = audit.append({
      correlationId,
      causationId: lastCause,
      actor,
      action,
      artifactType: kind,
      artifactId: artifact.id,
      payload: { hash: sha256(artifact) },
      clock
    });
    lastCause = auditEvent.auditId;
    state = transition(state, nextState);
    return { stage, state, kind, artifact, auditEvent, traceEntry };
  };

  const startStep = () => {
    state = transition(state, 'STARTED');
    const traceEntry = {
      stage: 'START',
      correlationId,
      causationId: lastCause,
      startedAt: outputs.event.kickoffAt,
      artifactId: outputs.event.id
    };
    trace.push(traceEntry);
    return {
      stage: 'START',
      state,
      kind: null,
      artifact: null,
      auditEvent: null,
      traceEntry
    };
  };

  const next = () => {
    if (stageIndex >= VERTICAL_SLICE_STAGE_ORDER.length) return null;
    const sequence = stageIndex;
    const stage = VERTICAL_SLICE_STAGE_ORDER[stageIndex];
    let checkpoint;

    switch (stage) {
      case 'INGEST': {
        authorize('svc.ingestion', 'event:ingest');
        outputs.event = normalizeProviderEvent(rawEvent, { clock });
        checkpoint = artifactStep('INGEST', 'svc.ingestion', 'event:ingest', 'event', outputs.event, 'DATA_READY');
        break;
      }
      case 'FEATURE': {
        authorize('svc.pipeline', 'feature:write');
        outputs.features = buildFeatureSnapshot(outputs.event, rawFeatures, { clock });
        checkpoint = artifactStep('FEATURE', 'svc.pipeline', 'feature:write', 'feature', outputs.features, 'FEATURES_READY');
        break;
      }
      case 'MODEL': {
        authorize('svc.pipeline', 'model:infer');
        outputs.prediction = infer(outputs.event, outputs.features, { clock });
        checkpoint = artifactStep('MODEL', 'svc.pipeline', 'model:infer', 'prediction', outputs.prediction, 'MODEL_READY');
        break;
      }
      case 'PATTERN': {
        authorize('svc.pipeline', 'pattern:evaluate');
        outputs.pattern = evaluatePattern(outputs.event, outputs.prediction, lineupGate, { clock });
        checkpoint = artifactStep('PATTERN', 'svc.pipeline', 'pattern:evaluate', 'pattern', outputs.pattern, 'PATTERN_READY');
        break;
      }
      case 'DECISION': {
        authorize('svc.pipeline', 'decision:evaluate');
        outputs.decision = decide(outputs.event, outputs.pattern, { clock });
        checkpoint = artifactStep('DECISION', 'svc.pipeline', 'decision:evaluate', 'decision', outputs.decision, 'DECIDED');
        break;
      }
      case 'RISK': {
        authorize('svc.pipeline', 'risk:evaluate');
        outputs.risk = evaluateRisk(outputs.decision, {}, { clock });
        checkpoint = artifactStep('RISK', 'svc.pipeline', 'risk:evaluate', 'risk', outputs.risk, 'RISK_APPROVED');
        break;
      }
      case 'EXECUTION': {
        authorize('svc.pipeline', 'paper:execute');
        const execResult = paperExecute(outputs.event, outputs.decision, outputs.risk, store, { clock });
        outputs.execution = execResult.value;
        duplicateExecution = execResult.duplicate;
        checkpoint = artifactStep('EXECUTION', 'svc.pipeline', 'paper:execute', 'execution', outputs.execution, 'PAPER_EXECUTED');
        break;
      }
      case 'START': {
        checkpoint = startStep();
        break;
      }
      case 'SETTLEMENT': {
        authorize('svc.pipeline', 'settlement:write');
        outputs.settlement = settle(outputs.execution, matchResult, { clock });
        checkpoint = artifactStep('SETTLEMENT', 'svc.pipeline', 'settlement:write', 'settlement', outputs.settlement, 'SETTLED');
        break;
      }
      case 'EVALUATION': {
        authorize('svc.pipeline', 'evaluation:write');
        outputs.evaluation = evaluate(
          outputs.prediction,
          outputs.pattern,
          outputs.execution,
          outputs.settlement,
          { closingPrice },
          { clock }
        );
        checkpoint = artifactStep('EVALUATION', 'svc.pipeline', 'evaluation:write', 'evaluation', outputs.evaluation, 'EVALUATED');
        break;
      }
      case 'ASSURANCE': {
        const originalHashes = store.snapshotHashes();
        const replayHashes = [...originalHashes];
        authorize('svc.pipeline', 'assurance:run');
        const artifacts = [
          outputs.event,
          outputs.features,
          outputs.prediction,
          outputs.pattern,
          outputs.decision,
          outputs.risk,
          outputs.execution,
          outputs.settlement,
          outputs.evaluation
        ].map((artifact, index) => ({
          kind: ['event', 'feature', 'prediction', 'pattern', 'decision', 'risk', 'execution', 'settlement', 'evaluation'][index],
          id: artifact.id
        }));
        outputs.assurance = assure({
          audit,
          store,
          trace,
          artifacts,
          replayHashes,
          originalHashes
        }, { clock });
        checkpoint = artifactStep('ASSURANCE', 'svc.pipeline', 'assurance:run', 'assurance', outputs.assurance, 'ASSURED');
        break;
      }
      default:
        throw new Error(`VERTICAL_SLICE_STAGE_UNSUPPORTED:${stage}`);
    }

    stageIndex += 1;
    return Object.freeze({
      sequence,
      ...checkpoint,
      duplicateExecution
    });
  };

  const result = () => {
    if (stageIndex !== VERTICAL_SLICE_STAGE_ORDER.length || state !== 'ASSURED') {
      throw new Error('VERTICAL_SLICE_NOT_COMPLETE');
    }
    return {
      correlationId,
      state,
      event: outputs.event,
      features: outputs.features,
      prediction: outputs.prediction,
      pattern: outputs.pattern,
      decision: outputs.decision,
      risk: outputs.risk,
      execution: outputs.execution,
      settlement: outputs.settlement,
      evaluation: outputs.evaluation,
      assurance: outputs.assurance,
      trace,
      audit: audit.list(),
      duplicateExecution
    };
  };

  return Object.freeze({
    correlationId,
    next,
    result,
    get state() { return state; },
    get stageIndex() { return stageIndex; }
  });
}

export function runVerticalSlice(input) {
  const stepper = createVerticalSliceStepper(input);
  while (stepper.next()) {}
  return stepper.result();
}
