import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EvidenceGraph } from '../src/evidence-graph.mjs';
import {
  DISCOVERY_EFFECT_FLOOR,
  PATTERN_DISCOVERY_CANDIDATES_VERSION,
  PREDECLARED_CANDIDATE_FAMILIES,
  discoverPatternCandidates,
  patternCandidateEvidenceNode,
  verifyPatternDiscoveryBatch
} from '../src/pattern-discovery-candidates.mjs';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function observation({ matchId, date, subject, opponent, venue, leadSurrender = false, led = true, trailed = false, lateScored = false, lateConceded = false, openingScored = false, openingObserved = true }) {
  const payload = {
    feature_version: 'BEHAVIORAL_STATE_FEATURES_V0_1',
    canonical_match_id: matchId,
    canonical_match_date: date,
    season: 2026,
    league: 'TEST_LEAGUE',
    subject_team: subject,
    opponent_team: opponent,
    venue_side: venue,
    final_result: leadSurrender ? 'DRAW' : 'WIN',
    final_score_for: 1,
    final_score_against: leadSurrender ? 1 : 0,
    led_at_any_time: led,
    first_lead_minute: led ? 10 : null,
    lead_surrendered: leadSurrender,
    uninterrupted_lead_win: led && !leadSurrender,
    lead_surrendered_then_recovered_win: false,
    points_dropped_after_leading: led && leadSurrender,
    trailed_at_any_time: trailed,
    first_trailing_minute: trailed ? 20 : null,
    equalized_after_trailing: false,
    comeback_go_ahead: false,
    recovered_nonloss_after_trailing: false,
    recovered_win_after_trailing: false,
    opening_goal_scored: openingScored,
    opening_goal_conceded: openingObserved && !openingScored,
    opening_goal_observed: openingObserved,
    late_goal_scored_n: lateScored ? 1 : 0,
    late_goal_conceded_n: lateConceded ? 1 : 0,
    dismissal_for_n: 0,
    dismissal_against_n: 0,
    first_own_dismissal_minute: null,
    goals_scored_after_own_first_dismissal_n: 0,
    goals_conceded_after_own_first_dismissal_n: 0,
    substitution_n: 3,
    first_substitution_minute: 60,
    goals_scored_by_period: { '0_15':1, '16_30':0, '31_45_PLUS':0, '46_60':0, '61_75':0, '76_90_PLUS':lateScored ? 1 : 0 },
    goals_conceded_by_period: { '0_15':0, '16_30':0, '31_45_PLUS':0, '46_60':0, '61_75':0, '76_90_PLUS':lateConceded ? 1 : 0 },
    source_timeline_id: `TIMELINE-${matchId}`,
    source_timeline_fingerprint: `TL-${matchId}`,
    source_memory_id: `MEMORY-${matchId}`,
    source_memory_fingerprint: `MM-${matchId}`,
    descriptive_only: true,
    predictive_weight: 0
  };
  return { ...payload, observation_fingerprint: sha256(payload) };
}

function makePair({ matchId, date, home, away, homeOptions = {}, awayOptions = {} }) {
  return [
    observation({ matchId, date, subject: home, opponent: away, venue: 'HOME', ...homeOptions }),
    observation({ matchId, date, subject: away, opponent: home, venue: 'AWAY', ...awayOptions })
  ];
}

