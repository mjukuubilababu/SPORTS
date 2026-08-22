import test from 'node:test';
import assert from 'node:assert/strict';
import { processFinalPrematchBatch } from '../src/final-prematch-processing.mjs';

const xi = (prefix) => Array.from({ length: 11 }, (_, i) => ({ id: `${prefix}-${i + 1}`, name: `${prefix} ${i + 1}` }));

const modelDataset = {
  datasetId: 'SYNTHETIC-FINAL-GATE-MODEL',
  leagueStats: { matches: 380, homeGoals: 580, awayGoals: 465 },
  priorEquivalentMatches: 5,
  events: [{
    eventId: 'E1',
    homeStats: { matches: 19, goalsFor: 45, goalsAgainst: 12 },
    awayStats: { matches: 19, goalsFor: 15, goalsAgainst: 40 },
    contextRisk: 'HIGH',
    sourceVerification: { primaryVenueStats: true, crossCheckSeasonTotals: true, independenceFromMarket: true },
    lineupGate: 'PENDING',
    crossEventIndependenceVerified: true,
    provenance: { nature: 'SYNTHETIC_TEST_ONLY' }
  }]
};

const marketBatch = {
  batchId: 'SYNTHETIC-BASE-MARKET',
  capturedAt: '2026-08-23T09:00:00Z',
  events: [{
    eventId: 'E1',
    league: 'TEST',
    homeTeam: 'Home FC',
    awayTeam: 'Away FC',
    kickoffAt: '2026-08-23T13:00:00Z',
    marketKey: '1X2_90M',
    bookmakerSnapshots: []
  }]
};

function finalObservation(oddsA = [2.05, 3.6, 3.8], oddsB = [2.08, 3.55, 3.75]) {
  return {
    eventId: 'E1',
    kickoffObservation: {
      eventId: 'E1', scheduledKickoffAt: '2026-08-23T13:00:00Z', observedAt: '2026-08-23T11:40:00Z',
      status: 'SCHEDULED', sourceVerified: true, source: 'OFFICIAL_TEST_SOURCE'
    },
    lineupSnapshot: {
      eventId: 'E1', status: 'CONFIRMED', confirmedAt: '2026-08-23T11:50:00Z',
      sourceVerified: true, source: 'OFFICIAL_TEST_SOURCE',
      home: { startingXI: xi('H') }, away: { startingXI: xi('A') }
    },
    bookmakerSnapshots: [
      { provider: 'BOOK_A', observedAt: '2026-08-23T11:59:00Z', sourceType: 'PUBLIC_WEB', rawOdds: oddsA, rawOrder: ['HOME', 'DRAW', 'AWAY'] },
      { provider: 'BOOK_B', observedAt: '2026-08-23T11:59:20Z', sourceType: 'PUBLIC_WEB', rawOdds: oddsB, rawOrder: ['HOME', 'DRAW', 'AWAY'] }
    ],
    finalContextAssessment: { verified: true, evidenceMaturity: 80, transitionRisk: 'MEDIUM', provenance: 'SYNTHETIC_TEST_CONTEXT' }
  };
}

test('confirmed XI + verified context + aligned market can reach final QUALIFIED', () => {
  const report = processFinalPrematchBatch(marketBatch, modelDataset, {
    captureId: 'FINAL-1', capturedAt: '2026-08-23T12:00:00Z', events: [finalObservation()]
  });
  assert.equal(report.events[0].lineupGate, 'PASS');
  assert.equal(report.events[0].finalSnapshot.immutable, true);
  assert.equal(report.events[0].finalSnapshot.priorSnapshotsMutated, false);
  assert.equal(report.events[0].state, 'QUALIFIED');
  assert.equal(report.gate5SignalDrafts.length, 1);
});

test('model-market direction conflict blocks final qualification', () => {
  const report = processFinalPrematchBatch(marketBatch, modelDataset, {
    captureId: 'FINAL-2', capturedAt: '2026-08-23T12:00:00Z',
    events: [finalObservation([3.6, 4.0, 1.75], [3.55, 4.05, 1.78])]
  });
  assert.equal(report.events[0].modelMarketDiagnostics.directionConflict, true);
  assert.equal(report.events[0].state, 'WATCH');
  assert.equal(report.gate5SignalDrafts.length, 0);
});

test('postponed fixture becomes final REJECTED without fabricating a lineup decision', () => {
  const event = finalObservation();
  event.kickoffObservation.status = 'POSTPONED';
  const report = processFinalPrematchBatch(marketBatch, modelDataset, {
    captureId: 'FINAL-3', capturedAt: '2026-08-23T12:00:00Z', events: [event]
  });
  assert.equal(report.events[0].state, 'REJECTED');
  assert.deepEqual(report.events[0].reasons, ['KICKOFF_POSTPONED']);
  assert.equal(report.events[0].finalSnapshot.finalState, 'REJECTED');
});
