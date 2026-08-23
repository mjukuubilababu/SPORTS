import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRealFootballEventObservation, processRealFootballFeatureBatch } from '../src/real-football-feature-ingestion.mjs';
import { buildTeamMatchIntelligence } from '../src/team-match-intelligence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(fs.readFileSync(path.resolve(here, '../data/real-football-features-epl-2025-26-to-2026-08-23.json'), 'utf8'));

function between01(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

test('normalizes real season observations with league-wide benchmarks', () => {
  const result = normalizeRealFootballEventObservation(dataset, 'EPL-2026-08-23-MCI-BOU');
  const f = result.featureSet;
  assert.ok(between01(f.attackVsDefence.homeAttack));
  assert.ok(between01(f.attackVsDefence.awayDefensiveVulnerability));
  assert.ok(between01(f.shotAndChanceQuality.homeShotQuality));
  assert.ok(between01(f.temporalScoringDefending.homeScoringTimingStrength));
  assert.equal(result.rawAudit.historicalAsOf, '2026-05-24T18:00:00Z');
});

test('same-league matchup creates no artificial league-quality differential', () => {
  const result = normalizeRealFootballEventObservation(dataset, 'EPL-2026-08-23-BHA-AVL');
  assert.equal(result.featureSet.leagueAndClubStrength.homeLeagueStrength, 1);
  assert.equal(result.featureSet.leagueAndClubStrength.awayLeagueStrength, 1);
});

test('player matchup and player-quality domains remain blocked before confirmed verified lineups', () => {
  const result = normalizeRealFootballEventObservation(dataset, 'EPL-2026-08-23-NEW-LIV');
  assert.ok(result.pendingDomains.includes('PLAYER_MATCHUP'));
  assert.ok(result.pendingDomains.includes('PLAYER_QUALITY_AND_COHESION'));
  assert.equal(result.featureSet.playerMatchups, undefined);
  assert.equal(result.featureSet.playerQualityAndCohesion, undefined);
});

test('transfer impact remains blocked when complete role and minutes audit is unavailable', () => {
  const result = normalizeRealFootballEventObservation(dataset, 'EPL-2026-08-23-MCI-BOU');
  assert.ok(result.pendingDomains.includes('TRANSFER_IMPACT'));
  assert.equal(result.featureSet.transferImpact, undefined);
});

test('verified context facts with sample size one can contribute through explicit per-signal requirement', () => {
  const result = normalizeRealFootballEventObservation(dataset, 'EPL-2026-08-23-MCI-BOU');
  assert.equal(result.featureSet.teamCohesion.sampleSize, 1);
  assert.equal(result.featureSet.teamCohesion.minimumSampleRequired, 1);
  const intelligence = buildTeamMatchIntelligence({
    eventId: result.eventId,
    homeTeam: result.homeTeam,
    awayTeam: result.awayTeam,
    asOf: dataset.capturedAt,
    featureSet: result.featureSet,
    minimumSample: 5
  });
  assert.equal(intelligence.domainBoard.find((row) => row.domain === 'TEAM_COHESION').state, 'ACTIVE');
});

test('attack and shot domains remain explanatory but share one composite correlation family', () => {
  const result = normalizeRealFootballEventObservation(dataset, 'EPL-2026-08-23-MCI-BOU');
  const intelligence = buildTeamMatchIntelligence({
    asOf: dataset.capturedAt,
    featureSet: result.featureSet
  });
  assert.equal(intelligence.domainBoard.find((row) => row.domain === 'ATTACK_VS_DEFENCE').state, 'ACTIVE');
  assert.equal(intelligence.domainBoard.find((row) => row.domain === 'SHOT_AND_CHANCE_QUALITY').state, 'ACTIVE');
  assert.equal(intelligence.compositeCorrelationGroups.filter((row) => row.correlationGroup === 'CHANCE_CREATION_AND_PREVENTION').length, 1);
  assert.ok(intelligence.suppressedCrossDomainCorrelations >= 1);
});

test('H2H is recent-record based and relevance weighted downstream', () => {
  const city = normalizeRealFootballEventObservation(dataset, 'EPL-2026-08-23-MCI-BOU').featureSet.headToHead;
  assert.equal(city.homeStrength, 0.7);
  assert.equal(city.awayStrength, 0.3);
  assert.equal(city.relevance, 0.35);
  const newLiv = normalizeRealFootballEventObservation(dataset, 'EPL-2026-08-23-NEW-LIV').featureSet.headToHead;
  assert.equal(newLiv.homeStrength, 0.1);
  assert.equal(newLiv.awayStrength, 0.9);
  assert.equal(newLiv.relevance, 0.25);
});

test('Newcastle direct dropped-points evidence overrides generic late-concession lead proxy', () => {
  const result = normalizeRealFootballEventObservation(dataset, 'EPL-2026-08-23-NEW-LIV');
  assert.ok(Math.abs(result.featureSet.temporalScoringDefending.homeLeadRetention - (1 - 22 / 30)) < 1e-12);
  assert.equal(result.rawAudit.leadRetentionEvidence.home.type, 'DIRECT_DROPPED_POINTS');
});

test('psychology remains neutral rather than fabricated', () => {
  const result = normalizeRealFootballEventObservation(dataset, 'EPL-2026-08-23-BHA-AVL');
  assert.equal(result.featureSet.positionHomeAwayEnvironment.homePsychologyEnvironment, 0.5);
  assert.equal(result.featureSet.positionHomeAwayEnvironment.awayPsychologyEnvironment, 0.5);
});

test('current three-event batch stays partial until player and transfer evidence completes', () => {
  const report = processRealFootballFeatureBatch(dataset, { asOf: dataset.capturedAt });
  assert.equal(report.summary.eventsReceived, 3);
  assert.equal(report.summary.partial, 3);
  assert.equal(report.summary.mature, 0);
  assert.equal(report.summary.blocked, 0);
  assert.equal(report.summary.playerDomainsPending, 3);
  assert.equal(report.summary.transferDomainsPending, 3);
  assert.ok(report.events.every((row) => row.state === 'ANALYSIS_PARTIAL'));
});
