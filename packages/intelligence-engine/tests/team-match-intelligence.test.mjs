import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTeamMatchSignals } from '../src/team-match-feature-signals.mjs';
import { buildTeamMatchIntelligence } from '../src/team-match-intelligence.mjs';
import { applyCalibratedTeamIntelligence } from '../src/calibrated-intelligence-adjustment.mjs';
import { buildMatchDecisionUniverse } from '../src/match-decision-universe.mjs';

const observedAt = '2026-08-20T12:00:00Z';
const asOf = '2026-08-23T00:00:00Z';
const meta = { confidence: 0.9, sampleSize: 38, observedAt, source: 'TEST_VERIFIED_SOURCE', verified: true };

function fullFeatureSet() {
  return {
    playerMatchups: [
      { ...meta, id: 'LW_V_RB', lane: 'LEFT_CHANNEL', homeCapability: 0.82, awayCapability: 0.61, homePlayerId: 'H-LW', awayPlayerId: 'A-RB' }
    ],
    teamCohesion: { ...meta, home: 0.78, away: 0.63 },
    playerQualityAndCohesion: { ...meta, homeIndividualQuality: 0.84, homeCohesion: 0.78, awayIndividualQuality: 0.72, awayCohesion: 0.63 },
    transferImpact: { ...meta, homeNetImpact: 0.71, awayNetImpact: 0.52, homeIncomingImpact: 0.75, homeOutgoingLoss: 0.31, awayIncomingImpact: 0.61, awayOutgoingLoss: 0.48 },
    attackVsDefence: { ...meta, homeAttack: 0.83, awayDefensiveVulnerability: 0.69, awayAttack: 0.66, homeDefensiveVulnerability: 0.42 },
    temporalScoringDefending: { ...meta, homeScoringTimingStrength: 0.76, awayConcedingTimingVulnerability: 0.67, homeLeadRetention: 0.79, awayScoringTimingStrength: 0.61, homeConcedingTimingVulnerability: 0.41, awayLeadRetention: 0.55 },
    leagueAndClubStrength: { ...meta, homeLeagueStrength: 0.88, homeClubStrength: 0.83, awayLeagueStrength: 0.78, awayClubStrength: 0.67 },
    shotAndChanceQuality: { ...meta, homeShotQuality: 0.81, homeShotsOnTargetQuality: 0.78, awayShotDefenceVulnerability: 0.68, awayShotQuality: 0.64, awayShotsOnTargetQuality: 0.59, homeShotDefenceVulnerability: 0.43 },
    positionHomeAwayEnvironment: { ...meta, homePositionStrength: 0.8, homeVenueStrength: 0.84, homePsychologyEnvironment: 0.72, awayPositionStrength: 0.64, awayAwayStrength: 0.57, awayPsychologyEnvironment: 0.6 },
    headToHead: { ...meta, homeStrength: 0.68, awayStrength: 0.52, relevance: 0.5, managerContinuity: 0.7, squadContinuity: 0.6 },
    matchStatisticsPatterns: { ...meta, homePatternStrength: 0.74, awayPatternStrength: 0.58, patterns: ['HOME_CREATES_HIGH_QUALITY_CHANCES', 'AWAY_LATE_CONCESSION_RISK'] }
  };
}

function calibration() {
  const domains = [
    'PLAYER_MATCHUP', 'TEAM_COHESION', 'PLAYER_QUALITY_AND_COHESION', 'TRANSFER_IMPACT',
    'ATTACK_VS_DEFENCE', 'TEMPORAL_SCORING_DEFENDING', 'LEAGUE_AND_CLUB_STRENGTH',
    'SHOT_AND_CHANCE_QUALITY', 'POSITION_HOME_AWAY_ENVIRONMENT', 'HEAD_TO_HEAD', 'MATCH_STATISTICS_PATTERNS'
  ];
  return {
    verified: true,
    version: 'TEST_CALIBRATION_V1',
    sampleSize: 500,
    provenance: 'OUT_OF_SAMPLE_TEST_SET',
    usesBookmakerOdds: false,
    domainCoefficients: Object.fromEntries(domains.map((domain) => [domain, { homeLambdaBeta: 0.08, awayLambdaBeta: -0.05 }]))
  };
}

