import { predictLive1X2 } from './live-outcome.mjs';

export const LIVE_PROVIDER_ORCHESTRATION_VERSION='LIVE_PROVIDER_ORCHESTRATION_V0_1';

function assertObject(name,value){
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error(`${name}_OBJECT_REQUIRED`);
}

function parseTime(name,value){
  if(!value || Number.isNaN(Date.parse(value)))throw new Error(`${name}_TIMESTAMP_INVALID`);
  return Date.parse(value);
}

function positiveInt(name,value){
  if(!Number.isInteger(value) || value<=0)throw new Error(`${name}_INVALID`);
}

function linkKey(provider,providerFixtureId){return `${provider}|${providerFixtureId}`;}

function validateLink(link){
  assertObject('PREMATCH_IDENTITY_LINK',link);
  if(link.provider!=='API_FOOTBALL')throw new Error('PREMATCH_IDENTITY_LINK_PROVIDER_UNSUPPORTED');
  positiveInt('PREMATCH_IDENTITY_LINK_FIXTURE_ID',link.providerFixtureId);
  positiveInt('PREMATCH_IDENTITY_LINK_HOME_TEAM_ID',link.providerHomeTeamId);
  positiveInt('PREMATCH_IDENTITY_LINK_AWAY_TEAM_ID',link.providerAwayTeamId);
  if(link.providerHomeTeamId===link.providerAwayTeamId)throw new Error('PREMATCH_IDENTITY_LINK_TEAM_COLLISION');
  if(!link.eventId)throw new Error('PREMATCH_IDENTITY_LINK_EVENT_ID_REQUIRED');
  if(link.verified!==true)throw new Error('PREMATCH_IDENTITY_LINK_VERIFIED_REQUIRED');
  parseTime('PREMATCH_IDENTITY_LINK_KICKOFF',link.kickoffUtc);
  parseTime('PREMATCH_IDENTITY_LINK_OBSERVED_AT',link.observedAt);
  if(Date.parse(link.observedAt)>=Date.parse(link.kickoffUtc))throw new Error('PREMATCH_IDENTITY_LINK_MUST_BE_PREKICKOFF');
  assertObject('PREMATCH_SNAPSHOT',link.preMatchSnapshot);
  if(link.preMatchSnapshot.snapshotType!=='PRE_MATCH' || link.preMatchSnapshot.immutable!==true)throw new Error('PREMATCH_FROZEN_SNAPSHOT_REQUIRED');
  if(link.preMatchSnapshot.eventId!==link.eventId)throw new Error('PREMATCH_LINK_EVENT_ID_MISMATCH');
  parseTime('PREMATCH_FROZEN_AT',link.preMatchSnapshot.frozenAt);
  if(Date.parse(link.preMatchSnapshot.frozenAt)>=Date.parse(link.kickoffUtc))throw new Error('PREMATCH_SNAPSHOT_NOT_FROZEN_BEFORE_KICKOFF');
}

function buildLinkIndex(prematchLinks){
  if(!Array.isArray(prematchLinks))throw new Error('PREMATCH_IDENTITY_LINKS_ARRAY_REQUIRED');
  const index=new Map();
  for(const link of prematchLinks){
    validateLink(link);
    const key=linkKey(link.provider,link.providerFixtureId);
    if(index.has(key))throw new Error(`PREMATCH_IDENTITY_LINK_DUPLICATE_${key}`);
    index.set(key,link);
  }
  return index;
}

function validateProviderSnapshot(row){
  assertObject('PROVIDER_SNAPSHOT',row);
  if(row.provider!=='API_FOOTBALL')throw new Error('PROVIDER_SNAPSHOT_PROVIDER_UNSUPPORTED');
  positiveInt('PROVIDER_FIXTURE_ID',row.provider_fixture_id);
  positiveInt('PROVIDER_HOME_TEAM_ID',row.home_team_id);
  positiveInt('PROVIDER_AWAY_TEAM_ID',row.away_team_id);
  if(row.home_team_id===row.away_team_id)throw new Error('PROVIDER_TEAM_ID_COLLISION');
  parseTime('PROVIDER_KICKOFF',row.kickoff_utc);
  parseTime('PROVIDER_OBSERVED_AT',row.observed_at);
  if(!row.source_fixture_sha256 || !/^[0-9a-f]{64}$/i.test(row.source_fixture_sha256))throw new Error('PROVIDER_SOURCE_FIXTURE_SHA256_INVALID');
  if(row.bookmaker_data_used!==false)throw new Error('PROVIDER_BOOKMAKER_DATA_FORBIDDEN');
  if(row.provider_prediction_used!==false)throw new Error('PROVIDER_PREDICTION_FORBIDDEN');
}

