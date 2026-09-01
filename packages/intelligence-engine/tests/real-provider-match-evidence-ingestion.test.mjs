import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adaptRealProviderMatchEvidenceEvent,
  CANONICAL_PROVIDER_MATCH_EVIDENCE_SCHEMA_VERSION,
  ingestRealProviderMatchEvidenceBatch
} from '../src/real-provider-match-evidence-ingestion.mjs';

const CAPTURED = '2026-09-01T12:00:00.000Z';
const KICKOFF = '2026-09-01T15:00:00.000Z';

function match(id, daysAgo, goalsFor, goalsAgainst, extra = {}) {
  return {
    matchId: id,
    playedAt: new Date(Date.parse(KICKOFF) - daysAgo * 86400000).toISOString(),
    goalsFor,
    goalsAgainst,
    opponentStrength: 0.5,
    ...extra
  };
}

function evidence() {
  return {
    homeRecentMatches: [
      match('h1', 5, 2, 0), match('h2', 12, 1, 1), match('h3', 19, 3, 1)
    ],
    awayRecentMatches: [
      match('a1', 6, 1, 1), match('a2', 13, 0, 1), match('a3', 20, 2, 1)
    ],
    homeHomeMatches: [
      match('hh1', 7, 2, 0), match('hh2', 21, 1, 0), match('hh3', 35, 2, 1)
    ],
    awayAwayMatches: [
      match('aa1', 8, 0, 1), match('aa2', 22, 1, 2), match('aa3', 36, 1, 1)
    ],
    h2hMatches: [
      match('x1', 90, 2, 1), match('x2', 300, 1, 1), match('x3', 800, 1, 0)
    ],
    leaguePositions: { home: 3, away: 11 },
    restDays: { home: 6, away: 5 },
    injuries: { home: [], away: [{ playerId: 'p-1', status: 'OUT' }] },
    suspensions: { home: [], away: [] },
    lineups: { home: { state: 'EXPECTED' }, away: { state: 'EXPECTED' } },
    xG: { home: 1.65, away: 0.95 },
    marketObservations: [{
      observationId: 'market-1',
      marketSnapshotId: 'market-snapshot-1',
      marketFamily: '1X2_FULL_TIME',
      selection: 'HOME',
      odds: 1.85,
      marketFairProbability: 0.55,
      provider: 'BOOKMAKER_A',
      observedAt: '2026-09-01T11:55:00.000Z'
    }]
  };
}

function providerEvent(overrides = {}) {
  return {
    schemaVersion: CANONICAL_PROVIDER_MATCH_EVIDENCE_SCHEMA_VERSION,
    eventId: 'event-001',
    providerEventId: 'provider-event-001',
    evidenceSnapshotId: 'evidence-001',
    kickoffAt: KICKOFF,
    homeTeam: 'HOME FC',
    awayTeam: 'AWAY FC',
    sourceReference: 'provider://feed/event-001',
    evidence: evidence(),
    model: {
      eventId: 'event-001',
      verified: true,
      independentOfMarket: true,
      modelVersion: 'INDEPENDENT_MODEL_V1',
      sourceReference: 'model://snapshot/model-001',
      observedAt: '2026-09-01T11:45:00.000Z',
      homeLambda: 1.65,
      awayLambda: 0.95
    },
    ...overrides
  };
}

function batch(events = [providerEvent()], overrides = {}) {
  return {
    batchId: 'provider-batch-001',
    provider: 'STATS_PROVIDER_A',
    sourceType: 'PROVIDER_API',
    sourceReference: 'provider://feed/batch-001',
    capturedAt: CAPTURED,
    verified: true,
    events,
    ...overrides
  };
}

test('verified provider evidence feeds canonical snapshot and analysis', () => {
  const report = ingestRealProviderMatchEvidenceBatch(batch());
  const row = report.events[0];
  assert.equal(row.state, 'ANALYZED');
  assert.equal(row.snapshot.immutable, true);
  assert.equal(row.snapshot.event_id, 'event-001');
  assert.equal(row.snapshot.source_provider, 'STATS_PROVIDER_A');
  assert.equal(row.model.state, 'INDEPENDENT_MODEL_VERIFIED');
  assert.equal(row.analysis.evidence_snapshot_fingerprint, row.snapshot.fingerprint);
  assert.equal(row.analysis.governance.oddsAloneNeverDeterminePrediction, true);
});

