import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveKickoffObservation,
  normalizeConfirmedLineup,
  applyVerifiedLineupImpact,
  resolveFinalContextAssessment,
  prepareFinalPrematchEvent,
  freezeFinalPrematchSnapshot
} from '../src/lineup-final-gate.mjs';

const xi = (prefix) => Array.from({ length: 11 }, (_, i) => ({ id: `${prefix}-${i + 1}`, name: `${prefix} Player ${i + 1}` }));

const kickoff = {
  eventId: 'E1',
  scheduledKickoffAt: '2026-08-23T13:00:00Z',
  observedAt: '2026-08-23T11:45:00Z',
  status: 'SCHEDULED',
  sourceVerified: true,
  source: 'OFFICIAL_LEAGUE'
};

const lineup = {
  eventId: 'E1',
  status: 'CONFIRMED',
  confirmedAt: '2026-08-23T11:55:00Z',
  sourceVerified: true,
  source: 'OFFICIAL_CLUB_OR_LEAGUE',
  home: { formation: '4-3-3', startingXI: xi('H') },
  away: { formation: '4-2-3-1', startingXI: xi('A') }
};

const baseEvent = {
  eventId: 'E1',
  league: 'EPL',
  homeTeam: 'Home FC',
  awayTeam: 'Away FC',
  kickoffAt: '2026-08-23T13:00:00Z',
  marketKey: '1X2_90M',
  model: { verified: true, homeLambda: 1.8, awayLambda: 1.1, maxGoals: 12 },
  evidenceMaturity: 65,
  lineupGate: 'PENDING',
  independenceVerified: true
};

const books = [
  { provider: 'BOOK_A', rawOdds: [1.9, 3.6, 4.2], rawOrder: ['HOME', 'DRAW', 'AWAY'], observedAt: '2026-08-23T11:58:00Z', sourceType: 'PUBLIC_WEB' },
  { provider: 'BOOK_B', rawOdds: [1.95, 3.5, 4.1], rawOrder: ['HOME', 'DRAW', 'AWAY'], observedAt: '2026-08-23T11:58:20Z', sourceType: 'PUBLIC_WEB' }
];

test('scheduled kickoff resolves to scheduled time', () => {
  const out = resolveKickoffObservation(kickoff);
  assert.equal(out.status, 'SCHEDULED');
  assert.equal(out.effectiveKickoffAt, '2026-08-23T13:00:00.000Z');
});

test('verified delayed kickoff requires a later revised time', () => {
  const out = resolveKickoffObservation({ ...kickoff, status: 'DELAYED', revisedKickoffAt: '2026-08-23T13:30:00Z' });
  assert.equal(out.effectiveKickoffAt, '2026-08-23T13:30:00.000Z');
  assert.throws(() => resolveKickoffObservation({ ...kickoff, status: 'DELAYED', revisedKickoffAt: '2026-08-23T12:30:00Z' }), /REVISED_KICKOFF_NOT_LATER/);
});

test('unverified kickoff source is rejected', () => {
  assert.throws(() => resolveKickoffObservation({ ...kickoff, sourceVerified: false }), /KICKOFF_SOURCE_NOT_VERIFIED/);
});

test('confirmed lineup requires exactly 11 unique starters each side', () => {
  const out = normalizeConfirmedLineup(lineup, '2026-08-23T13:00:00Z');
  assert.equal(out.home.startingXI.length, 11);
  assert.equal(out.away.startingXI.length, 11);
  assert.throws(() => normalizeConfirmedLineup({ ...lineup, home: { startingXI: xi('H').slice(0, 10) } }, '2026-08-23T13:00:00Z'), /STARTING_XI_MUST_HAVE_11_PLAYERS/);
  const duplicate = xi('H'); duplicate[10] = duplicate[0];
  assert.throws(() => normalizeConfirmedLineup({ ...lineup, home: { startingXI: duplicate } }, '2026-08-23T13:00:00Z'), /STARTING_XI_DUPLICATE_PLAYER/);
});

