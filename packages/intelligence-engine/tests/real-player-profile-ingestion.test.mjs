import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRealPlayerProfiles, playerProfilesForConfirmedXi } from '../src/real-player-profile-ingestion.mjs';
import { buildConfirmedLineupPlayerIntelligence } from '../src/player-matchup-intelligence.mjs';

const AS_OF='2026-08-24T18:00:00Z';
const ROLE_METRICS={
  ATTACK:i=>({goalsPer90:.2+i*.01,xGPerShot:.08+i*.002,xAPer90:.1+i*.005,progressiveActionsPer90:2+i*.1,successfulDribblesPer90:.8+i*.05}),
  MIDFIELD:i=>({xAPer90:.08+i*.004,progressivePassesPer90:2+i*.12,pressureRetentionRate:.55+i*.01,passCompletionRate:.7+i*.01,defensiveDuelWinRate:.45+i*.01,successfulDribblesPer90:.4+i*.03,xGPerShot:.05+i*.002,interceptionsPer90:.7+i*.04,recoveriesPer90:3+i*.1}),
  DEFENCE:i=>({defensiveDuelWinRate:.5+i*.01,aerialWinRate:.5+i*.012,interceptionsPer90:.8+i*.05,recoveriesPer90:3+i*.12,passCompletionRate:.72+i*.008}),
  GOALKEEPER:i=>({goalsPreventedPer90:-.1+i*.03,longPassCompletionRate:.35+i*.02,highClaimsPer90:.2+i*.03})
};
function rawPlayer(playerId,teamId,phaseRole,i=1,overrides={}){
  return {playerId,teamId,phaseRole,sampleSize:20,competitionStrengthFactor:1,priorTeamMinutesShare:.7,source:'STAT_PROVIDER',observedAt:'2026-08-24T12:00:00Z',verified:true,availability:{status:'AVAILABLE',source:'CLUB',observedAt:'2026-08-24T13:00:00Z',verified:true},rawMetrics:ROLE_METRICS[phaseRole](i),...overrides};
}
function dataset(){
  const players=[];
  for(const role of ['ATTACK','MIDFIELD','DEFENCE','GOALKEEPER']) for(let i=1;i<=8;i++) players.push(rawPlayer(`${role}-${i}`,i<=4?'H':'A',role,i));
  return {datasetId:'EPL-PLAYERS-V0',competition:'EPL',season:'2026-27',capturedAt:AS_OF,sourceBundle:{source:'VERIFIED_STATS_PROVIDER',verified:true},players};
}
function lineup(){
  const home=[
    {playerId:'GOALKEEPER-1',phaseRole:'GOALKEEPER',zone:'GOALKEEPER'},
    {playerId:'DEFENCE-1',phaseRole:'DEFENCE',zone:'LEFT'}, {playerId:'DEFENCE-2',phaseRole:'DEFENCE',zone:'CENTRAL'}, {playerId:'DEFENCE-3',phaseRole:'DEFENCE',zone:'CENTRAL'}, {playerId:'DEFENCE-4',phaseRole:'DEFENCE',zone:'RIGHT'},
    {playerId:'MIDFIELD-1',phaseRole:'MIDFIELD',zone:'LEFT'}, {playerId:'MIDFIELD-2',phaseRole:'MIDFIELD',zone:'CENTRAL'}, {playerId:'MIDFIELD-3',phaseRole:'MIDFIELD',zone:'RIGHT'},
    {playerId:'ATTACK-1',phaseRole:'ATTACK',zone:'LEFT'}, {playerId:'ATTACK-2',phaseRole:'ATTACK',zone:'CENTRAL'}, {playerId:'ATTACK-3',phaseRole:'ATTACK',zone:'RIGHT'}
  ];
  const away=[
    {playerId:'GOALKEEPER-5',phaseRole:'GOALKEEPER',zone:'GOALKEEPER'},
    {playerId:'DEFENCE-5',phaseRole:'DEFENCE',zone:'LEFT'}, {playerId:'DEFENCE-6',phaseRole:'DEFENCE',zone:'CENTRAL'}, {playerId:'DEFENCE-7',phaseRole:'DEFENCE',zone:'CENTRAL'}, {playerId:'DEFENCE-8',phaseRole:'DEFENCE',zone:'RIGHT'},
    {playerId:'MIDFIELD-5',phaseRole:'MIDFIELD',zone:'LEFT'}, {playerId:'MIDFIELD-6',phaseRole:'MIDFIELD',zone:'CENTRAL'}, {playerId:'MIDFIELD-7',phaseRole:'MIDFIELD',zone:'RIGHT'},
    {playerId:'ATTACK-5',phaseRole:'ATTACK',zone:'LEFT'}, {playerId:'ATTACK-6',phaseRole:'ATTACK',zone:'CENTRAL'}, {playerId:'ATTACK-7',phaseRole:'ATTACK',zone:'RIGHT'}
  ];
  return {status:'CONFIRMED',verified:true,source:'OFFICIAL_LINEUP',observedAt:'2026-08-24T17:30:00Z',home,away};
}

