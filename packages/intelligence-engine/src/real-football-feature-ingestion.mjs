import { buildTeamMatchIntelligence } from './team-match-intelligence.mjs';

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function mean(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) throw new Error('REAL_FEATURE_VALUES_REQUIRED');
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function scale(value, bounds, name) {
  if (!Number.isFinite(value)) throw new Error(`${name}_VALUE_INVALID`);
  if (!bounds || !Number.isFinite(bounds.min) || !Number.isFinite(bounds.max) || bounds.max <= bounds.min) {
    throw new Error(`${name}_BOUNDS_INVALID`);
  }
  return clamp((value - bounds.min) / (bounds.max - bounds.min));
}

function venueStrength(goalsFor, goalsAgainst, matches) {
  if (!Number.isFinite(goalsFor) || !Number.isFinite(goalsAgainst) || !Number.isFinite(matches) || matches <= 0) {
    throw new Error('VENUE_STATS_INVALID');
  }
  const goalDifferencePerMatch = (goalsFor - goalsAgainst) / matches;
  return 0.5 + 0.5 * Math.tanh(goalDifferencePerMatch);
}

function managerContinuityScore(value) {
  if (value === 'CONTINUING') return 1;
  if (value === 'NEW') return 0.35;
  return 0.5;
}

function transitionContinuityScore(value) {
  return ({ LOW: 0.85, MEDIUM: 0.65, HIGH: 0.4 }[value] ?? 0.5);
}

function availabilityHealth({ confirmedUnavailable = 0, doubtful = 0 } = {}) {
  if (!Number.isInteger(confirmedUnavailable) || confirmedUnavailable < 0) throw new Error('CONFIRMED_UNAVAILABLE_INVALID');
  if (!Number.isInteger(doubtful) || doubtful < 0) throw new Error('DOUBTFUL_COUNT_INVALID');
  return clamp(1 - confirmedUnavailable * 0.08 - doubtful * 0.04, 0.4, 1);
}

function contextCohesion(side) {
  return mean([
    managerContinuityScore(side.managerContinuity),
    transitionContinuityScore(side.squadTransitionRisk),
    availabilityHealth(side)
  ]);
}

function statisticalMeta(dataset, correlationGroup, confidence = 0.9) {
  return {
    confidence,
    sampleSize: dataset.statisticalSampleSize,
    observedAt: dataset.historicalAsOf,
    source: dataset.sourceBundles.seasonTeamStats.primary,
    verified: dataset.sourceBundles.seasonTeamStats.verified === true,
    correlationGroup
  };
}

function contextMeta(event, correlationGroup, confidence = 0.65) {
  return {
    confidence,
    sampleSize: 1,
    minimumSampleRequired: 1,
    observedAt: event.context.observedAt,
    source: event.context.sourceUrls[0],
    verified: event.context.verified === true,
    correlationGroup,
    notes: event.context.sourceUrls.join(' | ')
  };
}

function h2hMeta(event) {
  return {
    confidence: 0.72,
    sampleSize: event.h2h.matches,
    observedAt: event.h2h.observedAt,
    source: event.h2h.sourceUrl,
    verified: event.h2h.verified === true,
    correlationGroup: 'HEAD_TO_HEAD'
  };
}

function attackScore(stats, bounds) {
  return mean([
    scale(stats.xG, bounds.xG, 'XG'),
    scale(stats.goalsFor, bounds.goalsFor, 'GOALS_FOR'),
    scale(stats.shotsOnTarget, bounds.shotsOnTarget, 'SHOTS_ON_TARGET'),
    scale(stats.shots, bounds.shots, 'SHOTS')
  ]);
}

function defensiveVulnerability(stats, bounds) {
  return mean([
    scale(stats.xGA, bounds.xGA, 'XGA'),
    scale(stats.goalsAgainst, bounds.goalsAgainst, 'GOALS_AGAINST')
  ]);
}

function shotQuality(stats, bounds) {
  const xGPerShot = stats.xG / stats.shots;
  const sotRate = stats.shotsOnTarget / stats.shots;
  return mean([
    scale(xGPerShot, bounds.xGPerShot, 'XG_PER_SHOT'),
    scale(sotRate, bounds.shotsOnTargetRate, 'SOT_RATE')
  ]);
}

function temporalScoringStrength(stats, bounds) {
  return mean([
    scale(stats.goalsForFirst15, bounds.goalsForFirst15, 'GOALS_FOR_FIRST_15'),
    scale(stats.goalsForLast10, bounds.goalsForLast10, 'GOALS_FOR_LAST_10'),
    scale(stats.goalsForSecondHalf, bounds.goalsForSecondHalf, 'GOALS_FOR_SECOND_HALF')
  ]);
}

