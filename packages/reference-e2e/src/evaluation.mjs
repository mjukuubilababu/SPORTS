import { deepFreeze, id, nowIso } from './utils.mjs';
export function evaluate(prediction,pattern,execution,settlement,{closingPrice=null}={}, {clock}={}){
  const y=settlement.won?1:0,p=prediction.probabilityUnder35;
  const brier=(p-y)**2;
  const eps=1e-12,pp=Math.min(1-eps,Math.max(eps,p));
  const logLoss=-(y*Math.log(pp)+(1-y)*Math.log(1-pp));
  const clv=closingPrice?((execution.entryPrice/closingPrice)-1):null;
  return deepFreeze({id:id('eval',[settlement.id,prediction.id]),eventId:settlement.eventId,predictionId:prediction.id,patternId:pattern.id,settlementId:settlement.id,brier,logLoss,clv,pnl:settlement.pnl,createdAt:nowIso(clock)});
}
