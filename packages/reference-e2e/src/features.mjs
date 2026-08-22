import { FEATURE_VERSION } from './constants.mjs';
import { deepFreeze, id, nowIso } from './utils.mjs';
export function buildFeatureSnapshot(event, rawFeatures,{clock}={}){
  if(!rawFeatures || !Number.isFinite(rawFeatures.lambdaBase)) throw new Error('FEATURE_INPUT_MISSING:lambdaBase');
  const snapshot={
    id:id('feat',[event.id,FEATURE_VERSION,event.observedAt]),eventId:event.id,featureVersion:FEATURE_VERSION,
    asOf:event.observedAt,lambdaBase:Number(rawFeatures.lambdaBase),
    homePriorN:Number(rawFeatures.homePriorN??0),awayPriorN:Number(rawFeatures.awayPriorN??0),
    lineupState:String(rawFeatures.lineupState||'STABLE'),lineupAdjustment:Number(rawFeatures.lineupAdjustment??0),
    createdAt:nowIso(clock)
  };
  if(new Date(snapshot.asOf)>=new Date(event.kickoffAt)) throw new Error('FEATURE_LEAKAGE');
  return deepFreeze(snapshot);
}
