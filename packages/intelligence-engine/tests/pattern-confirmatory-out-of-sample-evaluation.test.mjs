import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EvidenceGraph } from '../src/evidence-graph.mjs';
import { discoverPatternCandidates } from '../src/pattern-discovery-candidates.mjs';
import { freezePatternCandidateBatch } from '../src/pattern-candidate-confirmatory-freeze.mjs';
import {
  PATTERN_CONFIRMATORY_MIN_CLUSTER_N,
  PATTERN_CONFIRMATORY_OOS_TESTED_STATE,
  PATTERN_CONFIRMATORY_OOS_VERSION,
  PATTERN_CONFIRMATORY_OOS_WAITING_STATE,
  evaluatePatternConfirmatoryOutOfSample,
  holmBonferroni,
  patternConfirmatoryEvaluationEvidenceNode,
  verifyPatternConfirmatoryEvaluation
} from '../src/pattern-confirmatory-out-of-sample-evaluation.mjs';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(stableStringify(value)).digest('hex'); }

function observation({ matchId, date, subject, opponent, venue, leadSurrender = false, led = true, trailed = false, openingScored = false, openingObserved = true }) {
  const payload = {
    feature_version:'BEHAVIORAL_STATE_FEATURES_V0_1', canonical_match_id:matchId, canonical_match_date:date,
    season:2026, league:'TEST_LEAGUE', subject_team:subject, opponent_team:opponent, venue_side:venue,
    final_result:'WIN', final_score_for:2, final_score_against:leadSurrender ? 1 : 0,
    led_at_any_time:led, first_lead_minute:led ? 10 : null, lead_surrendered:leadSurrender,
    uninterrupted_lead_win:led && !leadSurrender, lead_surrendered_then_recovered_win:led && leadSurrender,
    points_dropped_after_leading:false, trailed_at_any_time:trailed, first_trailing_minute:trailed ? 20 : null,
    equalized_after_trailing:false, comeback_go_ahead:false, recovered_nonloss_after_trailing:false,
    recovered_win_after_trailing:false, opening_goal_scored:openingScored,
    opening_goal_conceded:openingObserved && !openingScored, opening_goal_observed:openingObserved,
    late_goal_scored_n:0, late_goal_conceded_n:0, dismissal_for_n:0, dismissal_against_n:0,
    first_own_dismissal_minute:null, goals_scored_after_own_first_dismissal_n:0,
    goals_conceded_after_own_first_dismissal_n:0, substitution_n:3, first_substitution_minute:60,
    goals_scored_by_period:{'0_15':1,'16_30':0,'31_45_PLUS':0,'46_60':0,'61_75':0,'76_90_PLUS':0},
    goals_conceded_by_period:{'0_15':0,'16_30':0,'31_45_PLUS':0,'46_60':0,'61_75':0,'76_90_PLUS':0},
    source_timeline_id:`TIMELINE-${matchId}`, source_timeline_fingerprint:`TL-${matchId}`,
    source_memory_id:`MEMORY-${matchId}`, source_memory_fingerprint:`MM-${matchId}`,
    descriptive_only:true, predictive_weight:0
  };
  return { ...payload, observation_fingerprint:sha256(payload) };
}

function makePair({ matchId, date, home, away, homeOptions = {}, awayOptions = {} }) {
  return [
    observation({ matchId, date, subject:home, opponent:away, venue:'HOME', ...homeOptions }),
    observation({ matchId, date, subject:away, opponent:home, venue:'AWAY', ...awayOptions })
  ];
}

function corpusFromObservations(observations, materializedAt, { marketDataUsed = false } = {}) {
  const accepted = observations.length / 2;
  const payload = {
    corpus_version:'BEHAVIORAL_STATE_FEATURES_V0_1', materialized_at:materializedAt,
    input_match_pair_n:accepted, accepted_match_n:accepted, retained_ineligible_match_n:0,
    team_observation_n:observations.length, team_profile_n:0, observations,
    retained_ineligible_inputs:[], profiles:[],
    governance:{ each_eligible_match_creates_both_team_sides:true, outcome_based_deletion_forbidden:true,
      ineligible_structurally_valid_input_retained:true, tampered_or_cross_match_input_fails_closed:true,
      feature_layer_is_descriptive_only:true, pattern_discovery_performed_here:false, predictive_weight_assigned:false,
      automatic_retuning:false, automatic_pattern_promotion:false, market_data_used:marketDataUsed,
      p002_discovery_min_n:30, p002_changed:false, gate1_to_gate6_ownership_changed:false,
      capital_effect:'NONE', real_money:'NO' }
  };
  return { ...payload, corpus_fingerprint:sha256(payload) };
}