test('derives all eleven football intelligence domains', () => {
  const signals = deriveTeamMatchSignals(fullFeatureSet());
  assert.equal(new Set(signals.map((x) => x.domain)).size, 11);
  assert.equal(signals.length, 11);
  assert.ok(signals.every((x) => x.impact >= -1 && x.impact <= 1));
});

test('builds mature team-first analysis with support and counter structure', () => {
  const intelligence = buildTeamMatchIntelligence({ eventId: 'E1', homeTeam: 'HOME FC', awayTeam: 'AWAY FC', asOf, featureSet: fullFeatureSet() });
  assert.equal(intelligence.state, 'ANALYSIS_MATURE');
  assert.equal(intelligence.domainBoard.filter((x) => x.state === 'ACTIVE').length, 11);
  assert.equal(intelligence.favoredSide, 'HOME');
  assert.ok(intelligence.overallDirectionalScore > 0);
  assert.ok(intelligence.reliability > 0.55);
});

test('correlated attack and shot families are visible but counted once in composite', () => {
  const intelligence = buildTeamMatchIntelligence({ asOf, featureSet: fullFeatureSet() });
  const overlapping = intelligence.domainBoard.filter((x) => ['ATTACK_VS_DEFENCE', 'SHOT_AND_CHANCE_QUALITY'].includes(x.domain));
  assert.equal(overlapping.length, 2);
  assert.ok(overlapping.every((x) => x.state === 'ACTIVE'));
  assert.ok(intelligence.suppressedCrossDomainCorrelations >= 1);
  assert.equal(intelligence.compositeCorrelationGroups.filter((x) => x.correlationGroup === 'CHANCE_CREATION_AND_PREVENTION').length, 1);
});

test('stale and unverified signals cannot contribute', () => {
  const signals = deriveTeamMatchSignals(fullFeatureSet()).map((x, index) => index === 0 ? { ...x, verified: false } : x);
  const intelligence = buildTeamMatchIntelligence({ asOf, signals, maxAgeDays: 365 });
  assert.equal(intelligence.domainBoard.find((x) => x.domain === 'PLAYER_MATCHUP').state, 'MISSING_OR_INELIGIBLE');
  assert.ok(intelligence.missingDomains.includes('PLAYER_MATCHUP'));
});

test('counter evidence creates contradiction pressure instead of being discarded', () => {
  const signals = [
    ...deriveTeamMatchSignals(fullFeatureSet()),
    Object.freeze({
      id: 'AWAY_COUNTER', domain: 'MATCH_STATISTICS_PATTERNS', impact: -0.8, confidence: 0.95, sampleSize: 38,
      observedAt, source: 'TEST_COUNTER_SOURCE', verified: true, correlationGroup: 'AWAY_COUNTER_PATTERN', detail: Object.freeze({})
    })
  ];
  const intelligence = buildTeamMatchIntelligence({ asOf, signals });
  assert.ok(intelligence.counterEvidence.length >= 1);
  assert.ok(intelligence.contradictionPressure > 0);
});

test('uncalibrated intelligence cannot rewrite lambdas', () => {
  const intelligence = buildTeamMatchIntelligence({ asOf, featureSet: fullFeatureSet() });
  const adjusted = applyCalibratedTeamIntelligence({ homeLambda: 1.7, awayLambda: 1.2, intelligence, calibration: null });
  assert.equal(adjusted.adjustmentApplied, false);
  assert.equal(adjusted.adjusted.homeLambda, 1.7);
  assert.equal(adjusted.adjusted.awayLambda, 1.2);
});

