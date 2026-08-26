import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EvidenceGraph } from '../src/evidence-graph.mjs';
import { discoverPatternCandidates } from '../src/pattern-discovery-candidates.mjs';
import { freezePatternCandidateBatch } from '../src/pattern-candidate-confirmatory-freeze.mjs';
import { evaluatePatternConfirmatoryOutOfSample } from '../src/pattern-confirmatory-out-of-sample-evaluation.mjs';
import {
  PATTERN_TEMPORAL_CONTEXT_STABILITY_VERSION,
  STABILITY_MAX_OPPONENT_CLUSTER_SHARE,
  STABILITY_MIN_UNIQUE_OPPONENT_N,
  STABILITY_MIN_WINDOW_CLUSTER_N,
  STABILITY_MIN_WINDOW_OPPORTUNITY_N,
  STABILITY_MIN_WINDOW_ORIENTED_EFFECT,
  TEMPORAL_WINDOW_N,
  evaluatePatternTemporalContextStability,
  patternStabilityEvidenceNode,
  verifyPatternTemporalContextStability
} from '../src/pattern-temporal-context-stability.mjs';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(stableStringify(value)).digest('hex'); }

function observation({ matchId, date, subject, opponent, venue, leadSurrender=false, led=true, trailed=false, season=2026 }) {
  const payload={
    feature_version:'BEHAVIORAL_STATE_FEATURES_V0_1', canonical_match_id:matchId, canonical_match_date:date,
    season, league:'TEST_LEAGUE', subject_team:subject, opponent_team:opponent, venue_side:venue,
    final_result:'WIN', final_score_for:2, final_score_against:leadSurrender ? 1 : 0,
    led_at_any_time:led, first_lead_minute:led ? 10 : null, lead_surrendered:leadSurrender,
    uninterrupted_lead_win:led && !leadSurrender, lead_surrendered_then_recovered_win:led && leadSurrender,
    points_dropped_after_leading:false, trailed_at_any_time:trailed, first_trailing_minute:trailed ? 20 : null,
    equalized_after_trailing:false, comeback_go_ahead:false, recovered_nonloss_after_trailing:false,
    recovered_win_after_trailing:false, opening_goal_scored:led, opening_goal_conceded:!led,
    opening_goal_observed:true, late_goal_scored_n:0, late_goal_conceded_n:0,
    dismissal_for_n:0, dismissal_against_n:0, first_own_dismissal_minute:null,
    goals_scored_after_own_first_dismissal_n:0, goals_conceded_after_own_first_dismissal_n:0,
    substitution_n:3, first_substitution_minute:60,
    goals_scored_by_period:{'0_15':1,'16_30':0,'31_45_PLUS':0,'46_60':0,'61_75':0,'76_90_PLUS':0},
    goals_conceded_by_period:{'0_15':0,'16_30':0,'31_45_PLUS':0,'46_60':0,'61_75':0,'76_90_PLUS':0},
    source_timeline_id:`TIMELINE-${matchId}`, source_timeline_fingerprint:`TL-${matchId}`,
    source_memory_id:`MEMORY-${matchId}`, source_memory_fingerprint:`MM-${matchId}`,
    descriptive_only:true, predictive_weight:0
  };
  return { ...payload, observation_fingerprint:sha256(payload) };
}

function makePair({ matchId, date, home, away, homeOptions={}, awayOptions={} }) {
  return [
    observation({ matchId, date, subject:home, opponent:away, venue:'HOME', ...homeOptions }),
    observation({ matchId, date, subject:away, opponent:home, venue:'AWAY', ...awayOptions })
  ];
}

