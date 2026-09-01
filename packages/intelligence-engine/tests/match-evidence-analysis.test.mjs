import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeMatchEvidence,
  buildMarketCompatibilityMatrix,
  buildMatchEvidenceSnapshot,
  verifyMatchEvidenceSnapshot
} from '../src/match-evidence-analysis.mjs';
import { buildScoreDistribution } from '../src/bidirectional-match-reasoning.mjs';
import {
  freezeSystemSignal,
  settleSystemSignalAndUserExecution
} from '../src/full-market-inference.mjs';

const KICKOFF = '2026-08-30T15:00:00.000Z';
const CAPTURED = '2026-08-30T12:00:00.000Z';

function match(daysAgo, goalsFor, goalsAgainst, extras = {}) {
  return {
    matchId: extras.matchId ?? 'm-' + daysAgo + '-' + goalsFor + '-' + goalsAgainst,
    playedAt: new Date(Date.parse(KICKOFF) - daysAgo * 86400000).toISOString(),
    goalsFor,
    goalsAgainst,
    opponentStrength: extras.opponentStrength ?? 0.5,
    ...(Object.hasOwn(extras, 'scoringMinutes') ? { scoringMinutes: extras.scoringMinutes } : {}),
    ...(Object.hasOwn(extras, 'concedingMinutes') ? { concedingMinutes: extras.concedingMinutes } : {})
  };
}

const strongHomeOverall = [
  match(6, 2, 0), match(13, 2, 1), match(20, 1, 1), match(27, 3, 1), match(34, 1, 0)
];
const moderateAwayOverall = [
  match(7, 1, 1), match(14, 0, 1), match(21, 2, 1), match(28, 1, 2), match(35, 1, 1)
];
const strongHomeVenue = [
  match(8, 3, 0), match(22, 2, 0), match(36, 2, 1), match(50, 1, 0), match(64, 2, 0)
];
const weakAwayVenue = [
  match(9, 0, 2), match(23, 1, 2), match(37, 0, 1), match(51, 1, 3), match(65, 0, 2)
];
const h2h = [
  match(100, 2, 1), match(400, 1, 1), match(1100, 1, 0), match(1800, 0, 0), match(2600, 1, 1)
];

function baseInput(overrides = {}) {
  return {
    evidenceSnapshotId: 'evidence-001',
    eventId: 'event-001',
    kickoffAt: KICKOFF,
    capturedAt: CAPTURED,
    sourceProvider: 'VERIFIED_PROVIDER_A',
    sourceType: 'PROVIDER_API',
    sourceReference: 'provider://event-001/snapshot-001',
    verified: true,
    homeRecentMatches: strongHomeOverall,
    awayRecentMatches: moderateAwayOverall,
    homeHomeMatches: strongHomeVenue,
    awayAwayMatches: weakAwayVenue,
    h2hMatches: h2h,
    restDays: { home: 6, away: 5 },
    injuries: { home: [], away: [] },
    suspensions: { home: [], away: [] },
    lineups: { home: { state: 'EXPECTED' }, away: { state: 'EXPECTED' } },
    xG: { home: 1.7, away: 0.9 },
    marketObservations: [{
      observationId: 'market-001',
      marketSnapshotId: 'market-snapshot-001',
      marketFamily: '1X2_FULL_TIME',
      selection: 'HOME',
      odds: 1.8,
      marketFairProbability: 0.56,
      provider: 'VERIFIED_PROVIDER_A',
      observedAt: '2026-08-30T11:55:00.000Z'
    }],
    ...overrides
  };
}

function analyze(snapshot, overrides = {}) {
  return analyzeMatchEvidence({
    snapshot,
    homeLambda: 1.7,
    awayLambda: 0.9,
    homeTeam: 'HOME FC',
    awayTeam: 'AWAY FC',
    modelVersion: 'CANONICAL_POISSON_V1',
    ...overrides
  });
}

test('A: venue-specific form remains distinct from overall form', () => {
  const snapshot = buildMatchEvidenceSnapshot(baseInput({
    homeRecentMatches: [match(5, 0, 2), match(12, 0, 1), match(19, 1, 1)],
    homeHomeMatches: [match(7, 3, 0), match(21, 2, 0), match(35, 2, 1)]
  }));
  assert.notEqual(snapshot.features.home_recent_ppg.value, snapshot.features.home_home_ppg.value);
  assert.equal(snapshot.config_versions.form_context, 'FORM_CONTEXT_WEIGHTS_V1');
  assert.ok(snapshot.features.context_weighted_home_form.value > snapshot.features.home_recent_ppg.value);
});