function identityMismatch(row,link){
  if(row.home_team_id!==link.providerHomeTeamId)return 'PROVIDER_HOME_TEAM_ID_MISMATCH';
  if(row.away_team_id!==link.providerAwayTeamId)return 'PROVIDER_AWAY_TEAM_ID_MISMATCH';
  if(row.kickoff_utc!==link.kickoffUtc)return 'PROVIDER_KICKOFF_MISMATCH';
  return null;
}

function liveEvidence(row,link){
  return [
    {
      type:'LIVE_SCORE_TIME_PROVIDER_SNAPSHOT',provider:row.provider,providerFixtureId:row.provider_fixture_id,
      sourceFixtureSha256:row.source_fixture_sha256,status:row.status_short,verified:true
    },
    {
      type:'PROVIDER_CANONICAL_IDENTITY_LINK',provider:link.provider,providerFixtureId:link.providerFixtureId,
      eventId:link.eventId,observedAt:link.observedAt,source:link.source ?? 'EXPLICIT_IDENTITY_LINK',verified:true
    }
  ];
}

export function orchestrateLiveProviderPredictions({providerArtifact,prematchLinks}){
  assertObject('PROVIDER_ARTIFACT',providerArtifact);
  if(!Array.isArray(providerArtifact.snapshots))throw new Error('PROVIDER_ARTIFACT_SNAPSHOTS_ARRAY_REQUIRED');
  const links=buildLinkIndex(prematchLinks);
  const seen=new Set();
  const predictions=[];const waits=[];const rejected=[];const skipped=[];

  for(const row of providerArtifact.snapshots){
    validateProviderSnapshot(row);
    const providerKey=linkKey(row.provider,row.provider_fixture_id);
    if(seen.has(providerKey))throw new Error(`PROVIDER_SNAPSHOT_DUPLICATE_${providerKey}`);
    seen.add(providerKey);

    if(row.state!=='LIVE_IN_PLAY'){
      skipped.push(Object.freeze({providerFixtureId:row.provider_fixture_id,state:row.state,reason:'NOT_LIVE_IN_PLAY'}));
      continue;
    }
    if(!Number.isFinite(row.elapsed_minute) || row.elapsed_minute<0 || row.elapsed_minute>120 || !Number.isInteger(row.elapsed_minute)){
      rejected.push(Object.freeze({providerFixtureId:row.provider_fixture_id,reason:'LIVE_ELAPSED_MINUTE_INVALID'}));
      continue;
    }
    if(!Number.isInteger(row.home_goals) || row.home_goals<0 || !Number.isInteger(row.away_goals) || row.away_goals<0){
      rejected.push(Object.freeze({providerFixtureId:row.provider_fixture_id,reason:'LIVE_SCORE_INVALID'}));
      continue;
    }

    const link=links.get(providerKey);
    if(!link){
      waits.push(Object.freeze({providerFixtureId:row.provider_fixture_id,reason:'PREMATCH_IDENTITY_LINK_MISSING'}));
      continue;
    }
    const mismatch=identityMismatch(row,link);
    if(mismatch){
      rejected.push(Object.freeze({providerFixtureId:row.provider_fixture_id,eventId:link.eventId,reason:mismatch}));
      continue;
    }
    if(Date.parse(row.observed_at)<Date.parse(link.preMatchSnapshot.frozenAt)){
      rejected.push(Object.freeze({providerFixtureId:row.provider_fixture_id,eventId:link.eventId,reason:'LIVE_OBSERVATION_BEFORE_PREMATCH_FREEZE'}));
      continue;
    }

    const prediction=predictLive1X2({
      preMatchSnapshot:Object.freeze(link.preMatchSnapshot),
      minute:row.elapsed_minute,
      homeScore:row.home_goals,
      awayScore:row.away_goals,
      observedAt:row.observed_at,
      homeRateMultiplier:1,
      awayRateMultiplier:1,
      evidence:liveEvidence(row,link)
    });
    predictions.push(Object.freeze({
      provider:row.provider,
      providerFixtureId:row.provider_fixture_id,
      eventId:link.eventId,
      identityLinkObservedAt:link.observedAt,
      prediction,
      capitalState:'LOCKED',
      realMoney:'NO'
    }));
  }

  return Object.freeze({
    version:LIVE_PROVIDER_ORCHESTRATION_VERSION,
    provider:providerArtifact.capability ?? 'API_FOOTBALL_LIVE_PROVIDER_V0_1',
    counts:Object.freeze({received:providerArtifact.snapshots.length,predicted:predictions.length,wait:waits.length,rejected:rejected.length,skipped:skipped.length}),
    predictions:Object.freeze(predictions),waits:Object.freeze(waits),rejected:Object.freeze(rejected),skipped:Object.freeze(skipped),
    governance:Object.freeze({
      explicitIdentityLinkRequired:true,
      fuzzyTeamMatching:false,
      providerPredictionUsed:false,
      bookmakerOddsUsedAsLiveModelInput:false,
      rateMultipliersFixedAtOne:true,
      noHindsight:true,
      capitalState:'LOCKED',
      realMoney:'NO'
    })
  });
}