function corpusFromObservations(observations, materializedAt) {
  const accepted=observations.length/2;
  const payload={
    corpus_version:'BEHAVIORAL_STATE_FEATURES_V0_1', materialized_at:materializedAt,
    input_match_pair_n:accepted, accepted_match_n:accepted, retained_ineligible_match_n:0,
    team_observation_n:observations.length, team_profile_n:0, observations,
    retained_ineligible_inputs:[], profiles:[],
    governance:{ each_eligible_match_creates_both_team_sides:true, outcome_based_deletion_forbidden:true,
      ineligible_structurally_valid_input_retained:true, tampered_or_cross_match_input_fails_closed:true,
      feature_layer_is_descriptive_only:true, pattern_discovery_performed_here:false, predictive_weight_assigned:false,
      automatic_retuning:false, automatic_pattern_promotion:false, market_data_used:false,
      p002_discovery_min_n:30, p002_changed:false, gate1_to_gate6_ownership_changed:false,
      capital_effect:'NONE', real_money:'NO' }
  };
  return { ...payload, corpus_fingerprint:sha256(payload) };
}

function discoveryCorpus({homeOnly=false}={}) {
  const observations=[];
  for (let i=0;i<30;i+=1) {
    const date=`2026-01-${String((i%28)+1).padStart(2,'0')}`;
    const alphaHome=homeOnly ? true : i%2===0;
    const alphaOptions={leadSurrender:i%10<8,led:true};
    const oppOptions={leadSurrender:false,led:false,trailed:true};
    observations.push(...makePair({
      matchId:`DISC-SUB-${i+1}`,date,
      home:alphaHome?'ALPHA':`DISC-OPP-${i+1}`,
      away:alphaHome?`DISC-OPP-${i+1}`:'ALPHA',
      homeOptions:alphaHome?alphaOptions:oppOptions,
      awayOptions:alphaHome?oppOptions:alphaOptions
    }));
  }
  for (let i=0;i<30;i+=1) {
    const date=`2026-02-${String((i%28)+1).padStart(2,'0')}`;
    const refSuccess=i%10<1;
    observations.push(...makePair({
      matchId:`DISC-REF-${i+1}`,date,home:`DRH-${i+1}`,away:`DRA-${i+1}`,
      homeOptions:{leadSurrender:refSuccess,led:true},awayOptions:{leadSurrender:refSuccess,led:true}
    }));
  }
  return corpusFromObservations(observations,'2026-07-01T12:00:00Z');
}

function setupFreeze({homeOnly=false}={}) {
  const discovery=discoveryCorpus({homeOnly});
  const batch=discoverPatternCandidates({corpus:discovery,discoveredAt:'2026-07-02T00:00:00Z',trainingCutoff:'2026-06-30'});
  assert.ok(batch.candidate_n>=1);
  const frozen=freezePatternCandidateBatch({discoveryBatch:batch,frozenAt:'2026-07-03T12:00:00Z'});
  return {batch,frozen};
}

function confirmatoryCorpus({
  subjectMatchN=30,
  homeOnly=false,
  subjectSuccess=(i)=>i%10<8,
  opponent=(i)=>`OOS-OPP-${i+1}`,
  season=(i)=>2026
}={}) {
  const observations=[];
  for (let i=0;i<subjectMatchN;i+=1) {
    const date=`2026-08-${String(i+1).padStart(2,'0')}`;
    const alphaHome=homeOnly ? true : i%2===0;
    const alphaOptions={leadSurrender:subjectSuccess(i,alphaHome),led:true,season:season(i)};
    const oppOptions={leadSurrender:false,led:false,trailed:true,season:season(i)};
    const opp=opponent(i);
    observations.push(...makePair({
      matchId:`OOS-SUB-${i+1}`,date,home:alphaHome?'ALPHA':opp,away:alphaHome?opp:'ALPHA',
      homeOptions:alphaHome?alphaOptions:oppOptions,awayOptions:alphaHome?oppOptions:alphaOptions
    }));
  }
  for (let i=0;i<30;i+=1) {
    const date=`2026-08-${String(i+1).padStart(2,'0')}`;
    const refSuccess=i%10<1;
    const s=season(i);
    observations.push(...makePair({
      matchId:`OOS-REF-${i+1}`,date,home:`ORH-${i+1}`,away:`ORA-${i+1}`,
      homeOptions:{leadSurrender:refSuccess,led:true,season:s},awayOptions:{leadSurrender:refSuccess,led:true,season:s}
    }));
  }
  return corpusFromObservations(observations,'2026-08-31T12:00:00Z');
}

