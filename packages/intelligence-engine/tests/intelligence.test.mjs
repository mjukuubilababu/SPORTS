import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exactTargetLineAnchor, surfaceDisagreement, resolveSourceQuorum, evaluateConfidenceBudget,
  allocateReliabilityWeights, EvidenceGraph, learningResponse, compareChallenger,
  selfEvaluate, probabilisticBrain, proposeLearningChange, RESEARCH_CHALLENGERS
} from '../src/index.mjs';

test('target market uses direct same-provider U3.5 de-vig, not indirect O2.5 inference', () => {
  const s=[
    {line:2.5,overOdds:1.54,underOdds:2.40,provider:'A',sameProvider:true,sameTimestamp:true},
    {line:3.5,overOdds:2.20,underOdds:1.625,provider:'A',sameProvider:true,sameTimestamp:true}
  ];
  const x=exactTargetLineAnchor(s,3.5);
  assert.equal(x.status,'PASS');
  assert.ok(Math.abs(x.fairUnder-0.5751633986928104)<1e-12);
});

test('cross-provider or timestamp target-line construction is blocked',()=>{
  const x=exactTargetLineAnchor([{line:3.5,overOdds:2.2,underOdds:1.625,sameProvider:false,sameTimestamp:true}],3.5);
  assert.equal(x.status,'BLOCK'); assert.equal(x.fairUnder,null);
});

test('surface disagreement creates uncertainty rather than silently forcing one lambda',()=>{
  assert.equal(surfaceDisagreement({2.5:3.1476,3.5:3.32345}).status,'WATCH');
});

test('source conflict preserves null when quorum is absent',()=>{
  const q=resolveSourceQuorum([
    {tier:'B',claim:'0-0',independent:true,explicitTimestamp:false},
    {tier:'B',claim:'1-0',independent:true,explicitTimestamp:false}
  ]);
  assert.equal(q.status,'FAIL'); assert.equal(q.value,null);
});

test('confidence budget is evidence maturity, and critical blocks prevent promotion',()=>{
  const c=evaluateConfidenceBudget([{penalty:30,triggered:true,blocksPromotion:true},{penalty:10,triggered:false,blocksPromotion:false}]);
  assert.equal(c.score,70); assert.equal(c.status,'BLOCKED');
  assert.equal(c.interpretation,'EVIDENCE_MATURITY_NOT_EVENT_PROBABILITY');
});

test('unvalidated models collapse to zero reliability weight',()=>{
  const r=allocateReliabilityWeights([
    {id:'market',baseWeight:.65,validation:1,calibration:1,freshness:1,drift:1,availability:1},
    {id:'M011',baseWeight:.25,validation:0,calibration:0,freshness:1,drift:.75,availability:1}
  ]);
  assert.equal(r.find(x=>x.id==='M011').normalizedWeight,0);
  assert.equal(r.find(x=>x.id==='market').normalizedWeight,1);
});

test('evidence graph rejects duplicate IDs and unverified critical evidence is visible',()=>{
  const g=new EvidenceGraph();
  g.add({id:'E1',verified:false,critical:true,decisionWeight:'ZERO'});
  assert.equal(g.unresolvedCritical().length,1);
  assert.throws(()=>g.add({id:'E1'}),/DUPLICATE/);
});

test('one match never authorizes retuning',()=>{
  assert.equal(learningResponse('EVENT_SHOCK').canRetuneFromOneMatch,false);
});

test('market remains champion when challenger does not beat OOS metrics',()=>{
  const r=compareChallenger({champion:{brier:.198,logLoss:.586},challenger:{n:40,brier:.199,logLoss:.588,clv:.01}});
  assert.equal(r.decision,'RETAIN_CHAMPION');
});

test('M011 and M012 remain zero-weight challengers',()=>{
  assert.equal(RESEARCH_CHALLENGERS.M011.decisionWeight,0);
  assert.equal(RESEARCH_CHALLENGERS.M012.decisionWeight,0);
});

test('probabilistic brain separates probability, EV, and evidence maturity and cannot unlock capital',()=>{
  const c={score:0,criticalBlocks:5};
  const b=probabilisticBrain({modelProbabilities:[.5751633987,.6425271257],weights:[.934,.066],offeredOdds:1.625,confidence:c});
  assert.ok(b.probability>0 && b.probability<1);
  assert.notEqual(b.probability,b.evidenceMaturity);
  assert.equal(b.realMoney,'NO');
});

test('self evaluation prohibits superiority claim without calibration and OOS market win',()=>{
  const s=selfEvaluate({verifiedLiveState:false,calibrated:false,beatsMarketOOS:false,priceHasValue:false,noMissingGuesses:true,oneMatchRetuneForbidden:true});
  assert.equal(s.canClaimSuperiority,false); assert.equal(s.realMoneyEligible,false);
});

test('learning loop creates governed proposal and never auto-applies',()=>{
  const p=proposeLearningChange({modelId:'M011',errorEvidence:['DISTRIBUTION_SHAPE'],championScore:{brier:.19,logLoss:.55},challengerScore:{n:50,brier:.18,logLoss:.53,clv:.02}});
  assert.equal(p.autoApply,false); assert.equal(p.productionMutationAllowed,false);
  assert.equal(p.decisionWeightChange,'REVIEW_REQUIRED');
});
