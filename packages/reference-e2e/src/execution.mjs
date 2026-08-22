import { deepFreeze, id, nowIso } from './utils.mjs';
export function paperExecute(event,decision,risk,store,{clock}={}){
  if(!risk.allowed) throw new Error('EXECUTION_NOT_ALLOWED');
  const effectKey=`paper:${event.id}:${decision.id}`;
  return store.exactlyOnce(effectKey,()=>deepFreeze({
    id:id('exec',[event.id,decision.id,'PAPER']),eventId:event.id,decisionId:decision.id,riskId:risk.id,
    mode:'PAPER',market:'UNDER_3_5',entryPrice:event.market.u35,stake:risk.stake,executedAt:nowIso(clock),effectKey
  }));
}