function discoveryCorpus() {
  const observations=[];
  for (let i=0;i<30;i+=1) {
    const date=`2026-01-${String((i%28)+1).padStart(2,'0')}`;
    const alphaHome=i%2===0;
    const alphaOptions={ leadSurrender:i<24, led:true, openingScored:i%2===0 };
    const oppOptions={ leadSurrender:false, led:false, trailed:true, openingScored:i%2!==0 };
    observations.push(...makePair({
      matchId:`DISC-SUB-${i+1}`, date,
      home:alphaHome ? 'ALPHA' : `OPP-${i+1}`,
      away:alphaHome ? `OPP-${i+1}` : 'ALPHA',
      homeOptions:alphaHome ? alphaOptions : oppOptions,
      awayOptions:alphaHome ? oppOptions : alphaOptions
    }));
  }
  for (let i=0;i<30;i+=1) {
    const date=`2026-02-${String((i%28)+1).padStart(2,'0')}`;
    observations.push(...makePair({
      matchId:`DISC-REF-${i+1}`, date, home:`RH-${i+1}`, away:`RA-${i+1}`,
      homeOptions:{ leadSurrender:i<3, led:true, openingScored:i%2===0 },
      awayOptions:{ leadSurrender:i<3, led:true, openingScored:i%2!==0 }
    }));
  }
  return corpusFromObservations(observations,'2026-07-01T12:00:00Z');
}

function discoveryBatch() {
  const batch=discoverPatternCandidates({ corpus:discoveryCorpus(), discoveredAt:'2026-07-02T00:00:00Z', trainingCutoff:'2026-06-30' });
  assert.equal(batch.candidate_n,1);
  return batch;
}
function freeze() {
  const batch=discoveryBatch();
  return { batch, frozen:freezePatternCandidateBatch({ discoveryBatch:batch, frozenAt:'2026-07-03T12:00:00Z' }) };
}

function confirmatoryCorpus({ subjectMatchN=30, subjectSurrenderN=24, referenceMatchN=30, referenceSurrenderPairN=3, marketDataUsed=false }={}) {
  const observations=[];
  for (let i=0;i<subjectMatchN;i+=1) {
    const date=`2026-08-${String((i%28)+1).padStart(2,'0')}`;
    const alphaHome=i%2===0;
    const alphaOptions={ leadSurrender:i<subjectSurrenderN, led:true, openingScored:i%2===0 };
    const oppOptions={ leadSurrender:false, led:false, trailed:true, openingScored:i%2!==0 };
    observations.push(...makePair({
      matchId:`OOS-SUB-${i+1}`, date,
      home:alphaHome ? 'ALPHA' : `OOS-OPP-${i+1}`,
      away:alphaHome ? `OOS-OPP-${i+1}` : 'ALPHA',
      homeOptions:alphaHome ? alphaOptions : oppOptions,
      awayOptions:alphaHome ? oppOptions : alphaOptions
    }));
  }
  for (let i=0;i<referenceMatchN;i+=1) {
    const date=`2026-09-${String((i%28)+1).padStart(2,'0')}`;
    observations.push(...makePair({
      matchId:`OOS-REF-${i+1}`, date, home:`OOS-RH-${i+1}`, away:`OOS-RA-${i+1}`,
      homeOptions:{ leadSurrender:i<referenceSurrenderPairN, led:true, openingScored:i%2===0 },
      awayOptions:{ leadSurrender:i<referenceSurrenderPairN, led:true, openingScored:i%2!==0 }
    }));
  }
  return corpusFromObservations(observations,'2026-09-30T12:00:00Z',{marketDataUsed});
}

function evaluate(corpus=confirmatoryCorpus(), priorEvaluation=null) {
  const { batch, frozen }=freeze();
  return evaluatePatternConfirmatoryOutOfSample({ freeze:frozen, discoveryBatch:batch, corpus, evaluatedAt:'2026-10-01T00:00:00Z', priorEvaluation });
}

test('Step 6 waits without spending alpha when any frozen hypothesis is below N/cluster gates', () => {
  const result=evaluate(confirmatoryCorpus({subjectMatchN:29}));
  assert.equal(PATTERN_CONFIRMATORY_OOS_VERSION,'PATTERN_CONFIRMATORY_OUT_OF_SAMPLE_EVALUATION_V0_1');
  assert.equal(PATTERN_CONFIRMATORY_MIN_CLUSTER_N,30);
  assert.equal(result.state,PATTERN_CONFIRMATORY_OOS_WAITING_STATE);
  assert.equal(result.family_ready_for_test,false);
  assert.equal(result.multiple_testing.confirmatory_alpha_spent,false);
  assert.equal(result.multiple_testing.significance_test_run,false);
  assert.equal(result.candidate_results[0].raw_one_sided_p_value,null);
  assert.equal(result.candidate_results[0].decision_weight,0);
  assert.equal(verifyPatternConfirmatoryEvaluation(result),true);
});

