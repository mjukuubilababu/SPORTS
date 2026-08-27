import fs from 'node:fs';
import { ArtifactStore } from '../src/store.mjs';
import { AuditLog } from '../src/audit.mjs';
import { runVerticalSlice } from '../src/orchestrator.mjs';

const fixture=JSON.parse(fs.readFileSync(new URL('../fixtures/controlled-match.json',import.meta.url),'utf8'));
let t=new Date('2025-05-11T03:00:00.000Z'); const clock=()=>new Date(t);
const store=new ArtifactStore(), audit=new AuditLog();
const persistenceMode=process.env.REFERENCE_EVIDENCE_PERSISTENCE_MODE ?? 'disabled';

let result;
if (persistenceMode === 'disabled') {
  result=runVerticalSlice({...fixture,store,audit,clock});
} else if (persistenceMode === 'postgres') {
  const { runVerticalSliceWithPostgresEvidence } = await import('../src/postgres-evidence.mjs');
  result=await runVerticalSliceWithPostgresEvidence({
    ...fixture,
    store,
    audit,
    clock,
    databaseUrl: process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL
  });
} else {
  throw new Error(`REFERENCE_EVIDENCE_PERSISTENCE_MODE_UNSUPPORTED:${persistenceMode}`);
}

if(result.state!=='ASSURED'||result.assurance.gate!=='PROMOTE') throw new Error('E2E_ASSURANCE_FAILED');
fs.writeFileSync(new URL('../artifacts/e2e-result.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify({
  E2E:'PASS',
  state:result.state,
  assurance:result.assurance.gate,
  decision:result.decision.decision,
  paperExecution:result.execution.id,
  settlementWon:result.settlement.won,
  brier:result.evaluation.brier,
  logLoss:result.evaluation.logLoss,
  clv:result.evaluation.clv,
  auditEvents:result.audit.length,
  traceStages:result.trace.map(x=>x.stage),
  persistence:result.persistence ?? {mode:'disabled'}
},null,2));
