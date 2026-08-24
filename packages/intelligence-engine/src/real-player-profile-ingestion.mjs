const VERSION = 'REAL_PLAYER_PROFILE_INGESTION_V0_1';
const PHASE_ROLES = Object.freeze(['ATTACK','MIDFIELD','DEFENCE','GOALKEEPER']);
const REQUIRED_RAW = Object.freeze({
  ATTACK: Object.freeze({
    finishing:'goalsPer90', shotQuality:'xGPerShot', chanceCreation:'xAPer90',
    ballProgression:'progressiveActionsPer90', dribbling:'successfulDribblesPer90'
  }),
  MIDFIELD: Object.freeze({
    chanceCreation:'xAPer90', ballProgression:'progressivePassesPer90', pressResistance:'pressureRetentionRate',
    ballSecurity:'passCompletionRate', defensiveDuels:'defensiveDuelWinRate'
  }),
  DEFENCE: Object.freeze({
    defensiveDuels:'defensiveDuelWinRate', aerialDefending:'aerialWinRate', interceptions:'interceptionsPer90',
    recovery:'recoveriesPer90', ballSecurity:'passCompletionRate'
  }),
  GOALKEEPER: Object.freeze({
    shotStopping:'goalsPreventedPer90', goalkeeperDistribution:'longPassCompletionRate', highClaims:'highClaimsPer90'
  })
});
const OPTIONAL_RAW = Object.freeze({
  MIDFIELD: Object.freeze({ dribbling:'successfulDribblesPer90', shotQuality:'xGPerShot', interceptions:'interceptionsPer90', recovery:'recoveriesPer90' })
});
const FORBIDDEN_FIELDS = Object.freeze(['bookmakerOdds','marketPrice','reputationScore','transferFee']);

function clamp(v,min=0,max=1){ return Math.max(min,Math.min(max,v)); }
function parseTime(v,label){ const ms=Date.parse(v); if(!Number.isFinite(ms)) throw new Error(`${label}_INVALID_TIMESTAMP`); return ms; }
function assert01(label,v){ if(!Number.isFinite(v)||v<0||v>1) throw new Error(`${label}_MUST_BE_0_TO_1`); return v; }
function adjustedPercentile(p,factor){ return clamp(0.5 + (p-0.5)*factor); }
function percentile(values, target){
  const sorted=[...values].sort((a,b)=>a-b);
  if(!sorted.length) throw new Error('PERCENTILE_COHORT_EMPTY');
  const lower=sorted.filter(v=>v<target).length;
  const equal=sorted.filter(v=>v===target).length;
  return clamp((lower + 0.5*equal)/sorted.length);
}
function availabilityFitness(availability, asOfMs){
  if(!availability) return 1;
  if(availability.verified!==true) throw new Error('PLAYER_AVAILABILITY_NOT_VERIFIED');
  if(!availability.source||!availability.observedAt) throw new Error('PLAYER_AVAILABILITY_PROVENANCE_REQUIRED');
  if(parseTime(availability.observedAt,'PLAYER_AVAILABILITY_OBSERVED_AT')>asOfMs) throw new Error('PLAYER_AVAILABILITY_AFTER_AS_OF');
  const map={AVAILABLE:1,LIMITED:0.75,DOUBTFUL:0.6,OUT:0};
  if(!(availability.status in map)) throw new Error('PLAYER_AVAILABILITY_STATUS_INVALID');
  return map[availability.status];
}
function validateRawPlayer(row, asOfMs, minimumSample){
  if(!row?.playerId||!row.teamId||!row.phaseRole) throw new Error('PLAYER_ID_TEAM_ROLE_REQUIRED');
  if(!PHASE_ROLES.includes(row.phaseRole)) throw new Error(`PLAYER_PHASE_ROLE_INVALID_${row.playerId}`);
  for(const key of FORBIDDEN_FIELDS) if(row[key]!==undefined) throw new Error(`FORBIDDEN_PLAYER_INPUT_${key}`);
  if(row.verified!==true) throw new Error(`PLAYER_NOT_VERIFIED_${row.playerId}`);
  if(!row.source||!row.observedAt) throw new Error(`PLAYER_PROVENANCE_REQUIRED_${row.playerId}`);
  if(parseTime(row.observedAt,`PLAYER_${row.playerId}_OBSERVED_AT`)>asOfMs) throw new Error(`PLAYER_AFTER_AS_OF_${row.playerId}`);
  if(!Number.isInteger(row.sampleSize)||row.sampleSize<minimumSample) throw new Error(`PLAYER_SAMPLE_TOO_SMALL_${row.playerId}`);
  if(!Number.isFinite(row.competitionStrengthFactor)||row.competitionStrengthFactor<0.5||row.competitionStrengthFactor>1.5) throw new Error(`PLAYER_COMPETITION_FACTOR_INVALID_${row.playerId}`);
  assert01(`PLAYER_CONTINUITY_${row.playerId}`,row.priorTeamMinutesShare);
  const raw=row.rawMetrics??{};
  for(const metric of Object.values(REQUIRED_RAW[row.phaseRole])) if(!Number.isFinite(raw[metric])) throw new Error(`PLAYER_REQUIRED_RAW_METRIC_MISSING_${row.playerId}_${metric}`);
  availabilityFitness(row.availability,asOfMs);
}
function cohortMetric(players, role, rawKey, minimumRoleCohort){
  const vals=players.filter(p=>p.phaseRole===role&&Number.isFinite(p.rawMetrics?.[rawKey])).map(p=>p.rawMetrics[rawKey]);
  if(vals.length<minimumRoleCohort) throw new Error(`ROLE_METRIC_COHORT_TOO_SMALL_${role}_${rawKey}`);
  return vals;
}

