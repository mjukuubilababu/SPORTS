import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EvidenceGraph } from '../src/evidence-graph.mjs';
import { discoverPatternCandidates } from '../src/pattern-discovery-candidates.mjs';
import {
  CONFIRMATORY_ALPHA,
  CONFIRMATORY_FREEZE_STATE,
  CONFIRMATORY_MIN_PRACTICAL_EFFECT,
  CONFIRMATORY_MULTIPLE_TESTING_METHOD,
  PATTERN_CONFIRMATORY_FREEZE_VERSION,
  classifyConfirmatoryObservation,
  freezePatternCandidateBatch,
  patternConfirmatoryPlanEvidenceNode,
  verifyPatternConfirmatoryFreeze
} from '../src/pattern-candidate-confirmatory-freeze.mjs';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(stableStringify(value)).digest('hex'); }

function observation({ matchId, date, subject, opponent, venue, leadSurrender = false, led = true, trailed = false, lateScored = false, lateConceded = false, openingScored = false, openingObserved = true }) {
  const payload = {
    feature_version: 'BEHAVIORAL_STATE_FEATURES_V0_1', canonical_match_id: matchId, canonical_match_date: date,
    season: 2026, league: 'TEST_LEAGUE', subject_team: subject, opponent_team: opponent, venue_side: venue,
    final_result: leadSurrender ? 'DRAW' : 'WIN', final_score_for: 1, final_score_against: leadSurrender ? 1 : 0,
    led_at_any_time: led, first_lead_minute: led ? 10 : null, lead_surrendered: leadSurrender,
    uninterrupted_lead_win: led && !leadSurrender, lead_surrendered_then_recovered_win: false,
    points_dropped_after_leading: led && leadSurrender, trailed_at_any_time: trailed,
    first_trailing_minute: trailed ? 20 : null, equalized_after_trailing: false, comeback_go_ahead: false,
    recovered_nonloss_after_trailing: false, recovered_win_after_trailing: false,
    opening_goal_scored: openingScored, opening_goal_conceded: openingObserved && !openingScored,
    opening_goal_observed: openingObserved, late_goal_scored_n: lateScored ? 1 : 0,
    late_goal_conceded_n: lateConceded ? 1 : 0, dismissal_for_n: 0, dismissal_against_n: 0,
    first_own_dismissal_minute: null, goals_scored_after_own_first_dismissal_n: 0,
    goals_conceded_after_own_first_dismissal_n: 0, substitution_n: 3, first_substitution_minute: 60,
    goals_scored_by_period: { '0_15':1, '16_30':0, '31_45_PLUS':0, '46_60':0, '61_75':0, '76_90_PLUS':lateScored ? 1 : 0 },
    goals_conceded_by_period: { '0_15':0, '16_30':0, '31_45_PLUS':0, '46_60':0, '61_75':0, '76_90_PLUS':lateConceded ? 1 : 0 },
    source_timeline_id:`TIMELINE-${matchId}`, source_timeline_fingerprint:`TL-${matchId}`,
    source_memory_id:`MEMORY-${matchId}`, source_memory_fingerprint:`MM-${matchId}`,
    descriptive_only:true, predictive_weight:0
  };
  return { ...payload, observation_fingerprint: sha256(payload) };
}

function makePair({ matchId, date, home, away, homeOptions = {}, awayOptions = {} }) {
  return [
    observation({ matchId, date, subject:home, opponent:away, venue:'HOME', ...homeOptions }),
    observation({ matchId, date, subject:away, opponent:home, venue:'AWAY', ...awayOptions })
  ];
}

function makeCorpus() {
  const observations=[];
  for (let i=0;i<30;i+=1) {
    const day=String((i%28)+1).padStart(2,'0');
    observations.push(...makePair({
      matchId:`SUBJECT-${i+1}`, date:`2026-01-${day}`, home:'ALPHA', away:`OPP-${i+1}`,
      homeOptions:{ leadSurrender:i<24, led:true, lateScored:i<24, openingScored:true },
      awayOptions:{ leadSurrender:false, led:false, trailed:true, lateConceded:i<24, openingScored:false }
    }));
  }
  for (let i=0;i<30;i+=1) {
    const day=String((i%28)+1).padStart(2,'0');
    observations.push(...makePair({
      matchId:`REFERENCE-${i+1}`, date:`2026-02-${day}`, home:`REF-H-${i+1}`, away:`REF-A-${i+1}`,
      homeOptions:{ leadSurrender:i<3, led:true, lateScored:i<3, openingScored:i%2===0 },
      awayOptions:{ leadSurrender:i<3, led:true, lateScored:i<3, openingScored:i%2!==0 }
    }));
  }
  const accepted=observations.length/2;
  const payload={
    corpus_version:'BEHAVIORAL_STATE_FEATURES_V0_1', materialized_at:'2026-07-01T12:00:00Z',
    input_match_pair_n:accepted, accepted_match_n:accepted, retained_ineligible_match_n:0,
    team_observation_n:observations.length, team_profile_n:0, observations, retained_ineligible_inputs:[], profiles:[],
    governance:{ each_eligible_match_creates_both_team_sides:true, outcome_based_deletion_forbidden:true,
      ineligible_structurally_valid_input_retained:true, tampered_or_cross_match_input_fails_closed:true,
      feature_layer_is_descriptive_only:true, pattern_discovery_performed_here:false, predictive_weight_assigned:false,
      automatic_retuning:false, automatic_pattern_promotion:false, market_data_used:false, p002_discovery_min_n:30,
      p002_changed:false, gate1_to_gate6_ownership_changed:false, capital_effect:'NONE', real_money:'NO' }
  };
  return { ...payload, corpus_fingerprint:sha256(payload) };
}

