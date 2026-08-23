import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfirmedLineupPlayerIntelligence, toRealFootballPlayerEvidence } from '../src/player-matchup-intelligence.mjs';
import { normalizeRealFootballEventObservation } from '../src/real-football-feature-ingestion.mjs';
import { buildTeamMatchIntelligence } from '../src/team-match-intelligence.mjs';

const kickoffAt = '2026-08-23T13:00:00Z';
const lineupObservedAt = '2026-08-23T12:00:00Z';
const profileObservedAt = '2026-08-22T18:00:00Z';

function lineup(prefix) {
  return [
    { playerId: `${prefix}GK`, phaseRole: 'GOALKEEPER', zone: 'GOALKEEPER' },
    { playerId: `${prefix}LB`, phaseRole: 'DEFENCE', zone: 'LEFT' },
    { playerId: `${prefix}CB1`, phaseRole: 'DEFENCE', zone: 'CENTRAL' },
    { playerId: `${prefix}CB2`, phaseRole: 'DEFENCE', zone: 'CENTRAL' },
    { playerId: `${prefix}RB`, phaseRole: 'DEFENCE', zone: 'RIGHT' },
    { playerId: `${prefix}LM`, phaseRole: 'MIDFIELD', zone: 'LEFT' },
    { playerId: `${prefix}CM`, phaseRole: 'MIDFIELD', zone: 'CENTRAL' },
    { playerId: `${prefix}RM`, phaseRole: 'MIDFIELD', zone: 'RIGHT' },
    { playerId: `${prefix}LW`, phaseRole: 'ATTACK', zone: 'LEFT' },
    { playerId: `${prefix}ST`, phaseRole: 'ATTACK', zone: 'CENTRAL' },
    { playerId: `${prefix}RW`, phaseRole: 'ATTACK', zone: 'RIGHT' }
  ];
}

function profileFor(row, value, source) {
  const base = {
    verified: true,
    competitionAdjusted: true,
    sampleSize: 20,
    observedAt: profileObservedAt,
    source,
    teamContinuity: value,
    availabilityFitness: 1
  };
  if (row.phaseRole === 'ATTACK') return {
    ...base,
    finishing: value, shotQuality: value, chanceCreation: value, ballProgression: value, dribbling: value
  };
  if (row.phaseRole === 'MIDFIELD') return {
    ...base,
    chanceCreation: value, ballProgression: value, pressResistance: value, ballSecurity: value,
    defensiveDuels: value, interceptions: value, recovery: value, dribbling: value, shotQuality: value
  };
  if (row.phaseRole === 'DEFENCE') return {
    ...base,
    defensiveDuels: value, aerialDefending: value, interceptions: value, recovery: value, ballSecurity: value
  };
  return { ...base, shotStopping: value, goalkeeperDistribution: value, highClaims: value };
}

function validInput() {
  const home = lineup('H');
  const away = lineup('A');
  const playerProfiles = {};
  for (const row of home) playerProfiles[row.playerId] = profileFor(row, 0.82, 'HOME_PLAYER_STATS_TEST');
  for (const row of away) playerProfiles[row.playerId] = profileFor(row, 0.62, 'AWAY_PLAYER_STATS_TEST');
  return {
    eventId: 'TEST-EVENT',
    homeTeam: 'HOME FC',
    awayTeam: 'AWAY FC',
    kickoffAt,
    lineupObservation: {
      status: 'CONFIRMED',
      verified: true,
      observedAt: lineupObservedAt,
      source: 'OFFICIAL_LINEUP_TEST',
      home,
      away
    },
    playerProfiles
  };
}

test('predicted lineup cannot activate player intelligence', () => {
  const input = validInput();
  input.lineupObservation.status = 'PREDICTED';
  assert.throws(() => buildConfirmedLineupPlayerIntelligence(input), /CONFIRMED_VERIFIED_LINEUP_REQUIRED/);
});

test('lineup observed at or after kickoff is rejected', () => {
  const input = validInput();
  input.lineupObservation.observedAt = kickoffAt;
  assert.throws(() => buildConfirmedLineupPlayerIntelligence(input), /LINEUP_MUST_BE_OBSERVED_BEFORE_KICKOFF/);
});

