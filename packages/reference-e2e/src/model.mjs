import { MODEL_VERSION } from './constants.mjs';
import { deepFreeze, id, nowIso } from './utils.mjs';
export function poissonUnder35(lambda){ let p=0; for(let k=0;k<=3;k++) p += Math.exp(-lambda)*(lambda**k)/factorial(k); return p; }
function factorial(n){ let x=1; for(let i=2;i<=n;i++)x*=i; return x; }
export function infer(event,features,{clock}={}){
  const lambda=features.lambdaBase+features.lineupAdjustment;
  if(!(lambda>0)) throw new Error('INVALID_LAMBDA');
  const probabilityUnder35=poissonUnder35(lambda);
  return deepFreeze({id:id('pred',[event.id,MODEL_VERSION,features.id]),eventId:event.id,modelVersion:MODEL_VERSION,featureSnapshotId:features.id,lambda,probabilityUnder35,createdAt:nowIso(clock)});
}