test('B: old H2H receives lower temporal weight', () => {
  const snapshot = buildMatchEvidenceSnapshot(baseInput({
    h2hMatches: [match(30, 2, 1, { matchId: 'recent-h2h' }), match(2200, 2, 1, { matchId: 'old-h2h' })]
  }));
  const weights = snapshot.features.h2h.h2h_match_weights;
  assert.equal(weights[0].match_id, 'recent-h2h');
  assert.equal(weights[1].match_id, 'old-h2h');
  assert.ok(weights[0].weight > weights[1].weight);
});

test('C: small H2H sample lowers feature confidence', () => {
  const small = buildMatchEvidenceSnapshot(baseInput({
    evidenceSnapshotId: 'small-h2h',
    h2hMatches: [match(100, 1, 0), match(200, 1, 1), match(300, 0, 1)]
  }));
  const large = buildMatchEvidenceSnapshot(baseInput({
    evidenceSnapshotId: 'large-h2h',
    h2hMatches: Array.from({ length: 12 }, (_, index) => match(60 + index * 40, index % 3, index % 2, { matchId: 'h2h-' + index }))
  }));
  assert.ok(small.features.h2h.h2h_weighted_goals.confidence < large.features.h2h.h2h_weighted_goals.confidence);
});

test('D: missing xG remains explicit and does not crash analysis', () => {
  const snapshot = buildMatchEvidenceSnapshot(baseInput({ xG: null }));
  const result = analyze(snapshot);
  assert.equal(snapshot.xg, null);
  assert.equal(snapshot.completeness.checks.xg, false);
  assert.ok(Number.isFinite(result.confidence.final_confidence));
});

test('E: conflicting evidence reduces deterministic confidence', () => {
  const aligned = buildMatchEvidenceSnapshot(baseInput({
    evidenceSnapshotId: 'aligned',
    h2hMatches: [match(90, 2, 1), match(180, 1, 1), match(270, 2, 0), match(360, 1, 0), match(450, 2, 1)],
    xG: { home: 1.7, away: 0.9 }
  }));
  const conflict = buildMatchEvidenceSnapshot(baseInput({
    evidenceSnapshotId: 'conflict',
    homeHomeMatches: [match(8, 0, 3), match(22, 0, 2), match(36, 1, 3), match(50, 0, 2), match(64, 1, 4)],
    awayAwayMatches: [match(9, 3, 0), match(23, 2, 0), match(37, 3, 1), match(51, 2, 0), match(65, 4, 1)],
    h2hMatches: [match(100, 0, 0), match(200, 0, 0), match(300, 1, 0)],
    xG: { home: 0.3, away: 0.2 },
    marketObservations: [{
      observationId: 'market-conflict',
      marketSnapshotId: 'market-conflict-snapshot',
      marketFamily: '1X2_FULL_TIME',
      selection: 'HOME',
      odds: 8,
      marketFairProbability: 0.12,
      provider: 'VERIFIED_PROVIDER_A',
      observedAt: '2026-08-30T11:55:00.000Z'
    }]
  }));
  const alignedResult = analyze(aligned);
  const conflictResult = analyze(conflict);
  assert.ok(conflictResult.conflict_score > alignedResult.conflict_score);
  assert.ok(conflictResult.confidence.final_confidence < alignedResult.confidence.final_confidence);
});