function temporalConcedingVulnerability(stats, bounds) {
  return mean([
    scale(stats.goalsAgainstFirst15, bounds.goalsAgainstFirst15, 'GOALS_AGAINST_FIRST_15'),
    scale(stats.goalsAgainstLast10, bounds.goalsAgainstLast10, 'GOALS_AGAINST_LAST_10'),
    scale(stats.goalsAgainstSecondHalf, bounds.goalsAgainstSecondHalf, 'GOALS_AGAINST_SECOND_HALF')
  ]);
}

function leadRetentionScore(stats, eventLeadEvidence, bounds) {
  if (eventLeadEvidence?.type === 'DIRECT_DROPPED_POINTS' && Number.isFinite(eventLeadEvidence.droppedPoints)) {
    const cap = Number.isFinite(eventLeadEvidence.cap) && eventLeadEvidence.cap > 0 ? eventLeadEvidence.cap : 30;
    return clamp(1 - eventLeadEvidence.droppedPoints / cap);
  }
  return 1 - scale(stats.goalsAgainstLast10, bounds.goalsAgainstLast10, 'GOALS_AGAINST_LAST_10');
}

function scoringConsistency(stats) {
  return clamp(1 - stats.zeroGoalMatches / stats.matches);
}

function cleanSheetRate(stats) {
  return clamp(stats.cleanSheets / stats.matches);
}

function clubStrength(stats, bounds) {
  return scale(stats.points, bounds.points, 'POINTS');
}

function h2hStrength(wins, draws, matches) {
  if (!Number.isInteger(matches) || matches <= 0) throw new Error('H2H_MATCHES_INVALID');
  return clamp((wins + 0.5 * draws) / matches);
}

function requiredEvent(dataset, eventId) {
  const event = dataset.events.find((row) => row.eventId === eventId);
  if (!event) throw new Error(`REAL_FEATURE_EVENT_NOT_FOUND_${eventId}`);
  return event;
}

function requiredTeam(dataset, teamId) {
  const team = dataset.teams[teamId];
  if (!team) throw new Error(`REAL_FEATURE_TEAM_NOT_FOUND_${teamId}`);
  return team;
}