export function buildRealPlayerProfiles(dataset,{asOf=dataset?.capturedAt,minimumPlayerSample=8,minimumRoleCohort=5}={}){
  if(!dataset?.datasetId||!dataset.competition||!Array.isArray(dataset.players)) throw new Error('REAL_PLAYER_DATASET_INVALID');
  if(dataset.sourceBundle?.verified!==true||!dataset.sourceBundle?.source) throw new Error('REAL_PLAYER_DATASET_SOURCE_NOT_VERIFIED');
  if(!Number.isInteger(minimumPlayerSample)||minimumPlayerSample<1) throw new Error('MINIMUM_PLAYER_SAMPLE_INVALID');
  if(!Number.isInteger(minimumRoleCohort)||minimumRoleCohort<3) throw new Error('MINIMUM_ROLE_COHORT_INVALID');
  const asOfMs=parseTime(asOf,'REAL_PLAYER_AS_OF');
  const ids=dataset.players.map(p=>p.playerId);
  if(new Set(ids).size!==ids.length) throw new Error('REAL_PLAYER_DUPLICATE_PLAYER_ID');
  for(const row of dataset.players) validateRawPlayer(row,asOfMs,minimumPlayerSample);

  const cohortSizes={};
  for(const role of PHASE_ROLES) cohortSizes[role]=dataset.players.filter(p=>p.phaseRole===role).length;
  for(const role of PHASE_ROLES) if(cohortSizes[role]&&cohortSizes[role]<minimumRoleCohort) throw new Error(`ROLE_COHORT_TOO_SMALL_${role}`);

  const profiles={};
  for(const row of dataset.players){
    const required={};
    for(const [profileKey,rawKey] of Object.entries(REQUIRED_RAW[row.phaseRole])){
      const cohort=cohortMetric(dataset.players,row.phaseRole,rawKey,minimumRoleCohort);
      required[profileKey]=adjustedPercentile(percentile(cohort,row.rawMetrics[rawKey]),row.competitionStrengthFactor);
    }
    const optional={};
    for(const [profileKey,rawKey] of Object.entries(OPTIONAL_RAW[row.phaseRole]??{})){
      if(Number.isFinite(row.rawMetrics?.[rawKey])){
        const cohort=cohortMetric(dataset.players,row.phaseRole,rawKey,minimumRoleCohort);
        optional[profileKey]=adjustedPercentile(percentile(cohort,row.rawMetrics[rawKey]),row.competitionStrengthFactor);
      }
    }
    profiles[row.playerId]=Object.freeze({
      ...required,...optional,
      availabilityFitness:availabilityFitness(row.availability,asOfMs),
      teamContinuity:row.priorTeamMinutesShare,
      sampleSize:row.sampleSize,
      source:`${dataset.sourceBundle.source} | ${row.source}`,
      observedAt:row.observedAt,
      verified:true,
      competitionAdjusted:true,
      competition:dataset.competition,
      season:dataset.season??null,
      phaseRole:row.phaseRole,
      normalization:'EMPIRICAL_SAME_ROLE_PERCENTILE_WITH_COMPETITION_FACTOR',
      competitionStrengthFactor:row.competitionStrengthFactor
    });
  }

  return Object.freeze({
    version:VERSION,
    datasetId:dataset.datasetId,
    competition:dataset.competition,
    season:dataset.season??null,
    asOf,
    minimumPlayerSample,
    minimumRoleCohort,
    profiles:Object.freeze(profiles),
    audit:Object.freeze({playerCount:dataset.players.length,roleCohortSizes:Object.freeze(cohortSizes),source:dataset.sourceBundle.source,sourceVerified:true}),
    governance:Object.freeze({
      rawStatsNormalizedWithinRole:true,
      competitionAdjustmentRequired:true,
      reputationScoreUsed:false,
      transferFeeUsed:false,
      bookmakerOddsUsed:false,
      postAsOfEvidenceForbidden:true,
      outputDirectlyCompatibleWithPlayerMatchupIntelligence:true
    })
  });
}

export function playerProfilesForConfirmedXi(profileBatch,lineupObservation){
  if(profileBatch?.version!==VERSION) throw new Error('REAL_PLAYER_PROFILE_BATCH_REQUIRED');
  const ids=[...(lineupObservation?.home??[]),...(lineupObservation?.away??[])].map(x=>x.playerId);
  if(ids.length!==22) throw new Error('CONFIRMED_XI_22_PLAYER_IDS_REQUIRED');
  const out={};
  for(const id of ids){
    if(!profileBatch.profiles[id]) throw new Error(`REAL_PLAYER_PROFILE_MISSING_${id}`);
    out[id]=profileBatch.profiles[id];
  }
  return Object.freeze(out);
}

export const REAL_PLAYER_PROFILE_INGESTION_VERSION=VERSION;