test('F: severe evidence conflict can force ABSTAIN', () => {
  const highScoring = [match(5, 5, 0), match(12, 0, 5), match(19, 4, 1), match(26, 1, 4), match(33, 5, 1)];
  const snapshot = buildMatchEvidenceSnapshot(baseInput({
    evidenceSnapshotId: 'severe-conflict',
    homeRecentMatches: highScoring,
    awayRecentMatches: highScoring.map((row, index) => ({ ...row, matchId: 'away-high-' + index })),
    homeHomeMatches: [match(8, 0, 4), match(22, 0, 3), match(36, 0, 5), match(50, 1, 4), match(64, 0, 4)],
    awayAwayMatches: [match(9, 4, 0), match(23, 3, 0), match(37, 5, 0), match(51, 4, 1), match(65, 4, 0)],
    h2hMatches: [match(100, 0, 0), match(200, 0, 0), match(300, 0, 0)],
    xG: { home: 0.1, away: 0.1 },
    marketObservations: [{
      observationId: 'extreme-market',
      marketSnapshotId: 'extreme-market-snapshot',
      marketFamily: '1X2_FULL_TIME',
      selection: 'HOME',
      odds: 1.04,
      marketFairProbability: 0.95,
      provider: 'VERIFIED_PROVIDER_A',
      observedAt: '2026-08-30T11:55:00.000Z'
    }]
  }));
  const result = analyze(snapshot, { homeLambda: 1.0, awayLambda: 1.0 });
  assert.ok(result.conflict_score >= 0.81);
  assert.equal(result.decision, 'ABSTAIN');
  assert.ok(result.abstain_reasons.includes('HIGH_EVIDENCE_CONFLICT'));
});

test('G: contradictory markets cannot enter the same three-outcome cluster', () => {
  const snapshot = buildMatchEvidenceSnapshot(baseInput());
  const result = analyze(snapshot, {
    marketSelections: [
      { marketFamily: 'TOTAL_GOALS_OVER_UNDER_FULL_TIME', selection: 'UNDER', line: 2.5 },
      { marketFamily: 'TOTAL_GOALS_OVER_UNDER_FULL_TIME', selection: 'OVER', line: 3.5 },
      { marketFamily: 'DOUBLE_CHANCE_FULL_TIME', selection: '1X' },
      { marketFamily: 'BTTS_FULL_TIME', selection: 'NO' }
    ]
  });
  const keys = new Set(result.compatible_outcome_cluster.map((row) => row.marketFamily + '|' + row.selection + '|' + row.line));
  assert.equal(keys.has('TOTAL_GOALS_OVER_UNDER_FULL_TIME|UNDER|2.5') && keys.has('TOTAL_GOALS_OVER_UNDER_FULL_TIME|OVER|3.5'), false);
  const explicit = result.market_compatibility_rules.find((rule) =>
    rule.market_a === 'TOTAL_GOALS_OVER_UNDER_FULL_TIME' &&
    rule.selection_a === 'UNDER' &&
    rule.line_a === 2.5 &&
    rule.market_b === 'TOTAL_GOALS_OVER_UNDER_FULL_TIME' &&
    rule.selection_b === 'OVER' &&
    rule.line_b === 3.5);
  assert.equal(explicit.compatibility, 'CONTRADICTORY');
});

test('H: safer alternative is higher-probability and no higher variance than primary', () => {
  const snapshot = buildMatchEvidenceSnapshot(baseInput());
  const result = analyze(snapshot);
  assert.ok(result.safer_alternative);
  assert.ok(result.safer_alternative.model_probability >= result.primary_outcome.model_probability);
  assert.ok(result.safer_alternative.probability_variance <= result.primary_outcome.probability_variance);
});

test('I: post-kickoff feature cannot enter pre-match snapshot', () => {
  assert.throws(() => buildMatchEvidenceSnapshot(baseInput({
    homeRecentMatches: [{
      matchId: 'future',
      playedAt: '2026-08-30T16:00:00.000Z',
      goalsFor: 2,
      goalsAgainst: 0,
      opponentStrength: 0.5
    }]
  })), /POST_KICKOFF_FEATURE_REJECTED/);
});

test('J: manual screenshot evidence is tagged and cannot masquerade as provider API truth', () => {
  const snapshot = buildMatchEvidenceSnapshot(baseInput({
    evidenceSnapshotId: 'manual-shot',
    sourceProvider: 'HUMAN_RESEARCHER',
    sourceType: 'MANUAL_SCREENSHOT_CAPTURE',
    sourceReference: 'screenshot://capture-001',
    verified: true,
    independentlyVerified: false,
    marketObservations: []
  }));
  assert.equal(snapshot.source_type, 'MANUAL_SCREENSHOT_CAPTURE');
  assert.equal(snapshot.source.verified, false);
  assert.equal(snapshot.source.confidence, 0.35);
  assert.equal(snapshot.features.home_recent_ppg.source_type, 'MANUAL_SCREENSHOT_CAPTURE');
  assert.equal(analyze(snapshot).decision, 'ABSTAIN');
});

