import { deepFreeze, id, nowIso } from './utils.mjs';
export function settle(execution,result,{clock}={}){
  if(!Number.isInteger(result.homeGoals)||!Number.isInteger(result.awayGoals)) throw new Error('INVALID_RESULT');
  const total=result.homeGoals+result.awayGoals;
  const won=total<=3;
  const pnl=won?execution.stake*(execution.entryPrice-1):-execution.stake;
  return deepFreeze({id:id('set',[execution.id,result.homeGoals,result.awayGoals]),executionId:execution.id,eventId:execution.eventId,homeGoals:result.homeGoals,awayGoals:result.awayGoals,totalGoals:total,won,pnl,officialSource:result.officialSource,settledAt:nowIso(clock)});
}