function discoveryBatch() {
  return discoverPatternCandidates({ corpus:makeCorpus(), discoveredAt:'2026-07-02T00:00:00Z', trainingCutoff:'2026-06-30' });
}
function freeze(batch=discoveryBatch()) {
  return freezePatternCandidateBatch({ discoveryBatch:batch, frozenAt:'2026-07-03T12:00:00Z' });
}

test('Step 5 freezes every Step 4 candidate without advancing lifecycle or running validation', () => {
  const batch=discoveryBatch();
  const frozen=freeze(batch);
  assert.equal(PATTERN_CONFIRMATORY_FREEZE_VERSION,'PATTERN_CANDIDATE_CONFIRMATORY_FREEZE_V0_1');
  assert.equal(frozen.state,CONFIRMATORY_FREEZE_STATE);
  assert.equal(frozen.confirmatory_start_date,'2026-07-04');
  assert.equal(frozen.source_candidate_n,batch.candidate_n);
  assert.equal(frozen.confirmatory_plans.length,batch.candidate_n);
  assert.deepEqual(frozen.selection_policy.frozen_candidate_fingerprints, frozen.selection_policy.source_candidate_fingerprints);
  assert.equal(frozen.selection_policy.manual_subset_allowed,false);
  assert.equal(frozen.governance.pattern_validation_performed,false);
  assert.equal(frozen.governance.predictive_weight_assigned,false);
  assert.equal(verifyPatternConfirmatoryFreeze(frozen,{ discoveryBatch:batch }),true);
});

test('confirmatory plan preregisters N, practical effect, direction and Holm FWER without spending alpha', () => {
  const frozen=freeze();
  const plan=frozen.confirmatory_plans[0];
  assert.equal(plan.confirmatory_test_plan.subject_match_n_min,30);
  assert.equal(plan.confirmatory_test_plan.subject_metric_opportunity_n_min,30);
  assert.equal(plan.confirmatory_test_plan.reference_metric_opportunity_n_min,30);
  assert.equal(CONFIRMATORY_MIN_PRACTICAL_EFFECT,0.10);
  assert.equal(plan.confirmatory_test_plan.minimum_practical_effect_absolute,0.10);
  assert.equal(CONFIRMATORY_ALPHA,0.05);
  assert.equal(plan.confirmatory_test_plan.familywise_alpha,0.05);
  assert.equal(CONFIRMATORY_MULTIPLE_TESTING_METHOD,'HOLM_BONFERRONI');
  assert.equal(plan.confirmatory_test_plan.multiple_testing_method,'HOLM_BONFERRONI');
  assert.equal(plan.confirmatory_test_plan.multiple_testing_family_size,frozen.source_candidate_n);
  assert.equal(plan.confirmatory_test_plan.significance_test_status,'NOT_RUN_STEP_5');
  assert.equal(frozen.multiple_testing_control.confirmatory_alpha_spent,false);
});

test('all discovery subject and reference match IDs are forbidden as confirmatory evidence', () => {
  const batch=discoveryBatch();
  const frozen=freeze(batch);
  const plan=frozen.confirmatory_plans.find(row => row.frozen_definition.scope.subject_team==='ALPHA' && row.frozen_definition.target_definition.metric_key==='LEAD_SURRENDER_RATE');
  assert.ok(plan);
  const candidate=batch.candidates.find(row => row.pattern_id===plan.pattern_id);
  const forbidden=new Set(plan.evidence_boundary.discovery_and_reference_match_ids_forbidden);
  for (const id of candidate.source_lineage.discovery_match_ids) assert.equal(forbidden.has(id),true);
  for (const id of candidate.source_lineage.reference_match_ids) assert.equal(forbidden.has(id),true);
});

