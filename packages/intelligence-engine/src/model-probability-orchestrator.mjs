import { allocateReliabilityWeights } from './reliability.mjs';
import { probabilisticBrain } from './probabilistic-brain.mjs';

const VERSION='MODEL_PROBABILITY_ORCHESTRATOR_V0_1';
function parseTime(v,label){const ms=Date.parse(v);if(!Number.isFinite(ms))throw new Error(`${label}_INVALID_TIMESTAMP`);return ms;}
function assert01(label,v){if(!Number.isFinite(v)||v<0||v>1)throw new Error(`${label}_MUST_BE_0_TO_1`);return v;}
function assertPositive(label,v){if(!Number.isFinite(v)||v<=0)throw new Error(`${label}_MUST_BE_POSITIVE`);return v;}
function modelKey(m){return `${m.eventId}::${m.market}::${m.selection}`;}
function validateModel(m,{eventId,market,selection,kickoffMs}){
  if(!m?.modelVersion||!m.eventId||!m.market||!m.selection)throw new Error('MODEL_IDENTITY_REQUIRED');
  if(modelKey(m)!==`${eventId}::${market}::${selection}`)throw new Error(`MODEL_TARGET_MISMATCH_${m.modelVersion}`);
  assert01(`MODEL_PROBABILITY_${m.modelVersion}`,m.probability);
  if(m.usesMarketOdds!==false)throw new Error(`MODEL_MARKET_CIRCULARITY_FORBIDDEN_${m.modelVersion}`);
  if(!m.frozenAt||parseTime(m.frozenAt,`MODEL_FROZEN_AT_${m.modelVersion}`)>=kickoffMs)throw new Error(`MODEL_NOT_FROZEN_PREKICKOFF_${m.modelVersion}`);
  if(!m.source||!m.snapshotId||!m.snapshotSha256)throw new Error(`MODEL_PROVENANCE_REQUIRED_${m.modelVersion}`);
  if(!m.correlationFamily)throw new Error(`MODEL_CORRELATION_FAMILY_REQUIRED_${m.modelVersion}`);
  for(const k of ['baseWeight','validation','calibration','freshness','drift','availability'])assert01(`MODEL_${k.toUpperCase()}_${m.modelVersion}`,m[k]);
  return m;
}
function collapseFamily(rows){
  const weighted=allocateReliabilityWeights(rows);
  const active=weighted.filter(x=>x.canInfluence);
  const rawTotal=active.reduce((s,x)=>s+x.rawEffectiveWeight,0);
  if(rawTotal<=0)return null;
  const probability=active.reduce((s,x)=>s+x.probability*x.rawEffectiveWeight,0)/rawTotal;
  const representativeWeight=Math.min(1,Math.max(...active.map(x=>x.rawEffectiveWeight)));
  return Object.freeze({
    correlationFamily:rows[0].correlationFamily,
    probability,
    effectiveFamilyWeight:representativeWeight,
    memberCount:rows.length,
    activeMemberCount:active.length,
    members:Object.freeze(weighted.map(x=>Object.freeze({modelVersion:x.modelVersion,probability:x.probability,rawEffectiveWeight:x.rawEffectiveWeight,normalizedWithinFamilyWeight:x.normalizedWeight,snapshotId:x.snapshotId,snapshotSha256:x.snapshotSha256})))
  });
}

export function orchestrateModelProbabilities({eventId,market,selection,kickoffAt,models,offeredOdds,confidence}){
  if(!eventId||!market||!selection||!kickoffAt)throw new Error('ORCHESTRATOR_TARGET_REQUIRED');
  if(!Array.isArray(models)||!models.length)throw new Error('ORCHESTRATOR_MODELS_REQUIRED');
  assertPositive('OFFERED_ODDS',offeredOdds);
  const kickoffMs=parseTime(kickoffAt,'ORCHESTRATOR_KICKOFF');
  const versions=new Set();const snapshots=new Set();
  const valid=models.map(m=>{
    validateModel(m,{eventId,market,selection,kickoffMs});
    if(versions.has(m.modelVersion))throw new Error(`DUPLICATE_MODEL_VERSION_${m.modelVersion}`);
    if(snapshots.has(m.snapshotId))throw new Error(`DUPLICATE_MODEL_SNAPSHOT_${m.snapshotId}`);
    versions.add(m.modelVersion);snapshots.add(m.snapshotId);return m;
  });
  const byFamily=new Map();
  for(const row of valid){const a=byFamily.get(row.correlationFamily)??[];a.push(row);byFamily.set(row.correlationFamily,a);}
  const families=[...byFamily.values()].map(collapseFamily).filter(Boolean);
  if(!families.length)return Object.freeze({version:VERSION,status:'WAIT',reason:'NO_RELIABLE_MODEL_FAMILY',eventId,market,selection,realMoney:'NO'});
  const weights=families.map(f=>f.effectiveFamilyWeight);
  const probs=families.map(f=>f.probability);
  const brain=probabilisticBrain({modelProbabilities:probs,weights,offeredOdds,confidence});
  return Object.freeze({
    version:VERSION,
    status:brain.status,
    eventId,market,selection,kickoffAt,
    probability:brain.probability,
    breakEvenProbability:brain.breakEvenProbability,
    ev:brain.ev,
    evidenceMaturity:brain.evidenceMaturity,
    criticalBlocks:brain.criticalBlocks,
    familyCount:families.length,
    inputModelCount:models.length,
    families:Object.freeze(families),
    modelSnapshots:Object.freeze(valid.map(m=>Object.freeze({modelVersion:m.modelVersion,snapshotId:m.snapshotId,snapshotSha256:m.snapshotSha256,correlationFamily:m.correlationFamily,frozenAt:m.frozenAt,source:m.source}))),
    governance:Object.freeze({
      marketPriceUsedToCreateModelProbability:false,
      sameCorrelationFamilyCountsOnceAtBrainLevel:true,
      reliabilityMultipliersApplied:true,
      automaticRetuning:false,
      probabilitySeparateFromEV:true,
      capitalUnlock:false
    }),
    realMoney:'NO'
  });
}

export const MODEL_PROBABILITY_ORCHESTRATOR_VERSION=VERSION;
