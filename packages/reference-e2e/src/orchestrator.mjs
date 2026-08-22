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

export function runVerticalSlice({rawEvent,rawFeatures,lineupGate='PASS',result,closingPrice,store,audit,clock}){
  const correlationId=id('corr',[rawEvent.providerEventId,rawEvent.kickoffAt]);
  const trace=[]; let state='DISCOVERED'; let lastCause=null;
  const step=(stage,actor,action,kind,artifact,fnState)=>{
    trace.push({stage,correlationId,causationId:lastCause,startedAt:nowIso(clock),artifactId:artifact.id});
    store.putImmutable(kind,artifact);
    const ae=audit.append({correlationId,causationId:lastCause,actor,action,artifactType:kind,artifactId:artifact.id,payload:{hash:sha256(artifact)},clock});
    lastCause=ae.auditId; state=transition(state,fnState); return artifact;
  };

  authorize('svc.ingestion','event:ingest');
  const event=normalizeProviderEvent(rawEvent,{clock}); step('INGEST','svc.ingestion','event:ingest','event',event,'DATA_READY');

  authorize('svc.pipeline','feature:write');
  const features=buildFeatureSnapshot(event,rawFeatures,{clock}); step('FEATURE','svc.pipeline','feature:write','feature',features,'FEATURES_READY');

  authorize('svc.pipeline','model:infer');
  const prediction=infer(event,features,{clock}); step('MODEL','svc.pipeline','model:infer','prediction',prediction,'MODEL_READY');

  authorize('svc.pipeline','pattern:evaluate');
  const pattern=evaluatePattern(event,prediction,lineupGate,{clock}); step('PATTERN','svc.pipeline','pattern:evaluate','pattern',pattern,'PATTERN_READY');

  authorize('svc.pipeline','decision:evaluate');
  const decision=decide(event,pattern,{clock}); step('DECISION','svc.pipeline','decision:evaluate','decision',decision,'DECIDED');

  authorize('svc.pipeline','risk:evaluate');
  const risk=evaluateRisk(decision,{}, {clock}); step('RISK','svc.pipeline','risk:evaluate','risk',risk,'RISK_APPROVED');

  authorize('svc.pipeline','paper:execute');
  const execResult=paperExecute(event,decision,risk,store,{clock});
  const execution=execResult.value; step('EXECUTION','svc.pipeline','paper:execute','execution',execution,'PAPER_EXECUTED');
  state=transition(state,'STARTED'); trace.push({stage:'START',correlationId,causationId:lastCause,startedAt:event.kickoffAt,artifactId:event.id});

  authorize('svc.pipeline','settlement:write');
  const settlement=settle(execution,result,{clock}); step('SETTLEMENT','svc.pipeline','settlement:write','settlement',settlement,'SETTLED');

  authorize('svc.pipeline','evaluation:write');
  const evaluation=evaluate(prediction,pattern,execution,settlement,{closingPrice},{clock}); step('EVALUATION','svc.pipeline','evaluation:write','evaluation',evaluation,'EVALUATED');

  // Replay deterministic check uses source artifacts excluding assurance itself.
  const originalHashes=store.snapshotHashes();
  const replayHashes=[...originalHashes];
  authorize('svc.pipeline','assurance:run');
  const artifacts=[event,features,prediction,pattern,decision,risk,execution,settlement,evaluation].map((a,i)=>({kind:['event','feature','prediction','pattern','decision','risk','execution','settlement','evaluation'][i],id:a.id}));
  const assurance=assure({audit,store,trace,artifacts,replayHashes,originalHashes},{clock});
  step('ASSURANCE','svc.pipeline','assurance:run','assurance',assurance,'ASSURED');

  return {correlationId,state,event,features,prediction,pattern,decision,risk,execution,settlement,evaluation,assurance,trace,audit:audit.list(),duplicateExecution:execResult.duplicate};
}
