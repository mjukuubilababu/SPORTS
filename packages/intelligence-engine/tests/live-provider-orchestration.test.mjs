import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreMatchOutcomeSnapshot } from '../src/outcome-1x2.mjs';
import { orchestrateLiveProviderPredictions } from '../src/live-provider-orchestration.mjs';

function prematch(eventId='EPL-CANONICAL-1'){
  return createPreMatchOutcomeSnapshot({
    signalId:`SIG-${eventId}`,eventId,modelVersion:'POISSON_V1',featureVersion:'FEATURE_V1',
    homeLambda:1.7,awayLambda:1.2,createdAt:'2026-08-24T18:40:00Z',frozenAt:'2026-08-24T18:50:00Z'
  });
}

function liveRow(overrides={}){
  return {
    fixture_id:'EPL-API_FOOTBALL-1001',provider_fixture_id:1001,competition_id:'EPL',provider_league_id:39,season:2026,
    round:'Regular Season - 1',kickoff_utc:'2026-08-24T19:00:00Z',home_team_id:10,home_team:'Alpha FC',away_team_id:20,away_team:'Beta FC',
    state:'LIVE_IN_PLAY',status_short:'2H',status_long:'Second Half',elapsed_minute:62,extra_minute:null,home_goals:1,away_goals:0,
    observed_at:'2026-08-24T20:02:00Z',provider:'API_FOOTBALL',source_url:'https://v3.football.api-sports.io/fixtures?live=39',
    source_fixture_sha256:'a'.repeat(64),live_in_play_supported:true,bookmaker_data_used:false,provider_prediction_used:false,
    ...overrides
  };
}

function artifact(rows=[liveRow()]){
  return {capability:'API_FOOTBALL_LIVE_PROVIDER_V0_1',observed_at:'2026-08-24T20:02:00Z',snapshots:rows};
}

function link(overrides={}){
  return {
    provider:'API_FOOTBALL',providerFixtureId:1001,eventId:'EPL-CANONICAL-1',providerHomeTeamId:10,providerAwayTeamId:20,
    kickoffUtc:'2026-08-24T19:00:00Z',observedAt:'2026-08-24T18:30:00Z',verified:true,source:'PREMATCH_PROVIDER_IDENTITY_CAPTURE',
    preMatchSnapshot:prematch(),...overrides
  };
}

test('orchestrates exact provider identity into existing live 1X2 model',()=>{
  const result=orchestrateLiveProviderPredictions({providerArtifact:artifact(),prematchLinks:[link()]});
  assert.deepEqual(result.counts,{received:1,predicted:1,wait:0,rejected:0,skipped:0});
  const row=result.predictions[0];
  assert.equal(row.eventId,'EPL-CANONICAL-1');assert.equal(row.providerFixtureId,1001);
  assert.equal(row.prediction.minute,62);assert.deepEqual(row.prediction.score,{home:1,away:0});
  const p=row.prediction.probabilities;assert.ok(Math.abs(p.homeWin+p.draw+p.awayWin-1)<1e-12);
  assert.deepEqual(row.prediction.rateMultipliers,{home:1,away:1});
  assert.equal(row.prediction.evidence.length,2);assert.equal(row.prediction.preMatchSnapshotPreserved,true);
  assert.equal(result.governance.fuzzyTeamMatching,false);assert.equal(result.governance.providerPredictionUsed,false);
  assert.equal(result.governance.bookmakerOddsUsedAsLiveModelInput,false);assert.equal(result.governance.capitalState,'LOCKED');
});

test('missing explicit identity link waits instead of fuzzy matching',()=>{
  const result=orchestrateLiveProviderPredictions({providerArtifact:artifact(),prematchLinks:[]});
  assert.equal(result.counts.wait,1);assert.equal(result.counts.predicted,0);
  assert.equal(result.waits[0].reason,'PREMATCH_IDENTITY_LINK_MISSING');
});

test('provider team or kickoff mismatch is rejected fail closed',()=>{
  const team=orchestrateLiveProviderPredictions({providerArtifact:artifact([liveRow({home_team_id:999})]),prematchLinks:[link()]});
  assert.equal(team.rejected[0].reason,'PROVIDER_HOME_TEAM_ID_MISMATCH');
  const kickoff=orchestrateLiveProviderPredictions({providerArtifact:artifact([liveRow({kickoff_utc:'2026-08-24T19:30:00Z'})]),prematchLinks:[link()]});
  assert.equal(kickoff.rejected[0].reason,'PROVIDER_KICKOFF_MISMATCH');
});

test('non-live states are skipped and never reforecast',()=>{
  const result=orchestrateLiveProviderPredictions({providerArtifact:artifact([liveRow({state:'SETTLED',status_short:'FT',elapsed_minute:90,home_goals:2,away_goals:1})]),prematchLinks:[link()]});
  assert.equal(result.counts.skipped,1);assert.equal(result.counts.predicted,0);assert.equal(result.skipped[0].reason,'NOT_LIVE_IN_PLAY');
});

test('prematch snapshot must be frozen before kickoff and identity link must be verified',()=>{
  const late={...prematch(),frozenAt:'2026-08-24T19:01:00Z'};
  assert.throws(()=>orchestrateLiveProviderPredictions({providerArtifact:artifact(),prematchLinks:[link({preMatchSnapshot:late})]}),/PREMATCH_SNAPSHOT_NOT_FROZEN_BEFORE_KICKOFF/);
  assert.throws(()=>orchestrateLiveProviderPredictions({providerArtifact:artifact(),prematchLinks:[link({verified:false})]}),/VERIFIED_REQUIRED/);
});

test('duplicate provider snapshots and duplicate identity links fail closed',()=>{
  assert.throws(()=>orchestrateLiveProviderPredictions({providerArtifact:artifact([liveRow(),liveRow()]),prematchLinks:[link()]}),/PROVIDER_SNAPSHOT_DUPLICATE/);
  assert.throws(()=>orchestrateLiveProviderPredictions({providerArtifact:artifact(),prematchLinks:[link(),link()]}),/PREMATCH_IDENTITY_LINK_DUPLICATE/);
});

test('provider prediction or bookmaker contamination is forbidden',()=>{
  assert.throws(()=>orchestrateLiveProviderPredictions({providerArtifact:artifact([liveRow({provider_prediction_used:true})]),prematchLinks:[link()]}),/PROVIDER_PREDICTION_FORBIDDEN/);
  assert.throws(()=>orchestrateLiveProviderPredictions({providerArtifact:artifact([liveRow({bookmaker_data_used:true})]),prematchLinks:[link()]}),/PROVIDER_BOOKMAKER_DATA_FORBIDDEN/);
});
