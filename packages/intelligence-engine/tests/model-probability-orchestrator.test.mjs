import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateModelProbabilities } from '../src/model-probability-orchestrator.mjs';

const base={
  eventId:'MLS-E1',market:'TOTAL_GOALS_3_5',selection:'UNDER_3_5',kickoffAt:'2026-08-25T00:00:00Z',offeredOdds:1.72,
  confidence:{score:78,criticalBlocks:0}
};
function model(modelVersion,probability,correlationFamily,overrides={}){
  return {modelVersion,eventId:'MLS-E1',market:'TOTAL_GOALS_3_5',selection:'UNDER_3_5',probability,correlationFamily,
    frozenAt:'2026-08-24T23:00:00Z',source:'VERIFIED_MODEL_PIPELINE',snapshotId:`SNAP-${modelVersion}`,snapshotSha256:'a'.repeat(64),usesMarketOdds:false,
    baseWeight:.8,validation:.8,calibration:.8,freshness:1,drift:.9,availability:1,...overrides};
}

test('aggregates independent Poisson and Negative Binomial families then delegates to brain',()=>{
  const out=orchestrateModelProbabilities({...base,models:[model('POISSON',.56,'COUNT_POISSON'),model('NEGBIN',.60,'COUNT_NEGBIN')]});
  assert.equal(out.status,'PAPER_ONLY');
  assert.equal(out.familyCount,2);
  assert.equal(out.inputModelCount,2);
  assert.ok(out.probability>.56&&out.probability<.60);
  assert.equal(out.governance.marketPriceUsedToCreateModelProbability,false);
  assert.equal(out.realMoney,'NO');
});

test('correlated model variants are collapsed before brain weighting',()=>{
  const out=orchestrateModelProbabilities({...base,models:[
    model('POISSON-A',.50,'POISSON_FAMILY'),model('POISSON-B',.70,'POISSON_FAMILY',{baseWeight:.4}),model('NEGBIN',.60,'NEGBIN_FAMILY')
  ]});
  assert.equal(out.familyCount,2);
  const family=out.families.find(x=>x.correlationFamily==='POISSON_FAMILY');
  assert.equal(family.memberCount,2);
  assert.equal(family.activeMemberCount,2);
  assert.ok(family.probability>.50&&family.probability<.70);
  assert.equal(out.governance.sameCorrelationFamilyCountsOnceAtBrainLevel,true);
});

test('zero-reliability models cannot influence and all-zero families wait',()=>{
  const out=orchestrateModelProbabilities({...base,models:[model('UNVALIDATED',.99,'X',{validation:0})]});
  assert.equal(out.status,'WAIT');
  assert.equal(out.reason,'NO_RELIABLE_MODEL_FAMILY');
  assert.equal(out.realMoney,'NO');
});

test('market-derived model probability is forbidden',()=>{
  assert.throws(()=>orchestrateModelProbabilities({...base,models:[model('BAD',.60,'X',{usesMarketOdds:true})]}),/MODEL_MARKET_CIRCULARITY_FORBIDDEN_BAD/);
});

test('model identity must match event market and selection',()=>{
  assert.throws(()=>orchestrateModelProbabilities({...base,models:[model('BAD',.60,'X',{eventId:'OTHER'})]}),/MODEL_TARGET_MISMATCH_BAD/);
  assert.throws(()=>orchestrateModelProbabilities({...base,models:[model('BAD2',.60,'X',{selection:'OVER_3_5'})]}),/MODEL_TARGET_MISMATCH_BAD2/);
});

test('model snapshots must be immutable prematch observations',()=>{
  assert.throws(()=>orchestrateModelProbabilities({...base,models:[model('LATE',.60,'X',{frozenAt:'2026-08-25T00:00:00Z'})]}),/MODEL_NOT_FROZEN_PREKICKOFF_LATE/);
  assert.throws(()=>orchestrateModelProbabilities({...base,models:[model('NOPROV',.60,'X',{snapshotSha256:''})]}),/MODEL_PROVENANCE_REQUIRED_NOPROV/);
});

test('duplicate model versions and snapshot ids fail closed',()=>{
  assert.throws(()=>orchestrateModelProbabilities({...base,models:[model('DUP',.55,'A'),model('DUP',.60,'B',{snapshotId:'OTHER'})]}),/DUPLICATE_MODEL_VERSION_DUP/);
  assert.throws(()=>orchestrateModelProbabilities({...base,models:[model('A',.55,'A',{snapshotId:'SAME'}),model('B',.60,'B',{snapshotId:'SAME'})]}),/DUPLICATE_MODEL_SNAPSHOT_SAME/);
});

test('reliability multipliers change influence without changing source probabilities',()=>{
  const high=model('A',.70,'A',{baseWeight:1,validation:1,calibration:1,freshness:1,drift:1,availability:1});
  const low=model('B',.40,'B',{baseWeight:1,validation:.2,calibration:.5,freshness:1,drift:1,availability:1});
  const out=orchestrateModelProbabilities({...base,models:[high,low]});
  assert.ok(out.probability>.60);
  assert.equal(out.modelSnapshots.length,2);
});

test('offered odds affect EV but never source model probabilities',()=>{
  const models=[model('POISSON',.58,'P'),model('NEGBIN',.62,'N')];
  const a=orchestrateModelProbabilities({...base,offeredOdds:1.60,models});
  const b=orchestrateModelProbabilities({...base,offeredOdds:2.00,models});
  assert.equal(a.probability,b.probability);
  assert.notEqual(a.ev,b.ev);
});
