export const TEAM_MATCH_INTELLIGENCE_DOMAINS = Object.freeze([
  'PLAYER_MATCHUP',
  'TEAM_COHESION',
  'PLAYER_QUALITY_AND_COHESION',
  'TRANSFER_IMPACT',
  'ATTACK_VS_DEFENCE',
  'TEMPORAL_SCORING_DEFENDING',
  'LEAGUE_AND_CLUB_STRENGTH',
  'SHOT_AND_CHANCE_QUALITY',
  'POSITION_HOME_AWAY_ENVIRONMENT',
  'HEAD_TO_HEAD',
  'MATCH_STATISTICS_PATTERNS'
]);

function assert01(name, value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name}_MUST_BE_0_TO_1`);
  return value;
}

function mean(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) throw new Error('NORMALIZED_FEATURES_REQUIRED');
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function meta(section, fallbackGroup) {
  return {
    confidence: assert01('CONFIDENCE', section.confidence),
    sampleSize: section.sampleSize,
    minimumSampleRequired: Number.isInteger(section.minimumSampleRequired) ? section.minimumSampleRequired : null,
    observedAt: section.observedAt,
    source: section.source,
    verified: section.verified === true,
    correlationGroup: section.correlationGroup ?? fallbackGroup,
    notes: section.notes ?? null
  };
}

function signal(domain, id, impact, section, fallbackGroup, detail = {}) {
  if (!TEAM_MATCH_INTELLIGENCE_DOMAINS.includes(domain)) throw new Error('UNKNOWN_TEAM_MATCH_DOMAIN');
  if (!Number.isFinite(impact) || impact < -1 || impact > 1) throw new Error('SIGNAL_IMPACT_MUST_BE_MINUS1_TO_1');
  return Object.freeze({ id, domain, impact, ...meta(section, fallbackGroup), detail: Object.freeze({ ...detail }) });
}

function pairImpact(home, away, homeName, awayName) {
  return assert01(homeName, home) - assert01(awayName, away);
}

export function deriveTeamMatchSignals(featureSet) {
  if (!featureSet || typeof featureSet !== 'object') throw new Error('TEAM_MATCH_FEATURE_SET_REQUIRED');
  const signals = [];

  for (const [index, row] of (featureSet.playerMatchups ?? []).entries()) {
    const impact = pairImpact(row.homeCapability, row.awayCapability, 'HOME_PLAYER_CAPABILITY', 'AWAY_PLAYER_CAPABILITY');
    signals.push(signal('PLAYER_MATCHUP', row.id ?? `PLAYER_MATCHUP_${index + 1}`, impact, row, row.lane ?? `PLAYER_MATCHUP_${index + 1}`, {
      homePlayerId: row.homePlayerId ?? null,
      awayPlayerId: row.awayPlayerId ?? null,
      lane: row.lane ?? null,
      homeCapability: row.homeCapability,
      awayCapability: row.awayCapability
    }));
  }

  if (featureSet.teamCohesion) {
    const row = featureSet.teamCohesion;
    signals.push(signal('TEAM_COHESION', 'TEAM_COHESION', pairImpact(row.home, row.away, 'HOME_COHESION', 'AWAY_COHESION'), row, 'SQUAD_COHESION', { home: row.home, away: row.away }));
  }

  if (featureSet.playerQualityAndCohesion) {
    const row = featureSet.playerQualityAndCohesion;
    const home = mean([assert01('HOME_INDIVIDUAL_QUALITY', row.homeIndividualQuality), assert01('HOME_COHESION_QUALITY', row.homeCohesion)]);
    const away = mean([assert01('AWAY_INDIVIDUAL_QUALITY', row.awayIndividualQuality), assert01('AWAY_COHESION_QUALITY', row.awayCohesion)]);
    signals.push(signal('PLAYER_QUALITY_AND_COHESION', 'PLAYER_QUALITY_AND_COHESION', home - away, row, 'SQUAD_QUALITY_COHESION', { home, away }));
  }

  if (featureSet.transferImpact) {
    const row = featureSet.transferImpact;
    signals.push(signal('TRANSFER_IMPACT', 'TRANSFER_WINDOW_NET_IMPACT', pairImpact(row.homeNetImpact, row.awayNetImpact, 'HOME_TRANSFER_IMPACT', 'AWAY_TRANSFER_IMPACT'), row, 'SQUAD_TRANSITION', {
      homeNetImpact: row.homeNetImpact,
      awayNetImpact: row.awayNetImpact,
      homeIncomingImpact: row.homeIncomingImpact ?? null,
      homeOutgoingLoss: row.homeOutgoingLoss ?? null,
      awayIncomingImpact: row.awayIncomingImpact ?? null,
      awayOutgoingLoss: row.awayOutgoingLoss ?? null
    }));
  }

  if (featureSet.attackVsDefence) {
    const row = featureSet.attackVsDefence;
    const homeThreat = mean([assert01('HOME_ATTACK', row.homeAttack), assert01('AWAY_DEFENSIVE_VULNERABILITY', row.awayDefensiveVulnerability)]);
    const awayThreat = mean([assert01('AWAY_ATTACK', row.awayAttack), assert01('HOME_DEFENSIVE_VULNERABILITY', row.homeDefensiveVulnerability)]);
    signals.push(signal('ATTACK_VS_DEFENCE', 'ATTACK_VS_DEFENCE_MATCHUP', homeThreat - awayThreat, row, 'CHANCE_CREATION_AND_PREVENTION', { homeThreat, awayThreat }));
  }

  if (featureSet.temporalScoringDefending) {
    const row = featureSet.temporalScoringDefending;
    const homeTemporal = mean([
      assert01('HOME_SCORING_TIMING', row.homeScoringTimingStrength),
      assert01('AWAY_CONCEDING_TIMING_VULNERABILITY', row.awayConcedingTimingVulnerability),
      assert01('HOME_LEAD_RETENTION', row.homeLeadRetention)
    ]);
    const awayTemporal = mean([
      assert01('AWAY_SCORING_TIMING', row.awayScoringTimingStrength),
      assert01('HOME_CONCEDING_TIMING_VULNERABILITY', row.homeConcedingTimingVulnerability),
      assert01('AWAY_LEAD_RETENTION', row.awayLeadRetention)
    ]);
    signals.push(signal('TEMPORAL_SCORING_DEFENDING', 'TEMPORAL_SCORING_DEFENDING', homeTemporal - awayTemporal, row, 'TEMPORAL_MATCH_BEHAVIOUR', {
      homeTemporal,
      awayTemporal,
      periodBins: row.periodBins ?? ['0-15', '16-30', '31-45+', '46-60', '61-75', '76-90+']
    }));
  }

  if (featureSet.leagueAndClubStrength) {
    const row = featureSet.leagueAndClubStrength;
    const home = mean([assert01('HOME_LEAGUE_STRENGTH', row.homeLeagueStrength), assert01('HOME_CLUB_STRENGTH', row.homeClubStrength)]);
    const away = mean([assert01('AWAY_LEAGUE_STRENGTH', row.awayLeagueStrength), assert01('AWAY_CLUB_STRENGTH', row.awayClubStrength)]);
    signals.push(signal('LEAGUE_AND_CLUB_STRENGTH', 'LEAGUE_AND_CLUB_STRENGTH', home - away, row, 'CROSS_COMPETITION_STRENGTH', { home, away }));
  }

  if (featureSet.shotAndChanceQuality) {
    const row = featureSet.shotAndChanceQuality;
    const homeThreat = mean([
      assert01('HOME_SHOT_QUALITY', row.homeShotQuality),
      assert01('HOME_SHOTS_ON_TARGET_QUALITY', row.homeShotsOnTargetQuality),
      assert01('AWAY_SHOT_DEFENCE_VULNERABILITY', row.awayShotDefenceVulnerability)
    ]);
    const awayThreat = mean([
      assert01('AWAY_SHOT_QUALITY', row.awayShotQuality),
      assert01('AWAY_SHOTS_ON_TARGET_QUALITY', row.awayShotsOnTargetQuality),
      assert01('HOME_SHOT_DEFENCE_VULNERABILITY', row.homeShotDefenceVulnerability)
    ]);
    signals.push(signal('SHOT_AND_CHANCE_QUALITY', 'SHOT_AND_CHANCE_QUALITY', homeThreat - awayThreat, row, 'CHANCE_CREATION_AND_PREVENTION', {
      homeThreat,
      awayThreat,
      rawContext: row.rawContext ?? null
    }));
  }

  if (featureSet.positionHomeAwayEnvironment) {
    const row = featureSet.positionHomeAwayEnvironment;
    const home = mean([
      assert01('HOME_POSITION_STRENGTH', row.homePositionStrength),
      assert01('HOME_VENUE_STRENGTH', row.homeVenueStrength),
      assert01('HOME_PSYCHOLOGY_ENVIRONMENT', row.homePsychologyEnvironment)
    ]);
    const away = mean([
      assert01('AWAY_POSITION_STRENGTH', row.awayPositionStrength),
      assert01('AWAY_AWAY_STRENGTH', row.awayAwayStrength),
      assert01('AWAY_PSYCHOLOGY_ENVIRONMENT', row.awayPsychologyEnvironment)
    ]);
    signals.push(signal('POSITION_HOME_AWAY_ENVIRONMENT', 'POSITION_HOME_AWAY_ENVIRONMENT', home - away, row, 'CONTEXT_AND_ENVIRONMENT', { home, away }));
  }

  if (featureSet.headToHead) {
    const row = featureSet.headToHead;
    const relevance = assert01('H2H_RELEVANCE', row.relevance);
    const raw = pairImpact(row.homeStrength, row.awayStrength, 'HOME_H2H_STRENGTH', 'AWAY_H2H_STRENGTH');
    signals.push(signal('HEAD_TO_HEAD', 'HEAD_TO_HEAD_RELEVANCE_WEIGHTED', raw * relevance, row, 'HEAD_TO_HEAD', {
      relevance,
      homeStrength: row.homeStrength,
      awayStrength: row.awayStrength,
      managerContinuity: row.managerContinuity ?? null,
      squadContinuity: row.squadContinuity ?? null
    }));
  }

  if (featureSet.matchStatisticsPatterns) {
    const row = featureSet.matchStatisticsPatterns;
    signals.push(signal('MATCH_STATISTICS_PATTERNS', 'MATCH_STATISTICS_PATTERNS', pairImpact(row.homePatternStrength, row.awayPatternStrength, 'HOME_PATTERN_STRENGTH', 'AWAY_PATTERN_STRENGTH'), row, 'MATCH_PATTERN_EVIDENCE', {
      homePatternStrength: row.homePatternStrength,
      awayPatternStrength: row.awayPatternStrength,
      patterns: row.patterns ?? []
    }));
  }

  return Object.freeze(signals);
}