test('lineup confirmed at or after kickoff is rejected', () => {
  assert.throws(() => normalizeConfirmedLineup({ ...lineup, confirmedAt: '2026-08-23T13:00:00Z' }, '2026-08-23T13:00:00Z'), /LINEUP_CONFIRMED_AT_OR_AFTER_KICKOFF/);
});

test('confirmed XI alone does not silently rewrite lambdas', () => {
  const out = applyVerifiedLineupImpact(baseEvent.model, null);
  assert.equal(out.homeLambda, 1.8);
  assert.equal(out.awayLambda, 1.1);
  assert.equal(out.adjustmentApplied, false);
});

test('verified lineup impact applies only with bounded multipliers and provenance', () => {
  const out = applyVerifiedLineupImpact(baseEvent.model, {
    verified: true,
    homeLambdaMultiplier: 0.95,
    awayLambdaMultiplier: 1.05,
    provenance: 'CALIBRATED_LINEUP_IMPACT_V0_1'
  });
  assert.equal(out.adjustmentApplied, true);
  assert.equal(out.homeLambda, 1.71);
  assert.equal(out.awayLambda, 1.1550000000000002);
  assert.throws(() => applyVerifiedLineupImpact(baseEvent.model, { verified: true, homeLambdaMultiplier: 2, awayLambdaMultiplier: 1, provenance: 'X' }), /OUT_OF_RANGE/);
  assert.throws(() => applyVerifiedLineupImpact(baseEvent.model, { verified: true, homeLambdaMultiplier: 1, awayLambdaMultiplier: 1 }), /PROVENANCE_REQUIRED/);
});

test('unverified final context cannot raise evidence maturity', () => {
  const out = resolveFinalContextAssessment(65, { verified: false, evidenceMaturity: 90 });
  assert.equal(out.evidenceMaturity, 65);
  assert.equal(out.verified, false);
});

test('prepare final event opens lineup gate without mutating baseline model', () => {
  const prepared = prepareFinalPrematchEvent({
    baseEvent,
    kickoffObservation: kickoff,
    lineupSnapshot: lineup,
    latestBookmakerSnapshots: books,
    finalCapturedAt: '2026-08-23T12:00:00Z',
    finalContextAssessment: { verified: true, evidenceMaturity: 78, transitionRisk: 'MEDIUM', provenance: 'FINAL_CONTEXT_V0_1' }
  });
  assert.equal(prepared.terminal, false);
  assert.equal(prepared.event.lineupGate, 'PASS');
  assert.equal(prepared.event.evidenceMaturity, 78);
  assert.equal(prepared.event.model.homeLambda, 1.8);
  assert.equal(baseEvent.lineupGate, 'PENDING');
  assert.equal(baseEvent.evidenceMaturity, 65);
});

test('postponed fixture terminates before lineup processing', () => {
  const prepared = prepareFinalPrematchEvent({
    baseEvent,
    kickoffObservation: { ...kickoff, status: 'POSTPONED' },
    lineupSnapshot: lineup,
    latestBookmakerSnapshots: books,
    finalCapturedAt: '2026-08-23T12:00:00Z'
  });
  assert.equal(prepared.terminal, true);
  assert.equal(prepared.state, 'REJECTED');
  assert.deepEqual(prepared.reasons, ['KICKOFF_POSTPONED']);
});

test('final snapshot is immutable and records no-hindsight separation', () => {
  const snapshot = freezeFinalPrematchSnapshot({
    result: { eventId: 'E1', state: 'WATCH', reasons: ['TEST'], evidenceMaturity: 78, lineupGate: 'PASS' },
    baselineBatchId: 'B1',
    modelDatasetId: 'M1',
    finalCaptureId: 'F1',
    finalCapturedAt: '2026-08-23T12:00:00Z',
    kickoff: resolveKickoffObservation(kickoff),
    lineup: normalizeConfirmedLineup(lineup, '2026-08-23T13:00:00Z'),
    modelAdjustment: { adjustmentApplied: false }
  });
  assert.equal(snapshot.immutable, true);
  assert.equal(snapshot.noHindsight, true);
  assert.equal(snapshot.priorSnapshotsMutated, false);
  assert.equal(Object.isFrozen(snapshot), true);
});