export function normalizeRealFootballEventObservation(dataset, eventId) {
  if (!dataset?.datasetId || !dataset?.leagueBenchmarks || !dataset?.teams || !Array.isArray(dataset?.events)) {
    throw new Error('REAL_FOOTBALL_FEATURE_DATASET_INVALID');
  }
  const event = requiredEvent(dataset, eventId);
  const homeStats = requiredTeam(dataset, event.homeTeamId);
  const awayStats = requiredTeam(dataset, event.awayTeamId);
  const b = dataset.leagueBenchmarks;

  const homeLeadRetention = leadRetentionScore(homeStats, event.leadRetentionEvidence?.home, b);
  const awayLeadRetention = leadRetentionScore(awayStats, event.leadRetentionEvidence?.away, b);

  const featureSet = {
    teamCohesion: {
      ...contextMeta(event, 'SQUAD_COHESION', 0.64),
      home: contextCohesion(event.context.home),
      away: contextCohesion(event.context.away),
      notes: `HEURISTIC_EXPLANATION_ONLY_NO_LAMBDA_REWRITE | ${event.context.sourceUrls.join(' | ')}`
    },
    attackVsDefence: {
      ...statisticalMeta(dataset, 'CHANCE_CREATION_AND_PREVENTION', 0.92),
      homeAttack: attackScore(homeStats, b),
      awayDefensiveVulnerability: defensiveVulnerability(awayStats, b),
      awayAttack: attackScore(awayStats, b),
      homeDefensiveVulnerability: defensiveVulnerability(homeStats, b)
    },
    temporalScoringDefending: {
      ...statisticalMeta(dataset, 'TEMPORAL_MATCH_BEHAVIOUR', 0.88),
      homeScoringTimingStrength: temporalScoringStrength(homeStats, b),
      awayConcedingTimingVulnerability: temporalConcedingVulnerability(awayStats, b),
      homeLeadRetention,
      awayScoringTimingStrength: temporalScoringStrength(awayStats, b),
      homeConcedingTimingVulnerability: temporalConcedingVulnerability(homeStats, b),
      awayLeadRetention,
      periodBins: ['0-15', '16-30', '31-45+', '46-60', '61-75', '76-90+']
    },
    leagueAndClubStrength: {
      ...statisticalMeta(dataset, 'CROSS_COMPETITION_STRENGTH', 0.9),
      homeLeagueStrength: event.sameLeague ? 1 : event.crossLeagueStrength.home,
      homeClubStrength: clubStrength(homeStats, b),
      awayLeagueStrength: event.sameLeague ? 1 : event.crossLeagueStrength.away,
      awayClubStrength: clubStrength(awayStats, b),
      notes: event.sameLeague ? 'SAME_LEAGUE_NO_LEAGUE_QUALITY_DIFFERENTIAL' : 'CROSS_LEAGUE_COEFFICIENT_REQUIRED'
    },
    shotAndChanceQuality: {
      ...statisticalMeta(dataset, 'CHANCE_CREATION_AND_PREVENTION', 0.9),
      homeShotQuality: shotQuality(homeStats, b),
      homeShotsOnTargetQuality: scale(homeStats.shotsOnTarget / homeStats.shots, b.shotsOnTargetRate, 'HOME_SOT_RATE'),
      awayShotDefenceVulnerability: defensiveVulnerability(awayStats, b),
      awayShotQuality: shotQuality(awayStats, b),
      awayShotsOnTargetQuality: scale(awayStats.shotsOnTarget / awayStats.shots, b.shotsOnTargetRate, 'AWAY_SOT_RATE'),
      homeShotDefenceVulnerability: defensiveVulnerability(homeStats, b),
      rawContext: {
        home: { xG: homeStats.xG, shots: homeStats.shots, shotsOnTarget: homeStats.shotsOnTarget, xGA: homeStats.xGA },
        away: { xG: awayStats.xG, shots: awayStats.shots, shotsOnTarget: awayStats.shotsOnTarget, xGA: awayStats.xGA }
      }
    },
    positionHomeAwayEnvironment: {
      ...statisticalMeta(dataset, 'CONTEXT_AND_ENVIRONMENT', 0.88),
      homePositionStrength: clubStrength(homeStats, b),
      homeVenueStrength: venueStrength(homeStats.homeGoalsFor, homeStats.homeGoalsAgainst, homeStats.homeMatches),
      homePsychologyEnvironment: 0.5,
      awayPositionStrength: clubStrength(awayStats, b),
      awayAwayStrength: venueStrength(awayStats.awayGoalsFor, awayStats.awayGoalsAgainst, awayStats.awayMatches),
      awayPsychologyEnvironment: 0.5,
      notes: 'PSYCHOLOGY_LEFT_NEUTRAL_UNLESS_OBJECTIVELY_MEASURED; HOME_AWAY_AND_TABLE_POSITION_ACTIVE'
    },
    headToHead: {
      ...h2hMeta(event),
      homeStrength: h2hStrength(event.h2h.homeWins, event.h2h.draws, event.h2h.matches),
      awayStrength: h2hStrength(event.h2h.awayWins, event.h2h.draws, event.h2h.matches),
      relevance: event.h2h.relevance,
      managerContinuity: mean([
        managerContinuityScore(event.context.home.managerContinuity),
        managerContinuityScore(event.context.away.managerContinuity)
      ]),
      squadContinuity: mean([
        transitionContinuityScore(event.context.home.squadTransitionRisk),
        transitionContinuityScore(event.context.away.squadTransitionRisk)
      ])
    },
    matchStatisticsPatterns: {
      ...statisticalMeta(dataset, 'SEASON_GAMESTATE_PATTERNS', 0.86),
      homePatternStrength: mean([scoringConsistency(homeStats), cleanSheetRate(homeStats), homeLeadRetention]),
      awayPatternStrength: mean([scoringConsistency(awayStats), cleanSheetRate(awayStats), awayLeadRetention]),
      patterns: [
        'SCORING_CONSISTENCY',
        'CLEAN_SHEET_RATE',
        event.leadRetentionEvidence?.home?.type === 'DIRECT_DROPPED_POINTS' || event.leadRetentionEvidence?.away?.type === 'DIRECT_DROPPED_POINTS'
          ? 'DIRECT_AND_PROXY_LEAD_RETENTION'
          : 'LATE_CONCESSION_LEAD_RETENTION_PROXY'
      ]
    }
  };

  const pendingDomains = [];
  if (event.playerEvidence?.lineupStatus !== 'CONFIRMED' || event.playerEvidence?.verified !== true) {
    pendingDomains.push('PLAYER_MATCHUP', 'PLAYER_QUALITY_AND_COHESION');
  }
  if (event.transferAudit?.complete !== true || event.transferAudit?.verified !== true) {
    pendingDomains.push('TRANSFER_IMPACT');
  } else {
    featureSet.transferImpact = {
      ...contextMeta(event, 'SQUAD_TRANSITION', 0.6),
      homeNetImpact: event.transferAudit.home.netImpact,
      awayNetImpact: event.transferAudit.away.netImpact,
      homeIncomingImpact: event.transferAudit.home.incomingImpact,
      homeOutgoingLoss: event.transferAudit.home.outgoingLoss,
      awayIncomingImpact: event.transferAudit.away.incomingImpact,
      awayOutgoingLoss: event.transferAudit.away.outgoingLoss,
      notes: 'VERIFIED_COMPLETE_TRANSFER_AUDIT_REQUIRED; HEURISTIC_OUTPUT_CANNOT_REWRITE_LAMBDA_WITHOUT_CALIBRATION'
    };
  }

  if (event.playerEvidence?.lineupStatus === 'CONFIRMED' && event.playerEvidence?.verified === true) {
    if (Array.isArray(event.playerEvidence.playerMatchups) && event.playerEvidence.playerMatchups.length) {
      featureSet.playerMatchups = event.playerEvidence.playerMatchups;
    }
    if (event.playerEvidence.playerQualityAndCohesion) {
      featureSet.playerQualityAndCohesion = event.playerEvidence.playerQualityAndCohesion;
    }
  }

  return Object.freeze({
    version: 'REAL_FOOTBALL_FEATURE_INGESTION_V0_1',
    datasetId: dataset.datasetId,
    eventId,
    homeTeam: event.homeTeam,
    awayTeam: event.awayTeam,
    featureSet: Object.freeze(featureSet),
    pendingDomains: Object.freeze([...new Set(pendingDomains)]),
    rawAudit: Object.freeze({
      homeTeamId: event.homeTeamId,
      awayTeamId: event.awayTeamId,
      historicalAsOf: dataset.historicalAsOf,
      contextObservedAt: event.context.observedAt,
      sameLeague: event.sameLeague,
      transferAuditComplete: event.transferAudit?.complete === true,
      lineupStatus: event.playerEvidence?.lineupStatus ?? 'UNKNOWN',
      leadRetentionEvidence: event.leadRetentionEvidence ?? null,
      sourceBundles: dataset.sourceBundles
    }),
    governance: Object.freeze({
      rawFactsStoredSeparatelyFromNormalizedFeatures: true,
      leagueWideBenchmarksUsedForNormalization: true,
      playerMatchupsRequireConfirmedVerifiedLineups: true,
      transferImpactRequiresCompleteVerifiedAudit: true,
      subjectivePsychologyNotInvented: true,
      contextHeuristicsAreExplanationOnlyUntilCalibration: true,
      bookmakerOddsUsedAsFootballFeatures: false
    })
  });
}