test('normalizes verified raw stats into player-matchup compatible profiles',()=>{
  const batch=buildRealPlayerProfiles(dataset(),{asOf:AS_OF,minimumRoleCohort:5});
  assert.equal(batch.audit.playerCount,32);
  const p=batch.profiles['ATTACK-8'];
  assert.equal(p.verified,true); assert.equal(p.competitionAdjusted,true);
  for(const k of ['finishing','shotQuality','chanceCreation','ballProgression','dribbling','teamContinuity']) assert.ok(p[k]>=0&&p[k]<=1);
});

test('confirmed XI can consume generated profiles and produce player domains',()=>{
  const batch=buildRealPlayerProfiles(dataset(),{asOf:AS_OF,minimumRoleCohort:5});
  const xi=lineup();
  const profiles=playerProfilesForConfirmedXi(batch,xi);
  const intel=buildConfirmedLineupPlayerIntelligence({eventId:'E1',homeTeam:'H',awayTeam:'A',kickoffAt:'2026-08-24T18:30:00Z',lineupObservation:xi,playerProfiles:profiles,minimumPlayerSample:8});
  assert.equal(intel.readiness,'PLAYER_DOMAINS_READY');
  assert.equal(intel.playerMatchups.length,7);
  assert.ok(intel.playerQualityAndCohesion.homeIndividualQuality>=0);
});

test('same-role percentile preserves stronger raw metric ordering',()=>{
  const batch=buildRealPlayerProfiles(dataset(),{asOf:AS_OF,minimumRoleCohort:5});
  assert.ok(batch.profiles['ATTACK-8'].finishing>batch.profiles['ATTACK-1'].finishing);
  assert.ok(batch.profiles['GOALKEEPER-8'].shotStopping>batch.profiles['GOALKEEPER-1'].shotStopping);
});

test('competition factor is explicit and bounded',()=>{
  const d=dataset(); d.players[0]={...d.players[0],competitionStrengthFactor:1.2};
  const batch=buildRealPlayerProfiles(d,{asOf:AS_OF,minimumRoleCohort:5});
  assert.equal(batch.profiles[d.players[0].playerId].competitionStrengthFactor,1.2);
  const bad=dataset(); bad.players[0]={...bad.players[0],competitionStrengthFactor:2};
  assert.throws(()=>buildRealPlayerProfiles(bad,{asOf:AS_OF,minimumRoleCohort:5}),/PLAYER_COMPETITION_FACTOR_INVALID/);
});

test('fails closed on unverified, hindsight, low sample and insufficient role cohort',()=>{
  const a=dataset(); a.players[0]={...a.players[0],verified:false};
  assert.throws(()=>buildRealPlayerProfiles(a,{asOf:AS_OF,minimumRoleCohort:5}),/PLAYER_NOT_VERIFIED/);
  const b=dataset(); b.players[0]={...b.players[0],observedAt:'2026-08-25T00:00:00Z'};
  assert.throws(()=>buildRealPlayerProfiles(b,{asOf:AS_OF,minimumRoleCohort:5}),/PLAYER_AFTER_AS_OF/);
  const c=dataset(); c.players[0]={...c.players[0],sampleSize:3};
  assert.throws(()=>buildRealPlayerProfiles(c,{asOf:AS_OF,minimumRoleCohort:5}),/PLAYER_SAMPLE_TOO_SMALL/);
  const d=dataset(); d.players=d.players.filter(p=>p.phaseRole!=='GOALKEEPER'||Number(p.playerId.split('-')[1])<=4);
  assert.throws(()=>buildRealPlayerProfiles(d,{asOf:AS_OF,minimumRoleCohort:5}),/ROLE_COHORT_TOO_SMALL_GOALKEEPER/);
});

test('fails closed when required raw metric is missing',()=>{
  const d=dataset(); const row=d.players.find(p=>p.phaseRole==='DEFENCE'); const raw={...row.rawMetrics}; delete raw.interceptionsPer90; Object.assign(row,{rawMetrics:raw});
  assert.throws(()=>buildRealPlayerProfiles(d,{asOf:AS_OF,minimumRoleCohort:5}),/PLAYER_REQUIRED_RAW_METRIC_MISSING/);
});

test('bookmaker, reputation and transfer-fee fields are forbidden',()=>{
  for(const key of ['bookmakerOdds','reputationScore','transferFee']){
    const d=dataset(); d.players[0]={...d.players[0],[key]:1};
    assert.throws(()=>buildRealPlayerProfiles(d,{asOf:AS_OF,minimumRoleCohort:5}),new RegExp(`FORBIDDEN_PLAYER_INPUT_${key}`));
  }
});
