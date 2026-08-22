import { RISK_POLICY_VERSION } from './constants.mjs';
import { deepFreeze, id, nowIso } from './utils.mjs';
export function evaluateRisk(decision,{mode='PAPER_ONLY',bankroll=1_000_000,currentExposure=0,maxExposurePct=0.01,stakePct=0.0025}={}, {clock}={}){
  const qualified=decision.decision==='QUALIFIED';
  const stake=Math.round(bankroll*stakePct);
  const projected=currentExposure+stake;
  const exposureOk=projected<=bankroll*maxExposurePct;
  const allowed=qualified&&exposureOk&&mode==='PAPER_ONLY';
  return deepFreeze({id:id('risk',[decision.id,RISK_POLICY_VERSION]),decisionId:decision.id,riskPolicyVersion:RISK_POLICY_VERSION,mode,allowed,stake:allowed?stake:0,reason:!qualified?'DECISION_NOT_QUALIFIED':!exposureOk?'EXPOSURE_LIMIT':mode!=='PAPER_ONLY'?'REAL_CAPITAL_LOCKED':'PAPER_APPROVED',createdAt:nowIso(clock)});
}

// Portfolio risk is deliberately downstream of qualification. It may restrict
// execution, but it never removes or rewrites a signal from QualifiedSet.
export function evaluateQualifiedSetRisk(qualifiedSet,options={}, {clock}={}){
  if(!qualifiedSet || !Array.isArray(qualifiedSet.qualifiedSignals)) throw new Error('INVALID_QUALIFIED_SET');
  let currentExposure=Number(options.currentExposure??0);
  const items=[];
  for(const signal of qualifiedSet.qualifiedSignals){
    const decision={id:signal.decisionId,decision:'QUALIFIED'};
    const risk=evaluateRisk(decision,{...options,currentExposure},{clock});
    if(risk.allowed) currentExposure+=risk.stake;
    items.push(deepFreeze({signalKey:signal.signalKey,decisionId:signal.decisionId,qualificationStatus:'QUALIFIED',risk}));
  }
  return deepFreeze({
    qualifiedSetId:qualifiedSet.id,
    qualifiedCount:qualifiedSet.qualifiedCount,
    executableCount:items.filter(x=>x.risk.allowed).length,
    restrictedCount:items.filter(x=>!x.risk.allowed).length,
    qualificationHistoryPreserved:true,
    items
  });
}