function pipeline({homeOnly=false, corpus=confirmatoryCorpus({homeOnly})}={}) {
  const {batch,frozen}=setupFreeze({homeOnly});
  const step6=evaluatePatternConfirmatoryOutOfSample({
    freeze:frozen,discoveryBatch:batch,corpus,evaluatedAt:'2026-09-01T00:00:00Z'
  });
  const step7=evaluatePatternTemporalContextStability({
    freeze:frozen,discoveryBatch:batch,step6Evaluation:step6,corpus,evaluatedAt:'2026-09-01T01:00:00Z'
  });
  return {batch,frozen,corpus,step6,step7};
}

test('Step 7 stable synthetic fixture passes temporal/context mechanics but remains zero weight',()=>{
  const {step7}=pipeline();
  assert.equal(PATTERN_TEMPORAL_CONTEXT_STABILITY_VERSION,'PATTERN_TEMPORAL_CONTEXT_STABILITY_V0_1');
  assert.equal(TEMPORAL_WINDOW_N,3);
  assert.equal(STABILITY_MIN_WINDOW_OPPORTUNITY_N,10);
  assert.equal(STABILITY_MIN_WINDOW_CLUSTER_N,10);
  assert.equal(STABILITY_MIN_WINDOW_ORIENTED_EFFECT,0.05);
  const row=step7.pattern_results.find(r=>r.state==='VALIDATED_PATTERN_EVIDENCE_ZERO_WEIGHT');
  assert.ok(row);
  assert.equal(row.temporal_stability.pass,true);
  assert.equal(row.context_stability.venue.pass,true);
  assert.equal(row.context_stability.opponent_diversity.pass,true);
  assert.equal(row.context_stability.season.cross_season_generalization_tested,false);
  assert.equal(row.context_stability.season.scope_limitation,'CROSS_SEASON_GENERALIZATION_NOT_ESTABLISHED');
  assert.equal(row.pattern_validated,true);
  assert.equal(row.decision_weight,0);
  assert.equal(row.additional_alpha_spent,false);
  assert.equal(step7.governance.predictive_weight_assigned,false);
  assert.equal(verifyPatternTemporalContextStability(step7),true);
});

test('Step 7 does not run stability when Step 6 family has not reached confirmatory N',()=>{
  const corpus=confirmatoryCorpus({subjectMatchN:29});
  const {step7}=pipeline({corpus});
  assert.equal(step7.state,'WAITING_FOR_STEP6_OOS_PASS_OR_STABILITY_COVERAGE');
  assert.equal(step7.pattern_results[0].state,'WAITING_FOR_STEP6_FAMILY_TEST');
  assert.equal(step7.pattern_results[0].pattern_validated,false);
  assert.equal(step7.pattern_results[0].decision_weight,0);
});

test('Step 6 OOS rejection is retained and cannot be reopened by Step 7',()=>{
  const corpus=confirmatoryCorpus({subjectSuccess:()=>false});
  const {step6,step7}=pipeline({corpus});
  assert.equal(step6.candidate_results[0].out_of_sample_result,'FAIL');
  assert.equal(step7.pattern_results[0].state,'NOT_ELIGIBLE_STEP6_OOS_REJECTED');
  assert.equal(step7.pattern_results[0].rejected_evidence_retained,true);
  assert.equal(step7.pattern_results[0].pattern_validated,false);
});

test('temporal reversal is rejected even when aggregate Step 6 OOS result passes',()=>{
  const corpus=confirmatoryCorpus({subjectSuccess:(i)=>i<20});
  const {step6,step7}=pipeline({corpus});
  assert.equal(step6.candidate_results[0].out_of_sample_result,'PASS');
  const row=step7.pattern_results[0];
  assert.equal(row.state,'REJECTED_TEMPORAL_STABILITY');
  assert.equal(row.temporal_stability.direction_consistent_all_windows,false);
  assert.equal(row.pattern_validated,false);
});

