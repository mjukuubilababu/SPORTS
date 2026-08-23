const VALID_PHASE_ROLES = new Set(['ATTACK', 'MIDFIELD', 'DEFENCE', 'GOALKEEPER']);
const VALID_ZONES = new Set(['LEFT', 'CENTRAL', 'RIGHT', 'GOALKEEPER']);

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function assert01(name, value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name}_MUST_BE_0_TO_1`);
  return value;
}

function mean(values, name) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) throw new Error(`${name}_VALUES_REQUIRED`);
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function validateLineup(side, lineup) {
  if (!Array.isArray(lineup) || lineup.length !== 11) throw new Error(`${side}_CONFIRMED_XI_MUST_HAVE_11_PLAYERS`);
  const ids = lineup.map((row) => row.playerId);
  if (ids.some((id) => !id)) throw new Error(`${side}_PLAYER_ID_REQUIRED`);
  if (new Set(ids).size !== 11) throw new Error(`${side}_CONFIRMED_XI_DUPLICATE_PLAYER`);
  for (const row of lineup) {
    if (!VALID_PHASE_ROLES.has(row.phaseRole)) throw new Error(`${side}_PHASE_ROLE_INVALID`);
    if (!VALID_ZONES.has(row.zone)) throw new Error(`${side}_ZONE_INVALID`);
  }
}

function profileFor(profiles, playerId, minimumSample) {
  const profile = profiles[playerId];
  if (!profile) throw new Error(`PLAYER_PROFILE_MISSING_${playerId}`);
  if (profile.verified !== true) throw new Error(`PLAYER_PROFILE_UNVERIFIED_${playerId}`);
  if (profile.competitionAdjusted !== true) throw new Error(`PLAYER_PROFILE_NOT_COMPETITION_ADJUSTED_${playerId}`);
  if (!Number.isInteger(profile.sampleSize) || profile.sampleSize < minimumSample) throw new Error(`PLAYER_PROFILE_SAMPLE_TOO_SMALL_${playerId}`);
  if (!profile.source || !profile.observedAt) throw new Error(`PLAYER_PROFILE_PROVENANCE_REQUIRED_${playerId}`);
  return profile;
}

function offensiveCapability(profile) {
  return mean([
    assert01('FINISHING', profile.finishing),
    assert01('SHOT_QUALITY', profile.shotQuality),
    assert01('CHANCE_CREATION', profile.chanceCreation),
    assert01('BALL_PROGRESSION', profile.ballProgression),
    assert01('DRIBBLING', profile.dribbling)
  ], 'OFFENSIVE_CAPABILITY');
}

function midfieldCapability(profile) {
  return mean([
    assert01('CHANCE_CREATION', profile.chanceCreation),
    assert01('BALL_PROGRESSION', profile.ballProgression),
    assert01('PRESS_RESISTANCE', profile.pressResistance),
    assert01('BALL_SECURITY', profile.ballSecurity),
    assert01('DEFENSIVE_DUELS', profile.defensiveDuels)
  ], 'MIDFIELD_CAPABILITY');
}

function defensiveCapability(profile) {
  return mean([
    assert01('DEFENSIVE_DUELS', profile.defensiveDuels),
    assert01('AERIAL_DEFENDING', profile.aerialDefending),
    assert01('INTERCEPTIONS', profile.interceptions),
    assert01('RECOVERY', profile.recovery),
    assert01('BALL_SECURITY', profile.ballSecurity)
  ], 'DEFENSIVE_CAPABILITY');
}

function goalkeeperCapability(profile) {
  return mean([
    assert01('SHOT_STOPPING', profile.shotStopping),
    assert01('GOALKEEPER_DISTRIBUTION', profile.goalkeeperDistribution),
    assert01('HIGH_CLAIMS', profile.highClaims)
  ], 'GOALKEEPER_CAPABILITY');
}

function roleCapability(row, profile) {
  if (row.phaseRole === 'ATTACK') return offensiveCapability(profile);
  if (row.phaseRole === 'MIDFIELD') return midfieldCapability(profile);
  if (row.phaseRole === 'DEFENCE') return defensiveCapability(profile);
  return goalkeeperCapability(profile);
}

function individualQuality(row, profile) {
  const base = roleCapability(row, profile);
  const availabilityFitness = Number.isFinite(profile.availabilityFitness)
    ? assert01('AVAILABILITY_FITNESS', profile.availabilityFitness)
    : 1;
  return clamp(base * availabilityFitness);
}

function buildSide(side, lineup, profiles, minimumSample) {
  const rows = lineup.map((row) => {
    const profile = profileFor(profiles, row.playerId, minimumSample);
    return Object.freeze({
      ...row,
      profile,
      offensive: row.phaseRole === 'GOALKEEPER' ? 0 : offensiveCapability(profile),
      midfield: row.phaseRole === 'GOALKEEPER' ? 0 : midfieldCapability(profile),
      defensive: row.phaseRole === 'GOALKEEPER' ? goalkeeperCapability(profile) : defensiveCapability(profile),
      individualQuality: individualQuality(row, profile),
      continuity: assert01('TEAM_CONTINUITY', profile.teamContinuity)
    });
  });
  const by = (phaseRole, zone) => rows.filter((row) => row.phaseRole === phaseRole && (!zone || row.zone === zone));
  const aggregate = (selected, field, fallback = null) => selected.length
    ? mean(selected.map((row) => row[field]), `${side}_${field}`)
    : fallback;
  const attackers = by('ATTACK');
  const midfielders = by('MIDFIELD');
  const defenders = by('DEFENCE');
  const goalkeepers = by('GOALKEEPER');
  if (goalkeepers.length !== 1) throw new Error(`${side}_EXACTLY_ONE_GOALKEEPER_REQUIRED`);

  const centralAttack = [...by('ATTACK', 'CENTRAL'), ...by('MIDFIELD', 'CENTRAL')];
  const centralDefence = [...by('DEFENCE', 'CENTRAL'), ...by('MIDFIELD', 'CENTRAL')];
  return Object.freeze({
    rows: Object.freeze(rows),
    attack: Object.freeze({
      left: aggregate(by('ATTACK', 'LEFT'), 'offensive', aggregate(attackers, 'offensive', 0.5)),
      central: aggregate(centralAttack, 'offensive', aggregate(attackers, 'offensive', 0.5)),
      right: aggregate(by('ATTACK', 'RIGHT'), 'offensive', aggregate(attackers, 'offensive', 0.5)),
      overall: aggregate(attackers, 'offensive', 0.5)
    }),
    midfield: aggregate(midfielders, 'midfield', 0.5),
    defence: Object.freeze({
      left: aggregate(by('DEFENCE', 'LEFT'), 'defensive', aggregate(defenders, 'defensive', 0.5)),
      central: aggregate(centralDefence, 'defensive', aggregate(defenders, 'defensive', 0.5)),
      right: aggregate(by('DEFENCE', 'RIGHT'), 'defensive', aggregate(defenders, 'defensive', 0.5)),
      overall: aggregate(defenders, 'defensive', 0.5)
    }),
    goalkeeper: aggregate(goalkeepers, 'defensive', 0.5),
    individualQuality: mean(rows.map((row) => row.individualQuality), `${side}_INDIVIDUAL_QUALITY`),
    lineupContinuity: mean(rows.map((row) => row.continuity), `${side}_LINEUP_CONTINUITY`)
  });
}

function matchupRow({ id, lane, homeCapability, awayCapability, source, observedAt, sampleSize, confidence = 0.82, detail = {} }) {
  return Object.freeze({
    id,
    lane,
    homeCapability: clamp(homeCapability),
    awayCapability: clamp(awayCapability),
    confidence: clamp(confidence),
    sampleSize,
    minimumSampleRequired: 5,
    observedAt,
    source,
    verified: true,
    correlationGroup: lane,
    detail: Object.freeze(detail)
  });
}

export function buildConfirmedLineupPlayerIntelligence({
  eventId,
  homeTeam,
  awayTeam,
  lineupObservation,
  playerProfiles,
  minimumPlayerSample = 8
}) {
  if (!eventId) throw new Error('EVENT_ID_REQUIRED');
  if (!lineupObservation || lineupObservation.status !== 'CONFIRMED' || lineupObservation.verified !== true) {
    throw new Error('CONFIRMED_VERIFIED_LINEUP_REQUIRED');
  }
  if (!lineupObservation.source || !lineupObservation.observedAt) throw new Error('LINEUP_PROVENANCE_REQUIRED');
  if (!Number.isInteger(minimumPlayerSample) || minimumPlayerSample < 1) throw new Error('MINIMUM_PLAYER_SAMPLE_INVALID');
  validateLineup('HOME', lineupObservation.home);
  validateLineup('AWAY', lineupObservation.away);

  const home = buildSide('HOME', lineupObservation.home, playerProfiles, minimumPlayerSample);
  const away = buildSide('AWAY', lineupObservation.away, playerProfiles, minimumPlayerSample);
  const sampleSize = Math.min(...[...lineupObservation.home, ...lineupObservation.away].map((row) => playerProfiles[row.playerId].sampleSize));
  const common = {
    source: lineupObservation.source,
    observedAt: lineupObservation.observedAt,
    sampleSize,
    confidence: 0.82
  };

  const playerMatchups = Object.freeze([
    matchupRow({ id: 'HOME_LEFT_ATTACK_V_AWAY_RIGHT_DEFENCE', lane: 'LEFT_CHANNEL', homeCapability: home.attack.left, awayCapability: away.defence.right, ...common }),
    matchupRow({ id: 'HOME_RIGHT_ATTACK_V_AWAY_LEFT_DEFENCE', lane: 'RIGHT_CHANNEL', homeCapability: home.attack.right, awayCapability: away.defence.left, ...common }),
    matchupRow({ id: 'HOME_CENTRAL_ATTACK_V_AWAY_CENTRAL_DEFENCE', lane: 'CENTRAL_ATTACK_HOME', homeCapability: home.attack.central, awayCapability: mean([away.defence.central, away.goalkeeper], 'AWAY_CENTRAL_DEFENCE_GK'), ...common }),
    matchupRow({ id: 'AWAY_LEFT_ATTACK_V_HOME_RIGHT_DEFENCE', lane: 'LEFT_ATTACK_AWAY', homeCapability: home.defence.right, awayCapability: away.attack.left, ...common }),
    matchupRow({ id: 'AWAY_RIGHT_ATTACK_V_HOME_LEFT_DEFENCE', lane: 'RIGHT_ATTACK_AWAY', homeCapability: home.defence.left, awayCapability: away.attack.right, ...common }),
    matchupRow({ id: 'AWAY_CENTRAL_ATTACK_V_HOME_CENTRAL_DEFENCE', lane: 'CENTRAL_ATTACK_AWAY', homeCapability: mean([home.defence.central, home.goalkeeper], 'HOME_CENTRAL_DEFENCE_GK'), awayCapability: away.attack.central, ...common }),
    matchupRow({ id: 'MIDFIELD_CONTROL', lane: 'MIDFIELD_CONTROL', homeCapability: home.midfield, awayCapability: away.midfield, ...common })
  ]);

  const playerQualityAndCohesion = Object.freeze({
    homeIndividualQuality: home.individualQuality,
    homeCohesion: home.lineupContinuity,
    awayIndividualQuality: away.individualQuality,
    awayCohesion: away.lineupContinuity,
    confidence: 0.8,
    sampleSize,
    observedAt: lineupObservation.observedAt,
    source: lineupObservation.source,
    verified: true,
    correlationGroup: 'CONFIRMED_XI_PLAYER_QUALITY_AND_CONTINUITY',
    notes: 'QUALITY_FROM_COMPETITION_ADJUSTED_PLAYER_PROFILES; COHESION_FROM_PRIOR_TEAM_CONTINUITY'
  });

  return Object.freeze({
    version: 'PLAYER_MATCHUP_INTELLIGENCE_V0_1',
    eventId,
    homeTeam,
    awayTeam,
    lineupObservation: Object.freeze({
      status: lineupObservation.status,
      observedAt: lineupObservation.observedAt,
      source: lineupObservation.source,
      verified: lineupObservation.verified
    }),
    home,
    away,
    playerMatchups,
    playerQualityAndCohesion,
    readiness: 'PLAYER_DOMAINS_READY',
    governance: Object.freeze({
      confirmedLineupRequired: true,
      predictedLineupForbidden: true,
      playerProfilesMustBeVerified: true,
      competitionAdjustmentRequired: true,
      reputationOrNameAloneForbidden: true,
      bookmakerOddsUsed: false,
      rawPlayerMatchupsCannotRewriteLambdaWithoutCalibration: true
    })
  });
}

export function toRealFootballPlayerEvidence(playerIntelligence) {
  if (!playerIntelligence || playerIntelligence.readiness !== 'PLAYER_DOMAINS_READY') {
    throw new Error('PLAYER_INTELLIGENCE_NOT_READY');
  }
  return Object.freeze({
    lineupStatus: 'CONFIRMED',
    verified: true,
    playerMatchups: playerIntelligence.playerMatchups,
    playerQualityAndCohesion: playerIntelligence.playerQualityAndCohesion,
    sourceVersion: playerIntelligence.version,
    observedAt: playerIntelligence.lineupObservation.observedAt,
    source: playerIntelligence.lineupObservation.source
  });
}