function makeCorpus({ includePostCutoff = false, marketDataUsed = false } = {}) {
  const observations = [];
  for (let i = 0; i < 30; i += 1) {
    const day = String((i % 28) + 1).padStart(2, '0');
    observations.push(...makePair({
      matchId: `SUBJECT-${i + 1}`,
      date: `2026-01-${day}`,
      home: 'ALPHA',
      away: `OPP-${i + 1}`,
      homeOptions: { leadSurrender: i < 24, led: true, lateScored: i < 24, openingScored: true },
      awayOptions: { leadSurrender: false, led: false, trailed: true, lateConceded: i < 24, openingScored: false }
    }));
  }
  for (let i = 0; i < 30; i += 1) {
    const day = String((i % 28) + 1).padStart(2, '0');
    observations.push(...makePair({
      matchId: `REFERENCE-${i + 1}`,
      date: `2026-02-${day}`,
      home: `REF-H-${i + 1}`,
      away: `REF-A-${i + 1}`,
      homeOptions: { leadSurrender: i < 3, led: true, lateScored: i < 3, openingScored: i % 2 === 0 },
      awayOptions: { leadSurrender: i < 3, led: true, lateScored: i < 3, openingScored: i % 2 !== 0 }
    }));
  }
  if (includePostCutoff) {
    observations.push(...makePair({
      matchId: 'POST-CUTOFF-1',
      date: '2026-07-01',
      home: 'ALPHA',
      away: 'POST-OPP',
      homeOptions: { leadSurrender: false, led: true, lateScored: false, openingScored: true },
      awayOptions: { leadSurrender: true, led: true, lateScored: true, openingScored: false }
    }));
  }
  const acceptedMatchN = observations.length / 2;
  const payload = {
    corpus_version: 'BEHAVIORAL_STATE_FEATURES_V0_1',
    materialized_at: '2026-07-01T12:00:00Z',
    input_match_pair_n: acceptedMatchN,
    accepted_match_n: acceptedMatchN,
    retained_ineligible_match_n: 0,
    team_observation_n: observations.length,
    team_profile_n: 0,
    observations,
    retained_ineligible_inputs: [],
    profiles: [],
    governance: {
      each_eligible_match_creates_both_team_sides: true,
      outcome_based_deletion_forbidden: true,
      ineligible_structurally_valid_input_retained: true,
      tampered_or_cross_match_input_fails_closed: true,
      feature_layer_is_descriptive_only: true,
      pattern_discovery_performed_here: false,
      predictive_weight_assigned: false,
      automatic_retuning: false,
      automatic_pattern_promotion: false,
      market_data_used: marketDataUsed,
      p002_discovery_min_n: 30,
      p002_changed: false,
      gate1_to_gate6_ownership_changed: false,
      capital_effect: 'NONE',
      real_money: 'NO'
    }
  };
  return { ...payload, corpus_fingerprint: sha256(payload) };
}

function discover(corpus = makeCorpus()) {
  return discoverPatternCandidates({
    corpus,
    discoveredAt: '2026-07-02T00:00:00Z',
    trainingCutoff: '2026-06-30'
  });
}

test('Step 4 uses a frozen finite candidate language and remains discovery-only', () => {
  assert.equal(PATTERN_DISCOVERY_CANDIDATES_VERSION, 'PATTERN_DISCOVERY_CANDIDATES_V0_1');
  assert.equal(DISCOVERY_EFFECT_FLOOR, 0.10);
  assert.equal(PREDECLARED_CANDIDATE_FAMILIES.length, 8);
  const batch = discover();
  assert.equal(batch.governance.pattern_discovery_performed, true);
  assert.equal(batch.governance.pattern_validation_performed, false);
  assert.equal(batch.governance.predictive_weight_assigned, false);
  assert.equal(batch.multiple_testing_ledger.confirmatory_alpha_spent, false);
  assert.equal(batch.holdout_boundary.future_confirmatory_sample_must_be_disjoint, true);
  assert.equal(verifyPatternDiscoveryBatch(batch), true);
});

test('strong lead-surrender behavior becomes a zero-weight candidate against independent reference matches', () => {
  const batch = discover();
  const candidate = batch.candidates.find(row => row.scope.subject_team === 'ALPHA' && row.scope.venue_context === 'ALL' && row.target_definition.metric_key === 'LEAD_SURRENDER_RATE');
  assert.ok(candidate);
  assert.equal(candidate.state, 'CANDIDATE');
  assert.equal(candidate.sample_n, 30);
  assert.equal(candidate.baseline_comparison.subject.success_n, 24);
  assert.equal(candidate.baseline_comparison.subject.opportunity_n, 30);
  assert.equal(candidate.baseline_comparison.reference.opportunity_n, 60);
  assert.ok(candidate.effect_estimate.difference > 0.6);
  assert.ok(candidate.uncertainty.low > 0);
  assert.equal(candidate.source_lineage.direct_match_overlap_n, 0);
  assert.equal(candidate.governance.predictive_weight, 0);
  assert.equal(candidate.out_of_sample_result, 'NOT_RUN_STEP_4');
  assert.equal(candidate.forward_result, 'NOT_RUN_STEP_4');
});

