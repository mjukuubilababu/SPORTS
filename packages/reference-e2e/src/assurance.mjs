import { deepFreeze, id, nowIso } from './utils.mjs';
export function assure({audit,store,trace,artifacts,replayHashes,originalHashes},{clock}={}){
  const checks={
    auditChain:audit.verifyChain(),
    traceComplete:['INGEST','FEATURE','MODEL','PATTERN','DECISION','RISK','EXECUTION','SETTLEMENT','EVALUATION'].every(s=>trace.some(t=>t.stage===s)),
    immutableArtifacts:artifacts.every(({kind,id})=>Boolean(store.get(kind,id))),
    replayDeterministic:JSON.stringify(replayHashes)===JSON.stringify(originalHashes),
    noDuplicateExecution:store.all('execution').length===1,
  };
  const passed=Object.values(checks).every(Boolean);
  return deepFreeze({id:id('assure',[artifacts[0]?.id||'none',JSON.stringify(checks)]),gate:passed?'PROMOTE':'BLOCK',checks,createdAt:nowIso(clock)});
}