test('direct event adapter uses the same canonical snapshot path', () => {
  const row = adaptRealProviderMatchEvidenceEvent(batch(), providerEvent());
  assert.equal(row.governance.canonicalSnapshotBuilderUsed, true);
  assert.equal(row.snapshot.feature_version, 'MATCH_EVIDENCE_FEATURES_V0_1');
  assert.equal(row.analysis.model_version, 'INDEPENDENT_MODEL_V1');
});

test('missing provider evidence stays unknown and analysis waits for a model', () => {
  const event = providerEvent({ evidenceSnapshotId: 'evidence-missing', evidence: {}, model: null });
  const row = ingestRealProviderMatchEvidenceBatch(batch([event])).events[0];
  assert.equal(row.state, 'EVIDENCE_READY_MODEL_PENDING');
  assert.equal(row.decision, 'ABSTAIN');
  assert.deepEqual(row.reasons, ['INDEPENDENT_MODEL_NOT_VERIFIED']);
  assert.equal(row.snapshot.features.home_recent_ppg.value, null);
  assert.equal(row.snapshot.xg, null);
  assert.equal(row.analysis, null);
});

test('event provider cannot contradict batch provider identity', () => {
  const event = providerEvent({ provider: 'DIFFERENT_PROVIDER' });
  const row = ingestRealProviderMatchEvidenceBatch(batch([event])).events[0];
  assert.equal(row.state, 'REJECTED');
  assert.equal(row.error_code, 'EVENT_PROVIDER_MISMATCH');
});

test('exact replay is idempotent', () => {
  const event = providerEvent();
  const report = ingestRealProviderMatchEvidenceBatch(batch([event, event]));
  assert.equal(report.events[0].state, 'ANALYZED');
  assert.equal(report.events[1].state, 'IDEMPOTENT_REPLAY');
  assert.equal(report.events[0].provider_payload_fingerprint, report.events[1].provider_payload_fingerprint);
  assert.equal(report.events[0].evidence_snapshot_fingerprint, report.events[1].evidence_snapshot_fingerprint);
});

test('changed payload with the same provider identity is rejected', () => {
  const first = providerEvent();
  const changedEvidence = evidence();
  changedEvidence.homeRecentMatches = changedEvidence.homeRecentMatches.map((row, index) =>
    index === 0 ? { ...row, goalsFor: row.goalsFor + 1 } : row);
  const changed = providerEvent({ evidence: changedEvidence });
  const report = ingestRealProviderMatchEvidenceBatch(batch([first, changed]));
  assert.equal(report.events[1].state, 'REJECTED');
  assert.equal(report.events[1].error_code, 'PROVIDER_EVIDENCE_IDENTITY_PAYLOAD_CONFLICT');
});

test('cross-event evidence snapshot reuse is rejected', () => {
  const first = providerEvent();
  const second = providerEvent({
    eventId: 'event-002',
    providerEventId: 'provider-event-002',
    evidenceSnapshotId: 'evidence-001',
    sourceReference: 'provider://feed/event-002',
    model: {
      ...providerEvent().model,
      eventId: 'event-002',
      sourceReference: 'model://snapshot/model-002'
    }
  });
  const report = ingestRealProviderMatchEvidenceBatch(batch([first, second]));
  assert.equal(report.events[1].state, 'REJECTED');
  assert.equal(report.events[1].error_code, 'CROSS_EVENT_SNAPSHOT_IDENTITY_REUSE');
});

test('market-derived lambdas are blocked without discarding valid evidence', () => {
  const event = providerEvent({
    model: {
      ...providerEvent().model,
      independentOfMarket: false
    }
  });
  const row = ingestRealProviderMatchEvidenceBatch(batch([event])).events[0];
  assert.equal(row.state, 'EVIDENCE_READY_MODEL_REJECTED');
  assert.equal(row.reasons[0], 'MARKET_DERIVED_MODEL_INPUT_FORBIDDEN');
  assert.ok(row.snapshot);
  assert.equal(row.analysis, null);
});