export function processRealFootballFeatureBatch(dataset, { asOf = dataset.capturedAt, minimumSample = 5, maxAgeDays = 365 } = {}) {
  const events = dataset.events.map((event) => {
    const normalized = normalizeRealFootballEventObservation(dataset, event.eventId);
    const intelligence = buildTeamMatchIntelligence({
      eventId: event.eventId,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      asOf,
      featureSet: normalized.featureSet,
      minimumSample,
      maxAgeDays
    });
    return Object.freeze({
      eventId: event.eventId,
      match: `${event.homeTeam} vs ${event.awayTeam}`,
      normalized,
      intelligence,
      state: intelligence.state,
      pendingDomains: normalized.pendingDomains,
      realMoney: 'NO'
    });
  });

  return Object.freeze({
    reportVersion: 'REAL_FOOTBALL_FEATURE_INGESTION_REPORT_V0_1',
    datasetId: dataset.datasetId,
    asOf,
    summary: Object.freeze({
      eventsReceived: events.length,
      mature: events.filter((x) => x.state === 'ANALYSIS_MATURE').length,
      partial: events.filter((x) => x.state === 'ANALYSIS_PARTIAL').length,
      blocked: events.filter((x) => x.state === 'ANALYSIS_BLOCKED').length,
      playerDomainsPending: events.filter((x) => x.pendingDomains.includes('PLAYER_MATCHUP')).length,
      transferDomainsPending: events.filter((x) => x.pendingDomains.includes('TRANSFER_IMPACT')).length
    }),
    events: Object.freeze(events),
    governance: Object.freeze({
      analysisBeforeMarket: true,
      noLambdaRewriteWithoutIndependentCalibration: true,
      incompleteTransferOrPlayerEvidenceRemainsPending: true,
      capitalLocked: true,
      realMoney: 'NO'
    })
  });
}