test('bookmaker-derived calibration is forbidden', () => {
  const intelligence = buildTeamMatchIntelligence({ asOf, featureSet: fullFeatureSet() });
  const badCalibration = { ...calibration(), usesBookmakerOdds: true };
  const adjusted = applyCalibratedTeamIntelligence({ homeLambda: 1.7, awayLambda: 1.2, intelligence, calibration: badCalibration });
  assert.equal(adjusted.adjustmentApplied, false);
  assert.equal(adjusted.reason, 'VERIFIED_INDEPENDENT_CALIBRATION_REQUIRED');
});

test('verified calibration uses de-correlated groups and remains inside caps', () => {
  const intelligence = buildTeamMatchIntelligence({ asOf, featureSet: fullFeatureSet() });
  const adjusted = applyCalibratedTeamIntelligence({ homeLambda: 1.7, awayLambda: 1.2, intelligence, calibration: calibration() });
  assert.equal(adjusted.adjustmentApplied, true);
  assert.ok(adjusted.multipliers.home >= 0.8 && adjusted.multipliers.home <= 1.2);
  assert.ok(adjusted.multipliers.away >= 0.8 && adjusted.multipliers.away <= 1.2);
  assert.ok(adjusted.adjusted.homeLambda > 1.7);
  assert.ok(adjusted.adjusted.awayLambda < 1.2);
  assert.equal(adjusted.contributions.filter((x) => x.correlationGroup === 'CHANCE_CREATION_AND_PREVENTION').length, 1);
});

test('decision universe keeps baseline lambdas when calibration is absent', () => {
  const universe = buildMatchDecisionUniverse({
    eventId: 'E1', homeTeam: 'HOME FC', awayTeam: 'AWAY FC', homeLambda: 1.7, awayLambda: 1.2,
    evidenceMaturity: 80, lineupGate: 'PASS', contextRisk: 'LOW',
    teamIntelligenceFeatureSet: fullFeatureSet(), teamIntelligenceAsOf: asOf
  });
  assert.equal(universe.teamIntelligence.state, 'ANALYSIS_MATURE');
  assert.equal(universe.intelligenceAdjustment.adjustmentApplied, false);
  assert.equal(universe.effectiveModel.homeLambda, 1.7);
  assert.equal(universe.effectiveModel.awayLambda, 1.2);
});

test('decision universe uses calibrated intelligence before match probability reasoning', () => {
  const universe = buildMatchDecisionUniverse({
    eventId: 'E1', homeTeam: 'HOME FC', awayTeam: 'AWAY FC', homeLambda: 1.7, awayLambda: 1.2,
    evidenceMaturity: 80, lineupGate: 'PASS', contextRisk: 'LOW',
    teamIntelligenceFeatureSet: fullFeatureSet(), teamIntelligenceAsOf: asOf, intelligenceCalibration: calibration()
  });
  assert.equal(universe.intelligenceAdjustment.adjustmentApplied, true);
  assert.equal(universe.reasoning.model.homeLambda, universe.effectiveModel.homeLambda);
  assert.equal(universe.reasoning.model.awayLambda, universe.effectiveModel.awayLambda);
  assert.notEqual(universe.effectiveModel.homeLambda, universe.baselineModel.homeLambda);
});

test('partial intelligence blocks ROBUST_MODEL_TRUTH but still allows MODEL_LEAN', () => {
  const partial = { teamCohesion: { ...meta, home: 0.9, away: 0.4 } };
  const universe = buildMatchDecisionUniverse({
    eventId: 'E2', homeTeam: 'HOME FC', awayTeam: 'AWAY FC', homeLambda: 3.2, awayLambda: 0.5,
    evidenceMaturity: 90, lineupGate: 'PASS', contextRisk: 'LOW',
    teamIntelligenceFeatureSet: partial, teamIntelligenceAsOf: asOf
  });
  assert.equal(universe.teamIntelligence.state, 'ANALYSIS_PARTIAL');
  assert.equal(universe.strongestRobustTruths.length, 0);
  assert.ok(universe.truthBoard.some((x) => x.state === 'MODEL_LEAN'));
});