test('model observed after the evidence snapshot cannot backdate analysis', () => {
  const event = providerEvent({
    model: {
      ...providerEvent().model,
      observedAt: '2026-09-01T12:30:00.000Z'
    }
  });
  const row = ingestRealProviderMatchEvidenceBatch(batch([event])).events[0];
  assert.equal(row.state, 'EVIDENCE_READY_MODEL_REJECTED');
  assert.equal(row.reasons[0], 'MODEL_OBSERVED_AFTER_EVIDENCE_SNAPSHOT');
  assert.ok(row.snapshot);
});

test('post-kickoff match evidence is rejected before snapshot construction', () => {
  const badEvidence = evidence();
  badEvidence.homeRecentMatches = [{
    matchId: 'future-match',
    playedAt: '2026-09-01T16:00:00.000Z',
    goalsFor: 2,
    goalsAgainst: 0,
    opponentStrength: 0.5
  }];
  const row = ingestRealProviderMatchEvidenceBatch(batch([providerEvent({ evidence: badEvidence })])).events[0];
  assert.equal(row.state, 'REJECTED');
  assert.equal(row.error_code, 'POST_KICKOFF_FEATURE_REJECTED');
  assert.equal(row.snapshot, null);
});

test('market observations after batch capture are rejected', () => {
  const badEvidence = evidence();
  badEvidence.marketObservations = [{
    observationId: 'future-market',
    marketSnapshotId: 'market-snapshot-future',
    marketFamily: '1X2_FULL_TIME',
    selection: 'HOME',
    odds: 2,
    provider: 'BOOKMAKER_A',
    observedAt: '2026-09-01T12:30:00.000Z'
  }];
  const row = ingestRealProviderMatchEvidenceBatch(batch([providerEvent({ evidence: badEvidence })])).events[0];
  assert.equal(row.state, 'REJECTED');
  assert.equal(row.error_code, 'MARKET_OBSERVATION_AFTER_SNAPSHOT');
});

test('bookmaker providers cannot be mixed inside one market snapshot', () => {
  const badEvidence = evidence();
  badEvidence.marketObservations.push({
    observationId: 'market-2',
    marketSnapshotId: 'market-snapshot-1',
    marketFamily: '1X2_FULL_TIME',
    selection: 'AWAY',
    odds: 4,
    provider: 'BOOKMAKER_B',
    observedAt: '2026-09-01T11:55:00.000Z'
  });
  const row = ingestRealProviderMatchEvidenceBatch(batch([providerEvent({ evidence: badEvidence })])).events[0];
  assert.equal(row.state, 'REJECTED');
  assert.equal(row.error_code, 'MARKET_PROVIDER_MIXING_REJECTED');
});

test('manual screenshot capture cannot self-assert provider truth', () => {
  const report = ingestRealProviderMatchEvidenceBatch(batch(
    [providerEvent({ model: null })],
    {
      provider: 'HUMAN_RESEARCHER',
      sourceType: 'MANUAL_SCREENSHOT_CAPTURE',
      sourceReference: 'screenshot://batch/capture-001',
      verified: true,
      independentlyVerified: false
    }
  ));
  const row = report.events[0];
  assert.equal(row.snapshot.source_type, 'MANUAL_SCREENSHOT_CAPTURE');
  assert.equal(row.snapshot.source.verified, false);
  assert.equal(row.snapshot.source.confidence, 0.35);
  assert.equal(row.state, 'EVIDENCE_READY_MODEL_PENDING');
});

test('same provider batch produces deterministic immutable output', () => {
  const first = ingestRealProviderMatchEvidenceBatch(batch());
  const second = ingestRealProviderMatchEvidenceBatch(batch());
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.governance.p002Unchanged, true);
  assert.equal(first.governance.capital, 'LOCKED');
  assert.equal(first.governance.realMoney, 'NO');
  assert.equal(first.governance.automaticPromotionOrRetuning, false);
});

test('unsupported provider schema is rejected explicitly', () => {
  const row = ingestRealProviderMatchEvidenceBatch(batch([
    providerEvent({ schemaVersion: 'PROVIDER_PRIVATE_V9' })
  ])).events[0];
  assert.equal(row.state, 'REJECTED');
  assert.equal(row.error_code, 'PROVIDER_EVIDENCE_SCHEMA_UNSUPPORTED');
});
