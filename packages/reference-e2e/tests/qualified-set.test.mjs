import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scanQualificationUniverse } from '../src/qualification-scanner.mjs';
import { evaluateQualifiedSetRisk } from '../src/risk.mjs';

const fixture=JSON.parse(fs.readFileSync(new URL('../fixtures/controlled-match.json',import.meta.url),'utf8'));
const clock=()=>new Date('2025-05-10T21:00:00Z');

function candidate(n,{u35=1.64,o35=2.25,o25=1.45,lambdaBase=2.775,lineupGate='PASS'}={}){
  const kickoff=new Date(Date.parse(fixture.rawEvent.kickoffAt)+n*86_400_000).toISOString();
  const observed=new Date(Date.parse(kickoff)-3*60*60*1000).toISOString();
  return {
    rawEvent:{
      ...fixture.rawEvent,
      providerEventId:`CONTROL-${n}`,
      kickoffAt:kickoff,
      observedAt:observed,
      homeTeam:`Home ${n}`,
      awayTeam:`Away ${n}`,
      market:{...fixture.rawEvent.market,o25,o35,u35}
    },
    rawFeatures:{...fixture.rawFeatures,lambdaBase},
    lineupGate
  };
}

test('zero qualifiers returns a valid empty QualifiedSet',()=>{
  const q=scanQualificationUniverse({candidates:[candidate(1,{o25:1.80}),candidate(2,{lineupGate:'FAIL'})]},{clock});
  assert.equal(q.analyzedCount,2);
  assert.equal(q.qualifiedCount,0);
  assert.deepEqual(q.qualifiedSignals,[]);
  assert.equal(q.truncation,'NONE');
});

test('one qualifier returns exactly that qualifier',()=>{
  const q=scanQualificationUniverse({candidates:[candidate(1)]},{clock});
  assert.equal(q.qualifiedCount,1);
  assert.equal(q.qualifiedSignals[0].homeTeam,'Home 1');
  assert.equal(q.qualifiedSignals[0].status,'QUALIFIED');
});

test('many qualifying teams are all returned with no top-1 truncation',()=>{
  const q=scanQualificationUniverse({candidates:[candidate(1,{u35:1.62}),candidate(2,{u35:1.70}),candidate(3,{u35:1.66})]},{clock});
  assert.equal(q.qualifiedCount,3);
  assert.equal(q.qualifiedSignals.length,3);
  assert.equal(q.truncation,'NONE');
  assert.deepEqual(new Set(q.qualifiedSignals.map(x=>x.homeTeam)),new Set(['Home 1','Home 2','Home 3']));
});

test('ranking is deterministic and never suppresses a valid qualifier',()=>{
  const candidates=[candidate(1,{u35:1.62}),candidate(2,{u35:1.70}),candidate(3,{u35:1.66})];
  const a=scanQualificationUniverse({candidates},{clock});
  const b=scanQualificationUniverse({candidates:[candidates[2],candidates[0],candidates[1]]},{clock});
  assert.equal(a.qualifiedCount,3);
  assert.equal(b.qualifiedCount,3);
  assert.deepEqual(a.qualifiedSignals.map(x=>x.eventId),b.qualifiedSignals.map(x=>x.eventId));
  assert.deepEqual(a.qualifiedSignals.map(x=>x.rank),[1,2,3]);
  assert.ok(a.qualifiedSignals[0].rawEdgePp>=a.qualifiedSignals[1].rawEdgePp);
  assert.ok(a.qualifiedSignals[1].rawEdgePp>=a.qualifiedSignals[2].rawEdgePp);
});

test('duplicate candidate is deterministically deduplicated, not double-counted',()=>{
  const c=candidate(1);
  const q=scanQualificationUniverse({candidates:[c,c]},{clock});
  assert.equal(q.analyzedCount,1);
  assert.equal(q.qualifiedCount,1);
  assert.equal(q.duplicateInputsRemoved,1);
});

test('portfolio risk can restrict execution without deleting qualification history',()=>{
  const q=scanQualificationUniverse({candidates:[candidate(1,{u35:1.62}),candidate(2,{u35:1.70}),candidate(3,{u35:1.66})]},{clock});
  const before=q.qualifiedSignals.map(x=>x.decisionId);
  const risk=evaluateQualifiedSetRisk(q,{mode:'PAPER_ONLY',bankroll:1_000_000,maxExposurePct:0.003,stakePct:0.0025},{clock});
  assert.equal(q.qualifiedCount,3);
  assert.equal(risk.qualifiedCount,3);
  assert.equal(risk.executableCount,1);
  assert.equal(risk.restrictedCount,2);
  assert.equal(risk.qualificationHistoryPreserved,true);
  assert.deepEqual(q.qualifiedSignals.map(x=>x.decisionId),before);
  assert.ok(Object.isFrozen(q));
});


test('equal-time conflicting duplicates are rejected instead of silently choosing one',()=>{
  const a=candidate(1,{lambdaBase:2.775});
  const b={...a,rawFeatures:{...a.rawFeatures,lambdaBase:2.95}};
  assert.throws(()=>scanQualificationUniverse({candidates:[a,b]},{clock}),/CONFLICTING_DUPLICATE_SIGNAL/);
});