test('direct opponent rows from subject matches are excluded from the reference baseline', () => {
  const batch = discover();
  const candidate = batch.candidates.find(row => row.scope.subject_team === 'ALPHA' && row.scope.venue_context === 'HOME' && row.target_definition.metric_key === 'LEAD_SURRENDER_RATE');
  assert.ok(candidate);
  assert.equal(candidate.reference_match_n, 30);
  const subjectIds = new Set(candidate.source_lineage.discovery_match_ids);
  assert.equal(candidate.source_lineage.reference_match_ids.some(id => subjectIds.has(id)), false);
  assert.equal(candidate.baseline_comparison.direct_subject_match_rows_excluded, true);
});

test('opportunity-specific N=30 is required even when team match N is 30', () => {
  const batch = discover();
  const trailing = batch.evaluations.find(row => row.team === 'ALPHA' && row.context === 'ALL' && row.candidate_family === 'WIN_AFTER_TRAILING_RATE');
  assert.ok(trailing);
  assert.equal(trailing.subject_match_n, 30);
  assert.equal(trailing.subject.opportunity_n, 0);
  assert.equal(trailing.status, 'INSUFFICIENT_SUBJECT_OPPORTUNITY_N');
  assert.equal(batch.candidates.some(row => row.scope.subject_team === 'ALPHA' && row.target_definition.metric_key === 'WIN_AFTER_TRAILING_RATE'), false);
});

test('post-cutoff observations are retained in the source corpus but excluded from discovery', () => {
  const batch = discover(makeCorpus({ includePostCutoff: true }));
  assert.equal(batch.excluded_post_cutoff_observation_n, 2);
  assert.equal(batch.holdout_boundary.observations_after_training_cutoff_used, false);
  const candidate = batch.candidates.find(row => row.scope.subject_team === 'ALPHA' && row.scope.venue_context === 'ALL' && row.target_definition.metric_key === 'LEAD_SURRENDER_RATE');
  assert.equal(candidate.subject_match_n, 30);
  assert.equal(candidate.source_lineage.discovery_match_ids.includes('POST-CUTOFF-1'), false);
});

test('candidate bridge is visible to EvidenceGraph but never decision eligible', () => {
  const batch = discover();
  const candidate = batch.candidates[0];
  const node = patternCandidateEvidenceNode(candidate);
  const graph = new EvidenceGraph();
  graph.add(node);
  assert.equal(node.sourceVerified, true);
  assert.equal(node.patternValidated, false);
  assert.equal(node.decisionWeight, 0);
  assert.equal(graph.decisionEligible(node.id), false);
});

test('market-derived behavioral truth is rejected even with a valid corpus fingerprint', () => {
  assert.throws(() => discover(makeCorpus({ marketDataUsed: true })), /MARKET_DERIVED_BEHAVIORAL_TRUTH_FORBIDDEN/);
});

test('discovery cannot run before corpus materialization or on the cutoff date', () => {
  const corpus = makeCorpus();
  assert.throws(() => discoverPatternCandidates({ corpus, discoveredAt: '2026-06-30T12:00:00Z', trainingCutoff: '2026-06-30' }), /DISCOVERY_BEFORE_CORPUS_MATERIALIZATION_FORBIDDEN|DISCOVERY_TIMESTAMP_MUST_FOLLOW_TRAINING_CUTOFF/);
});

test('fingerprint tampering fails closed', () => {
  const batch = discover();
  const tampered = structuredClone(batch);
  tampered.candidates[0].hypothesis = 'story changed after seeing result';
  assert.throws(() => verifyPatternDiscoveryBatch(tampered), /PATTERN_CANDIDATE_FINGERPRINT_INVALID/);
});