test('K: provider market snapshots cannot be mixed', () => {
  assert.throws(() => buildMatchEvidenceSnapshot(baseInput({
    marketObservations: [
      {
        observationId: 'p1',
        marketSnapshotId: 'same-snapshot',
        marketFamily: '1X2_FULL_TIME',
        selection: 'HOME',
        odds: 2,
        provider: 'PROVIDER_A',
        observedAt: '2026-08-30T11:50:00.000Z'
      },
      {
        observationId: 'p2',
        marketSnapshotId: 'same-snapshot',
        marketFamily: '1X2_FULL_TIME',
        selection: 'AWAY',
        odds: 3,
        provider: 'PROVIDER_B',
        observedAt: '2026-08-30T11:50:00.000Z'
      }
    ]
  })), /MARKET_PROVIDER_MIXING_REJECTED/);
});

test('L: recent-match weighting is versioned and deterministic', () => {
  const sample = [
    match(5, 1, 0),
    match(10, 1, 1),
    match(15, 0, 1),
    match(20, 2, 0),
    match(25, 0, 2)
  ];
  const first = buildMatchEvidenceSnapshot(baseInput({ evidenceSnapshotId: 'weights-one', homeRecentMatches: sample }));
  const second = buildMatchEvidenceSnapshot(baseInput({ evidenceSnapshotId: 'weights-two', homeRecentMatches: sample }));
  const expected = (3 * 1 + 1 * 0.85 + 0 * 0.70 + 3 * 0.55 + 0 * 0.40) / (1 + 0.85 + 0.70 + 0.55 + 0.40);
  assert.equal(first.config_versions.recency, 'RECENCY_WEIGHTS_V1');
  assert.equal(first.features.home_recent_ppg.value, second.features.home_recent_ppg.value);
  assert.ok(Math.abs(first.features.home_recent_ppg.value - expected) < 1e-10);
});

test('M: same inputs and versions produce the same frozen output', () => {
  const firstSnapshot = buildMatchEvidenceSnapshot(baseInput());
  const secondSnapshot = buildMatchEvidenceSnapshot(baseInput());
  const first = analyze(firstSnapshot);
  const second = analyze(secondSnapshot);
  assert.deepEqual(firstSnapshot, secondSnapshot);
  assert.deepEqual(first, second);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(verifyMatchEvidenceSnapshot(firstSnapshot), true);
});

test('N: settlement remains separate and cannot mutate frozen prediction', () => {
  const signal = freezeSystemSignal({
    signal_id: 'signal-001',
    event_id: 'event-001',
    frozen_at: CAPTURED,
    kickoff_at: KICKOFF,
    components: [{ marketFamily: 'TOTAL_GOALS_OVER_UNDER_FULL_TIME', selection: 'UNDER', line: 3.5 }]
  });
  const before = JSON.stringify(signal);
  const settlement = settleSystemSignalAndUserExecution({
    systemSignal: signal,
    userExecution: {
      execution_id: 'execution-001',
      components: [
        { marketFamily: 'TOTAL_GOALS_OVER_UNDER_FULL_TIME', selection: 'UNDER', line: 3.5 },
        { marketFamily: '1X2_FULL_TIME', selection: 'HOME' }
      ]
    },
    homeScore: 1,
    awayScore: 1,
    settledAt: '2026-08-30T18:00:00.000Z'
  });
  assert.equal(settlement.system_signal.result, 'WIN');
  assert.equal(settlement.user_execution.result, 'LOSS');
  assert.equal(JSON.stringify(signal), before);
  assert.equal(settlement.no_hindsight, true);
  assert.throws(() => settleSystemSignalAndUserExecution({
    systemSignal: { ...signal },
    homeScore: 1,
    awayScore: 1,
    settledAt: '2026-08-30T18:00:00.000Z'
  }), /SYSTEM_SIGNAL_INTEGRITY_INVALID/);
});

test('opponent-strength absence remains explicit instead of fabricated', () => {
  const withoutStrength = strongHomeOverall.map(({ opponentStrength: ignored, ...row }) => row);
  const snapshot = buildMatchEvidenceSnapshot(baseInput({ homeRecentMatches: withoutStrength }));
  assert.equal(snapshot.features.home_opponent_adjusted.adjusted_form_score.value, null);
  assert.equal(snapshot.features.home_opponent_adjusted.adjusted_form_score.fallback, 'OPPONENT_STRENGTH_UNAVAILABLE');
});