test('freeze cannot be backdated to discovery time or earlier', () => {
  const batch=discoveryBatch();
  assert.throws(() => freezePatternCandidateBatch({ discoveryBatch:batch, frozenAt:'2026-07-02T00:00:00Z' }), /STEP5_FREEZE_MUST_FOLLOW_DISCOVERY/);
});

test('tampered Step 4 candidate cannot be frozen and tampered Step 5 plan fails closed', () => {
  const batch=discoveryBatch();
  const brokenBatch=structuredClone(batch);
  brokenBatch.candidates[0].hypothesis='rewritten after discovery';
  assert.throws(() => freezePatternCandidateBatch({ discoveryBatch:brokenBatch, frozenAt:'2026-07-03T12:00:00Z' }), /PATTERN_CANDIDATE_FINGERPRINT_INVALID/);
  const frozen=freeze(batch);
  const brokenFreeze=structuredClone(frozen);
  brokenFreeze.confirmatory_plans[0].frozen_definition.hypothesis='rewritten after freeze';
  assert.throws(() => verifyPatternConfirmatoryFreeze(brokenFreeze,{ discoveryBatch:batch }), /STEP5_CONFIRMATORY_PLAN_FINGERPRINT_INVALID/);
});

test('confirmatory freeze is visible in EvidenceGraph but remains decision ineligible', () => {
  const plan=freeze().confirmatory_plans[0];
  const node=patternConfirmatoryPlanEvidenceNode(plan);
  const graph=new EvidenceGraph(); graph.add(node);
  assert.equal(node.sourceVerified,true);
  assert.equal(node.planFrozen,true);
  assert.equal(node.patternValidated,false);
  assert.equal(node.decisionWeight,0);
  assert.equal(graph.decisionEligible(node.id),false);
});

test('future observation boundary separates subject, clean reference, and direct-subject counterpart', () => {
  const plan=freeze().confirmatory_plans.find(row => row.frozen_definition.scope.subject_team==='ALPHA' && row.frozen_definition.scope.venue_context==='ALL' && row.frozen_definition.target_definition.metric_key==='LEAD_SURRENDER_RATE');
  assert.ok(plan);
  const subject=observation({ matchId:'FUTURE-SUBJECT', date:'2026-07-04', subject:'ALPHA', opponent:'NEW-OPP', venue:'HOME', leadSurrender:true, led:true });
  const cleanReference=observation({ matchId:'FUTURE-REF', date:'2026-07-04', subject:'BETA', opponent:'GAMMA', venue:'HOME', leadSurrender:false, led:true });
  const counterpart=observation({ matchId:'FUTURE-SUBJECT', date:'2026-07-04', subject:'NEW-OPP', opponent:'ALPHA', venue:'AWAY', led:false, trailed:true });
  assert.deepEqual(classifyConfirmatoryObservation({ plan, observation:subject }).role,'SUBJECT');
  assert.equal(classifyConfirmatoryObservation({ plan, observation:subject }).eligible,true);
  assert.deepEqual(classifyConfirmatoryObservation({ plan, observation:cleanReference }).role,'REFERENCE');
  assert.equal(classifyConfirmatoryObservation({ plan, observation:cleanReference }).eligible,true);
  const excluded=classifyConfirmatoryObservation({ plan, observation:counterpart });
  assert.equal(excluded.role,'EXCLUDED_DIRECT_SUBJECT_MATCH_COUNTERPART');
  assert.equal(excluded.eligible,false);
  assert.ok(excluded.reasons.includes('DIRECT_SUBJECT_MATCH_COUNTERPART_REFERENCE_FORBIDDEN'));
});

test('pre-freeze-date and discovery-match reuse fail the confirmatory evidence boundary', () => {
  const plan=freeze().confirmatory_plans.find(row => row.frozen_definition.scope.subject_team==='ALPHA' && row.frozen_definition.scope.venue_context==='ALL' && row.frozen_definition.target_definition.metric_key==='LEAD_SURRENDER_RATE');
  const old=observation({ matchId:'NEW-BUT-OLD-DATE', date:'2026-07-03', subject:'ALPHA', opponent:'ZETA', venue:'HOME', leadSurrender:true, led:true });
  const reused=observation({ matchId:'SUBJECT-1', date:'2026-07-04', subject:'ALPHA', opponent:'OPP-1', venue:'HOME', leadSurrender:true, led:true });
  const oldResult=classifyConfirmatoryObservation({ plan, observation:old });
  const reusedResult=classifyConfirmatoryObservation({ plan, observation:reused });
  assert.equal(oldResult.eligible,false);
  assert.ok(oldResult.reasons.includes('PRE_FREEZE_DATE_EVIDENCE_FORBIDDEN'));
  assert.equal(reusedResult.eligible,false);
  assert.ok(reusedResult.reasons.includes('DISCOVERY_MATCH_REUSE_FORBIDDEN'));
});
