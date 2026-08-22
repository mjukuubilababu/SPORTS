import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOKMAKER_REGISTRY, providerMayIngest, devigNWay,
  compareBookmakerSnapshots, buildPaperCombinations
} from '../src/index.mjs';

test('registry includes requested Tanzania-facing providers without assuming private feed access', () => {
  for (const id of ['BETPAWA','SPORTPESA','MBET','PARIMATCH','SOKABET']) assert.ok(BOOKMAKER_REGISTRY[id]);
  assert.equal(providerMayIngest(BOOKMAKER_REGISTRY.MBET, {termsApproved:true, endpointVerified:true}).allowed, false);
});

test('n-way de-vig converts bookmaker prices into a probability distribution', () => {
  const x = devigNWay({HOME:2.1,DRAW:3.4,AWAY:3.6});
  const total = Object.values(x.fair).reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(total-1) < 1e-12);
  assert.ok(x.overround > 0);
});

test('multi-book comparison finds best prices and consensus without mixing events', () => {
  const rows = [
    {eventId:'E1',provider:'BETPAWA',marketKey:'1X2_90M',observedAt:'2026-08-22T20:00:00Z',sourceType:'PUBLIC_WEB',odds:{HOME:2.10,DRAW:3.40,AWAY:3.60}},
    {eventId:'E1',provider:'SPORTPESA',marketKey:'1X2_90M',observedAt:'2026-08-22T20:00:20Z',sourceType:'PUBLIC_WEB',odds:{HOME:2.18,DRAW:3.30,AWAY:3.55}},
    {eventId:'E1',provider:'PARIMATCH',marketKey:'1X2_90M',observedAt:'2026-08-22T20:00:35Z',sourceType:'PUBLIC_WEB',odds:{HOME:2.05,DRAW:3.50,AWAY:3.70}}
  ];
  const c = compareBookmakerSnapshots(rows);
  assert.equal(c.bestPrice.HOME.provider,'SPORTPESA');
  assert.equal(c.providers.length,3);
  const z = Object.values(c.consensusFair).reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(z-1) < 1e-12);
});

test('timestamp skew is blocked', () => {
  const rows = [
    {eventId:'E1',provider:'A',marketKey:'1X2_90M',observedAt:'2026-08-22T20:00:00Z',sourceType:'PUBLIC_WEB',odds:{HOME:2.1,DRAW:3.4,AWAY:3.6}},
    {eventId:'E1',provider:'B',marketKey:'1X2_90M',observedAt:'2026-08-22T20:05:00Z',sourceType:'PUBLIC_WEB',odds:{HOME:2.2,DRAW:3.3,AWAY:3.5}}
  ];
  assert.equal(compareBookmakerSnapshots(rows,{maxSkewSeconds:120}).status,'BLOCK');
});

test('bookmaker difference explanations are hypotheses, never claimed internal facts', () => {
  const rows = [
    {eventId:'E2',provider:'A',marketKey:'1X2_90M',observedAt:'2026-08-22T20:00:00Z',sourceType:'PUBLIC_WEB',odds:{HOME:1.80,DRAW:3.50,AWAY:4.50}},
    {eventId:'E2',provider:'B',marketKey:'1X2_90M',observedAt:'2026-08-22T20:00:10Z',sourceType:'PUBLIC_WEB',odds:{HOME:2.05,DRAW:3.30,AWAY:3.80}}
  ];
  const c=compareBookmakerSnapshots(rows);
  assert.equal(c.explanationPolicy,'HYPOTHESES_NOT_INTERNAL_BOOKMAKER_FACTS');
  assert.ok(c.hypotheses.length>=1);
});

test('paper combinations require qualified, mature, positive-edge, independent legs', () => {
  const candidates = [
    {eventId:'A',selection:'HOME',modelProbability:.62,marketFairProbability:.54,bestOdds:1.95,evidenceMaturity:85,state:'QUALIFIED',independenceVerified:true,correlationGroup:'G1'},
    {eventId:'B',selection:'UNDER_3_5',modelProbability:.70,marketFairProbability:.62,bestOdds:1.62,evidenceMaturity:90,state:'QUALIFIED',independenceVerified:true,correlationGroup:'G2'},
    {eventId:'C',selection:'AWAY',modelProbability:.58,marketFairProbability:.51,bestOdds:2.00,evidenceMaturity:82,state:'QUALIFIED',independenceVerified:false,correlationGroup:'G3'}
  ];
  const r=buildPaperCombinations(candidates,{maxSets:2,minLegs:2,maxLegs:2});
  assert.equal(r.mode,'PAPER_ONLY');
  assert.equal(r.realMoney,'NO');
  assert.equal(r.qualifiedCount,2);
  assert.equal(r.selected.length,1);
  assert.equal(r.rejected.some(x=>x.reason==='INDEPENDENCE_NOT_VERIFIED'),true);
});
