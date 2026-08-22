import test from 'node:test';
import assert from 'node:assert/strict';
import { processTrialEvent, processTrialBatch } from '../src/trial-processing.mjs';

const batch = { batchId:'B1', capturedAt:'2026-08-23T00:10:00+03:00' };

function event(overrides = {}) {
  return {
    eventId:'E1', league:'EPL', homeTeam:'A', awayTeam:'B',
    kickoffAt:'2026-08-24T19:00:00Z', marketKey:'1X2_90M',
    model:{homeLambda:1.8,awayLambda:1.0},
    evidenceMaturity:85, lineupGate:'PASS', independenceVerified:true, correlationGroup:'G1',
    bookmakerSnapshots:[
      {provider:'BETPAWA',observedAt:'2026-08-22T21:09:10Z',sourceType:'MANUAL_CAPTURE',odds:{HOME:2.00,DRAW:3.50,AWAY:3.80}},
      {provider:'SPORTPESA',observedAt:'2026-08-22T21:09:30Z',sourceType:'MANUAL_CAPTURE',odds:{HOME:2.02,DRAW:3.45,AWAY:3.75}},
      {provider:'PARIMATCH',observedAt:'2026-08-22T21:09:45Z',sourceType:'MANUAL_CAPTURE',odds:{HOME:1.98,DRAW:3.55,AWAY:3.85}}
    ],
    ...overrides
  };
}

test('operational trial event produces qualified 1X2 signal and Gate5-ready draft', () => {
  const r=processTrialEvent(event(),batch);
  assert.equal(r.state,'QUALIFIED');
  assert.equal(r.selectedOutcome,'HOME_WIN');
  assert.ok(r.edge>=0.05);
  assert.ok(r.ev>0);
  assert.equal(r.gate5SignalDraft.pattern_id,'P1X2_TRIAL_OPERATIONAL_V0_1');
  assert.equal(r.gate5SignalDraft.quote_source,'SPORTPESA');
  assert.equal(r.realMoney,'NO');
});

test('small edge remains WATCH and does not create Gate5 draft', () => {
  const r=processTrialEvent(event({
    eventId:'E2', model:{homeLambda:1.4,awayLambda:1.1},
    bookmakerSnapshots:[
      {provider:'BETPAWA',observedAt:'2026-08-22T21:09:14Z',sourceType:'MANUAL_CAPTURE',odds:{HOME:2.25,DRAW:3.30,AWAY:3.20}},
      {provider:'SPORTPESA',observedAt:'2026-08-22T21:09:31Z',sourceType:'MANUAL_CAPTURE',odds:{HOME:2.28,DRAW:3.25,AWAY:3.15}}
    ]
  }),batch);
  assert.equal(r.state,'WATCH');
  assert.equal(r.gate5SignalDraft,null);
  assert.ok(r.reasons.includes('EDGE_TOO_SMALL'));
});

test('single bookmaker snapshot waits for source quorum', () => {
  const r=processTrialEvent(event({
    eventId:'E3',
    bookmakerSnapshots:[{provider:'BETPAWA',observedAt:'2026-08-22T21:09:20Z',sourceType:'MANUAL_CAPTURE',odds:{HOME:2.10,DRAW:3.35,AWAY:3.45}}]
  }),batch);
  assert.equal(r.state,'WAIT');
  assert.ok(r.reasons.includes('NEED_MULTIPLE_PROVIDERS'));
});

test('batch ranks candidates, emits Gate5 drafts and builds paper combination sets', () => {
  const e1=event();
  const e2=event({
    eventId:'E4', league:'SERIE_A', homeTeam:'C', awayTeam:'D', correlationGroup:'G2',
    model:{homeLambda:2.0,awayLambda:0.9}, evidenceMaturity:90,
    bookmakerSnapshots:[
      {provider:'BETPAWA',observedAt:'2026-08-22T21:09:05Z',sourceType:'MANUAL_CAPTURE',odds:{HOME:1.72,DRAW:3.80,AWAY:5.00}},
      {provider:'MBET',observedAt:'2026-08-22T21:09:22Z',sourceType:'MANUAL_CAPTURE',odds:{HOME:1.75,DRAW:3.75,AWAY:4.90}},
      {provider:'SOKABET',observedAt:'2026-08-22T21:09:39Z',sourceType:'MANUAL_CAPTURE',odds:{HOME:1.70,DRAW:3.85,AWAY:5.10}}
    ]
  });
  const r=processTrialBatch({...batch,events:[e1,e2]});
  assert.equal(r.summary.qualifiedSignals,2);
  assert.equal(r.summary.gate5SignalDrafts,2);
  assert.equal(r.summary.paperCombinationSets,1);
  assert.equal(r.rankedCandidates.length,2);
  assert.equal(r.mode,'TRIAL_PAPER_ONLY');
  assert.equal(r.realMoney,'NO');
});

test('capture at or after kickoff is rejected before prediction execution path', () => {
  const r=processTrialEvent(event({eventId:'E5',kickoffAt:'2026-08-22T20:00:00Z'}),batch);
  assert.equal(r.state,'REJECTED');
  assert.ok(r.reasons.includes('CAPTURE_AT_OR_AFTER_KICKOFF'));
});
