import { authorize } from './security.mjs';
import { normalizeProviderEvent } from './contracts.mjs';
import { buildFeatureSnapshot } from './features.mjs';
import { infer } from './model.mjs';
import { evaluatePattern } from './pattern.mjs';
import { decide, buildQualifiedSet } from './decision.mjs';
import { deepFreeze } from './utils.mjs';

export function analyzeQualificationCandidate({rawEvent,rawFeatures,lineupGate='PASS'},{clock}={}){
  authorize('svc.ingestion','event:ingest');
  const event=normalizeProviderEvent(rawEvent,{clock});
  authorize('svc.pipeline','feature:write');
  const features=buildFeatureSnapshot(event,rawFeatures,{clock});
  authorize('svc.pipeline','model:infer');
  const prediction=infer(event,features,{clock});
  authorize('svc.pipeline','pattern:evaluate');
  const pattern=evaluatePattern(event,prediction,lineupGate,{clock});
  authorize('svc.pipeline','decision:evaluate');
  const decision=decide(event,pattern,{clock});
  return deepFreeze({event,features,prediction,pattern,decision});
}

export function scanQualificationUniverse({candidates},{clock}={}){
  if(!Array.isArray(candidates)) throw new Error('CANDIDATES_MUST_BE_ARRAY');
  const analyses=candidates.map(candidate=>analyzeQualificationCandidate(candidate,{clock}));
  return buildQualifiedSet(analyses,{clock});
}
