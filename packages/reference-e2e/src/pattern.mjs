import { P002, RULES_VERSION } from './constants.mjs';
import { deepFreeze, id, nowIso } from './utils.mjs';
export function devigUnder35(o35,u35){ const a=1/o35,b=1/u35; return b/(a+b); }
export function evaluatePattern(event,prediction,lineupGate='PASS',{clock}={}){
  const m=event.market;
  const priceGate=m.o25<=P002.o25Max && m.u35>=P002.u35Min && m.u35<=P002.u35Max;
  const lambdaGate=prediction.lambda>=P002.lambdaMin && prediction.lambda<=P002.lambdaMax;
  const marketFairUnder35=devigUnder35(m.o35,m.u35);
  const rawEdgePp=(prediction.probabilityUnder35-marketFairUnder35)*100;
  const edgeGate=rawEdgePp>=P002.rawEdgePpMin;
  const lineupPass=lineupGate==='PASS';
  const passed=priceGate&&lambdaGate&&edgeGate&&lineupPass;
  return deepFreeze({
    id:id('pat',[event.id,RULES_VERSION,prediction.id]),eventId:event.id,rulesVersion:RULES_VERSION,
    priceGate,lambdaGate,edgeGate,lineupGate,marketFairUnder35,rawEdgePp,passed,
    evaluatedAt:nowIso(clock)
  });
}