test('ALL-context pattern is rejected when HOME and AWAY behavior conflicts',()=>{
  const corpus=confirmatoryCorpus({subjectSuccess:(i,alphaHome)=>alphaHome});
  const {step6,step7}=pipeline({corpus});
  assert.equal(step6.candidate_results[0].out_of_sample_result,'PASS');
  const row=step7.pattern_results[0];
  assert.equal(row.temporal_stability.pass,true);
  assert.equal(row.state,'REJECTED_VENUE_CONTEXT_STABILITY');
  const away=row.context_stability.venue.contexts.find(r=>r.context==='AWAY');
  assert.equal(away.direction_consistent,false);
  assert.equal(row.pattern_validated,false);
});

test('opponent concentration blocks stability even with strong temporal effect',()=>{
  const corpus=confirmatoryCorpus({opponent:(i)=>`REPEAT-${i%3}`});
  const {step7}=pipeline({corpus});
  const row=step7.pattern_results[0];
  assert.equal(STABILITY_MIN_UNIQUE_OPPONENT_N,10);
  assert.equal(STABILITY_MAX_OPPONENT_CLUSTER_SHARE,0.20);
  assert.equal(row.temporal_stability.pass,true);
  assert.equal(row.context_stability.opponent_diversity.pass,false);
  assert.equal(row.state,'REJECTED_OPPONENT_DIVERSITY_STABILITY');
});

test('HOME-frozen candidate may validate only inside HOME scope without claiming AWAY generalization',()=>{
  const corpus=confirmatoryCorpus({homeOnly:true});
  const {batch,step6,step7}=pipeline({homeOnly:true,corpus});
  assert.ok(batch.candidate_n>=2);
  assert.ok(step6.candidate_results.every(r=>r.out_of_sample_result==='PASS'));
  const homePlanResult=step7.pattern_results.find(row=>{
    const candidate=batch.candidates.find(c=>c.pattern_id===row.pattern_id);
    return candidate?.scope?.venue_context==='HOME';
  });
  assert.ok(homePlanResult);
  assert.equal(homePlanResult.state,'VALIDATED_PATTERN_EVIDENCE_ZERO_WEIGHT');
  assert.equal(homePlanResult.context_stability.venue.cross_venue_generalization_tested,false);
  assert.equal(homePlanResult.validation_scope.cross_venue_generalized,false);
  assert.equal(homePlanResult.decision_weight,0);
});

test('Step 7 requires exact Step 6 locked corpus and rejects corpus substitution',()=>{
  const {batch,frozen,corpus,step6}=pipeline();
  const substituted=corpusFromObservations([...corpus.observations],'2026-09-01T12:00:00Z');
  assert.notEqual(substituted.corpus_fingerprint,step6.source_corpus_fingerprint);
  assert.throws(()=>evaluatePatternTemporalContextStability({
    freeze:frozen,discoveryBatch:batch,step6Evaluation:step6,corpus:substituted,evaluatedAt:'2026-09-02T00:00:00Z'
  }),/STEP7_CORPUS_MUST_EQUAL_STEP6_LOCKED_CORPUS/);
});

test('tampered Step 7 result fails closed',()=>{
  const {step7}=pipeline();
  const broken=structuredClone(step7);
  broken.pattern_results[0].decision_weight=1;
  assert.throws(()=>verifyPatternTemporalContextStability(broken),/STEP7_STABILITY_FINGERPRINT_INVALID|STEP7_RESULT_FINGERPRINT_INVALID|STEP7_DECISION_WEIGHT_FORBIDDEN/);
});

test('validated stability evidence is visible to EvidenceGraph but still decision ineligible at weight zero',()=>{
  const {step7}=pipeline();
  const row=step7.pattern_results.find(r=>r.pattern_validated===true);
  assert.ok(row);
  const node=patternStabilityEvidenceNode(row);
  const graph=new EvidenceGraph(); graph.add(node);
  assert.equal(node.sourceVerified,true);
  assert.equal(node.patternValidated,true);
  assert.equal(node.temporalContextStable,true);
  assert.equal(node.decisionWeight,0);
  assert.equal(graph.decisionEligible(node.id),false);
});