test('final scores never fabricate scoring time segments', () => {
  const snapshot = buildMatchEvidenceSnapshot(baseInput());
  assert.equal(snapshot.features.scoring_time_segments.home_score_rate_0_15.value, null);
  assert.equal(snapshot.features.scoring_time_segments.home_score_rate_0_15.fallback, 'MINUTE_DATA_UNAVAILABLE');
});

test('unsupported and unverified half markets remain explicit', () => {
  const snapshot = buildMatchEvidenceSnapshot(baseInput());
  const result = analyze(snapshot, {
    marketSelections: [
      { marketFamily: 'CORNERS', selection: 'OVER', line: 10.5 },
      { marketFamily: '1X2_FIRST_HALF', selection: 'HOME' },
      { marketFamily: 'DOUBLE_CHANCE_FULL_TIME', selection: '1X' },
      { marketFamily: '1X2_FULL_TIME', selection: 'HOME' }
    ]
  });
  assert.equal(result.unsupported_markets.length, 2);
  assert.deepEqual(result.unsupported_markets.map((row) => row.status), [
    'UNSUPPORTED_UNTIL_MODEL_EXISTS',
    'HALF_MODEL_NOT_VERIFIED'
  ]);
});

test('compatibility matrix derives contradiction from canonical score distribution', () => {
  const distribution = buildScoreDistribution({ homeLambda: 1.4, awayLambda: 1.0 });
  const candidates = [
    { marketFamily: 'BTTS_FULL_TIME', selection: 'YES', modelProbability: 0.5 },
    { marketFamily: 'CLEAN_SHEET_HOME', selection: 'YES', modelProbability: 0.4 }
  ];
  const matrix = buildMarketCompatibilityMatrix(distribution, candidates);
  assert.equal(matrix[0].compatibility, 'CONTRADICTORY');
});


test('review regression: market observation after snapshot capture is rejected', () => {
  assert.throws(() => buildMatchEvidenceSnapshot(baseInput({
    marketObservations: [{
      observationId: 'future-to-snapshot',
      marketSnapshotId: 'future-market-snapshot',
      marketFamily: '1X2_FULL_TIME',
      selection: 'HOME',
      odds: 2,
      provider: 'VERIFIED_PROVIDER_A',
      observedAt: '2026-08-30T12:30:00.000Z'
    }]
  })), /MARKET_OBSERVATION_AFTER_SNAPSHOT/);
});

test('review regression: primary and secondary are always distinct', () => {
  const snapshot = buildMatchEvidenceSnapshot(baseInput());
  const result = analyze(snapshot, {
    marketSelections: [
      { marketFamily: '1X2_FULL_TIME', selection: 'HOME' },
      { marketFamily: '1X2_FULL_TIME', selection: 'DRAW' },
      { marketFamily: '1X2_FULL_TIME', selection: 'AWAY' }
    ]
  });
  assert.ok(result.primary_outcome);
  assert.equal(result.secondary_outcome, null);
  assert.equal(
    new Set(result.compatible_outcome_cluster.map((row) => row.marketFamily + '|' + row.selection + '|' + row.line)).size,
    result.compatible_outcome_cluster.length
  );
  assert.equal(result.compatible_outcome_cluster.length, 1);
});

test('review regression: unsupported half/full joint models cannot enter one cluster', () => {
  const snapshot = buildMatchEvidenceSnapshot(baseInput());
  const halfReasoning = {
    model: { verified: true },
    firstHalf: { matchReality: { homeWin: 0.90, draw: 0.05, awayWin: 0.05 } },
    secondHalf: { matchReality: { homeWin: 0.40, draw: 0.30, awayWin: 0.30 } },
    crossHalf: {}
  };
  const result = analyze(snapshot, {
    halfReasoning,
    marketSelections: [
      { marketFamily: '1X2_FIRST_HALF', selection: 'HOME' },
      { marketFamily: '1X2_FULL_TIME', selection: 'HOME' }
    ]
  });
  assert.equal(result.market_compatibility_rules[0].compatibility, 'UNSUPPORTED');
  assert.equal(result.compatible_outcome_cluster.length, 1);
});