test('strong disjoint OOS replication passes one-sided cluster-robust test and Holm but remains zero weight', () => {
  const result=evaluate();
  assert.equal(result.state,PATTERN_CONFIRMATORY_OOS_TESTED_STATE);
  assert.equal(result.family_ready_for_test,true);
  assert.equal(result.multiple_testing.confirmatory_alpha_spent,true);
  const row=result.candidate_results[0];
  assert.equal(row.subject.opportunity_n,30);
  assert.equal(row.subject.cluster_n,30);
  assert.equal(row.reference.opportunity_n,60);
  assert.equal(row.reference.cluster_n,30);
  assert.equal(row.out_of_sample_result,'PASS');
  assert.equal(row.effect_estimate.minimum_practical_effect_met,true);
  assert.equal(row.significance.holm_reject_null,true);
  assert.ok(row.significance.raw_one_sided_p_value < 0.05);
  assert.equal(row.pattern_validated,false);
  assert.equal(row.decision_weight,0);
});

test('failed OOS candidate is retained rather than deleted or rewritten', () => {
  const result=evaluate(confirmatoryCorpus({subjectSurrenderN:6,referenceSurrenderPairN:6}));
  const row=result.candidate_results[0];
  assert.equal(row.out_of_sample_result,'FAIL');
  assert.equal(row.rejected_evidence_retained,true);
  assert.equal(row.pattern_validated,false);
  assert.equal(row.decision_weight,0);
  assert.match(row.state,/^REJECTED_OOS_/);
});

test('Holm-Bonferroni is deterministic and stops rejecting after first ordered failure', () => {
  const rows=holmBonferroni([
    {pattern_id:'P3',raw_one_sided_p_value:0.04},
    {pattern_id:'P1',raw_one_sided_p_value:0.01},
    {pattern_id:'P2',raw_one_sided_p_value:0.03}
  ],0.05);
  const byId=Object.fromEntries(rows.map(row=>[row.pattern_id,row]));
  assert.equal(byId.P1.holm_rank,1);
  assert.equal(byId.P1.holm_reject_null,true);
  assert.equal(byId.P2.holm_reject_null,false);
  assert.equal(byId.P3.holm_reject_null,false);
  assert.ok(byId.P2.holm_adjusted_p_value >= byId.P1.holm_adjusted_p_value);
});

test('discovery rows can remain in full corpus but are excluded from Step 6 evidence by frozen boundary', () => {
  const { batch, frozen }=freeze();
  const future=confirmatoryCorpus();
  const combined=[...discoveryCorpus().observations,...future.observations];
  const corpus=corpusFromObservations(combined,'2026-09-30T12:00:00Z');
  const result=evaluatePatternConfirmatoryOutOfSample({ freeze:frozen, discoveryBatch:batch, corpus, evaluatedAt:'2026-10-01T00:00:00Z' });
  const row=result.candidate_results[0];
  assert.equal(row.subject.match_n,30);
  assert.ok((row.exclusion_counts.DISCOVERY_MATCH_REUSE_FORBIDDEN ?? 0) > 0 || (row.exclusion_counts.PRE_FREEZE_DATE_EVIDENCE_FORBIDDEN ?? 0) > 0);
});

test('market-derived behavioral truth is rejected before confirmatory testing', () => {
  assert.throws(() => evaluate(confirmatoryCorpus({marketDataUsed:true})),/STEP6_MARKET_DERIVED_BEHAVIORAL_TRUTH_FORBIDDEN/);
});

test('after alpha is spent a different corpus cannot be used to retest the same frozen family', () => {
  const first=evaluate();
  assert.equal(first.multiple_testing.confirmatory_alpha_spent,true);
  assert.throws(() => evaluate(confirmatoryCorpus({subjectSurrenderN:20}),first),/STEP6_CONFIRMATORY_RETEST_AFTER_ALPHA_SPEND_FORBIDDEN/);
});

test('tampering with a Step 6 result fails closed', () => {
  const result=evaluate();
  const broken=structuredClone(result);
  broken.candidate_results[0].decision_weight=1;
  assert.throws(() => verifyPatternConfirmatoryEvaluation(broken),/STEP6_EVALUATION_FINGERPRINT_INVALID|STEP6_RESULT_FINGERPRINT_INVALID|STEP6_RESULT_DECISION_WEIGHT_FORBIDDEN/);
});

test('OOS pass is visible to EvidenceGraph but is not a validated decision signal', () => {
  const row=evaluate().candidate_results[0];
  const node=patternConfirmatoryEvaluationEvidenceNode(row);
  const graph=new EvidenceGraph(); graph.add(node);
  assert.equal(node.sourceVerified,true);
  assert.equal(node.confirmatoryOosPassed,true);
  assert.equal(node.patternValidated,false);
  assert.equal(node.decisionWeight,0);
  assert.equal(graph.decisionEligible(node.id),false);
});