test('player profile observed after kickoff is rejected', () => {
  const input = validInput();
  input.playerProfiles.HST = { ...input.playerProfiles.HST, observedAt: '2026-08-23T13:01:00Z' };
  assert.throws(() => buildConfirmedLineupPlayerIntelligence(input), /PLAYER_PROFILE_AFTER_KICKOFF_HST/);
});

test('competition adjustment is mandatory for player profiles', () => {
  const input = validInput();
  input.playerProfiles.ARW = { ...input.playerProfiles.ARW, competitionAdjusted: false };
  assert.throws(() => buildConfirmedLineupPlayerIntelligence(input), /PLAYER_PROFILE_NOT_COMPETITION_ADJUSTED_ARW/);
});

test('confirmed XI requires exactly eleven unique players and one goalkeeper', () => {
  const short = validInput();
  short.lineupObservation.home = short.lineupObservation.home.slice(0, 10);
  assert.throws(() => buildConfirmedLineupPlayerIntelligence(short), /HOME_CONFIRMED_XI_MUST_HAVE_11_PLAYERS/);
  const duplicate = validInput();
  duplicate.lineupObservation.home[10] = { ...duplicate.lineupObservation.home[10], playerId: duplicate.lineupObservation.home[9].playerId };
  assert.throws(() => buildConfirmedLineupPlayerIntelligence(duplicate), /HOME_CONFIRMED_XI_DUPLICATE_PLAYER/);
});

test('role-specific profiles produce seven tactical matchup lanes', () => {
  const result = buildConfirmedLineupPlayerIntelligence(validInput());
  assert.equal(result.readiness, 'PLAYER_DOMAINS_READY');
  assert.equal(result.playerMatchups.length, 7);
  assert.ok(result.playerMatchups.every((row) => row.homeCapability >= 0 && row.homeCapability <= 1));
  assert.ok(result.playerMatchups.every((row) => row.awayCapability >= 0 && row.awayCapability <= 1));
});

test('player quality and continuity are derived separately for each confirmed XI', () => {
  const result = buildConfirmedLineupPlayerIntelligence(validInput());
  assert.ok(result.playerQualityAndCohesion.homeIndividualQuality > result.playerQualityAndCohesion.awayIndividualQuality);
  assert.ok(result.playerQualityAndCohesion.homeCohesion > result.playerQualityAndCohesion.awayCohesion);
});

test('player intelligence converts directly into real-football player evidence', () => {
  const result = buildConfirmedLineupPlayerIntelligence(validInput());
  const evidence = toRealFootballPlayerEvidence(result);
  assert.equal(evidence.lineupStatus, 'CONFIRMED');
  assert.equal(evidence.verified, true);
  assert.equal(evidence.playerMatchups.length, 7);
  assert.ok(evidence.playerQualityAndCohesion);
});

test('confirmed player evidence removes player domains from real football ingestion pending list', () => {
  const result = buildConfirmedLineupPlayerIntelligence(validInput());
  const evidence = toRealFootballPlayerEvidence(result);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dataset = JSON.parse(fs.readFileSync(path.resolve(here, '../data/real-football-features-epl-2025-26-to-2026-08-23.json'), 'utf8'));
  const cloned = structuredClone(dataset);
  cloned.events[0].playerEvidence = evidence;
  const normalized = normalizeRealFootballEventObservation(cloned, cloned.events[0].eventId);
  assert.equal(normalized.pendingDomains.includes('PLAYER_MATCHUP'), false);
  assert.equal(normalized.pendingDomains.includes('PLAYER_QUALITY_AND_COHESION'), false);
  assert.equal(normalized.pendingDomains.includes('TRANSFER_IMPACT'), true);
  const intelligence = buildTeamMatchIntelligence({
    eventId: normalized.eventId,
    homeTeam: normalized.homeTeam,
    awayTeam: normalized.awayTeam,
    asOf: cloned.capturedAt,
    featureSet: normalized.featureSet
  });
  assert.equal(intelligence.domainBoard.find((row) => row.domain === 'PLAYER_MATCHUP').state, 'ACTIVE');
  assert.equal(intelligence.domainBoard.find((row) => row.domain === 'PLAYER_QUALITY_AND_COHESION').state, 'ACTIVE');
});
