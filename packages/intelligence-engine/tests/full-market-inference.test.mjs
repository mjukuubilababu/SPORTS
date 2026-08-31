import test from 'node:test';import assert from 'node:assert/strict';
import {appendMarketObservation,buildFullMarketInference,buildIndependentTeamState,buildMarketConsistencyGraph,buildMatchupAudit,buildMatchWorlds,devigMarketObservations,recomputeJointSelection,settleSystemSignalAndUserExecution} from '../src/full-market-inference.mjs';
import {buildScoreDistribution} from '../src/bidirectional-match-reasoning.mjs';

const frozenAt='2026-08-31T10:00:00Z',kickoffAt='2026-08-31T12:00:00Z';
function state(teamId,{n=12,xi=.9,current={attack:.7,defence:.6,playerQuality:.7,teamQuality:.7,teamCohesion:.7,tacticalQuality:.7}}={}){
 return buildIndependentTeamState({teamId,asOf:frozenAt,currentSeasonSample:n,previousSeason:{attack:.6,defence:.6,playerQuality:.6,teamQuality:.6,teamCohesion:.6,tacticalQuality:.6},currentSeason:current,xiConfidence:xi,evidence:[{source:'gate1',observedAt:'2026-08-31T09:00:00Z',verified:true,type:'FORM'}]});
}
function obs({id,family,selection,line=null,odds,group,source='provider'}){
 return {observationId:id,marketGroupId:group,completeMarket:true,marketFamily:family,selection,line,odds,provider:'BetPawa',source,observedAt:'2026-08-31T09:30:00Z',marketSnapshotId:'snap-1'};
}
function base(overrides={}){
 const observations=[
  obs({id:'h',family:'1X2_FULL_TIME',selection:'HOME',odds:1.45,group:'1x2'}),
  obs({id:'d',family:'1X2_FULL_TIME',selection:'DRAW',odds:4.5,group:'1x2'}),
  obs({id:'a',family:'1X2_FULL_TIME',selection:'AWAY',odds:8,group:'1x2'}),
  obs({id:'o35',family:'TOTAL_GOALS_OVER_UNDER_FULL_TIME',selection:'OVER',line:3.5,odds:2.4,group:'t35'}),
  obs({id:'u35',family:'TOTAL_GOALS_OVER_UNDER_FULL_TIME',selection:'UNDER',line:3.5,odds:1.6,group:'t35'})
 ];
 return {eventId:'event-1',analysisTimestamp:'2026-08-31T09:55:00Z',kickoffAt,homeTeam:'Home',awayTeam:'Away',homeLambda:1.65,awayLambda:.75,
  teamAState:state('home'),teamBState:state('away'),marketObservations:observations,marketSelections:[
   {marketFamily:'1X2_FULL_TIME',selection:'HOME'},{marketFamily:'1X2_FULL_TIME',selection:'AWAY'},
   {marketFamily:'TOTAL_GOALS_OVER_UNDER_FULL_TIME',selection:'UNDER',line:3.5},{marketFamily:'CORNERS',selection:'OVER',line:10.5}],
  modelVersion:'model-v1',featureVersion:'feature-v1',marketSnapshotId:'snap-1',frozenAt,modelConfidence:.9,...overrides};
}

test('lowest odds do not automatically become PRIMARY and strong favourite can reject',()=>{const out=buildFullMarketInference(base());assert.notEqual(out.primary_candidate?.marketFamily,'1X2_FULL_TIME');const home=out.candidate_outcomes.find(x=>x.marketFamily==='1X2_FULL_TIME'&&x.selection==='HOME');assert.match(home.classification,/ABSTAIN/);});
test('underdog can become candidate when distribution beats fair market',()=>{const b=base({homeLambda:1.05,awayLambda:1.25});b.marketObservations=b.marketObservations.map(x=>x.observationId==='a'?{...x,odds:6}:x);const out=buildFullMarketInference(b);const away=out.candidate_outcomes.find(x=>x.selection==='AWAY');assert.ok(away.edge>0);assert.equal(away.classification,'CANDIDATE');});
test('possession alone cannot imply control',()=>{const audit=buildMatchupAudit(state('a'),state('b'),{POSSESSION_QUALITY:{differential:.8,confidence:.9,source:'stats',observedAt:frozenAt}});assert.equal(audit.possession_quality_not_control,true);assert.equal(audit.concepts.TACTICAL_AMPLIFICATION.status,'UNKNOWN');});
test('early-season low N exposes weights, penalty and uncertainty',()=>{const x=state('early',{n:2});assert.equal(x.sample_size,2);assert.ok(x.prior_weight>x.current_season_weight);assert.ok(x.early_season_penalty>state('mature').early_season_penalty);assert.ok(x.state_uncertainty>0);});
test('O2.5 short plus expensive BTTS emits asymmetric scoring contradiction',()=>{const rows=devigMarketObservations([
 obs({id:'o25',family:'TOTAL_GOALS_OVER_UNDER_FULL_TIME',selection:'OVER',line:2.5,odds:1.35,group:'t25'}),
 obs({id:'u25',family:'TOTAL_GOALS_OVER_UNDER_FULL_TIME',selection:'UNDER',line:2.5,odds:3.8,group:'t25'}),
 obs({id:'by',family:'BTTS_FULL_TIME',selection:'YES',odds:2.4,group:'btts'}),
 obs({id:'bn',family:'BTTS_FULL_TIME',selection:'NO',odds:1.55,group:'btts'})],frozenAt,kickoffAt);const graph=buildMarketConsistencyGraph(rows);assert.equal(graph.edges[0].contradiction_type,'TOTAL_HIGH_BTTS_LOW');assert.ok(graph.edges[0].possible_explanations.includes('ASYMMETRIC_SCORING_EXPECTATION'));assert.equal(graph.trap_claim_made,false);});
test('related home win and team-total markets generate contradiction',()=>{const rows=devigMarketObservations([
 obs({id:'h',family:'1X2_FULL_TIME',selection:'HOME',odds:1.2,group:'x'}),obs({id:'d',family:'1X2_FULL_TIME',selection:'DRAW',odds:7,group:'x'}),obs({id:'a',family:'1X2_FULL_TIME',selection:'AWAY',odds:14,group:'x'}),
 obs({id:'ho',family:'HOME_TEAM_OVER_UNDER_FULL_TIME',selection:'OVER',line:1.5,odds:2.3,group:'ht'}),obs({id:'hu',family:'HOME_TEAM_OVER_UNDER_FULL_TIME',selection:'UNDER',line:1.5,odds:1.6,group:'ht'})],frozenAt,kickoffAt);assert.ok(buildMarketConsistencyGraph(rows).edges.some(x=>x.contradiction_type==='HOME_WIN_VS_HOME_SCORING'));});
test('strong Under plus weak Home does not imply strong joint selection',()=>{const dist=buildScoreDistribution({homeLambda:1.1,awayLambda:.9});const joint=recomputeJointSelection(dist,[{marketFamily:'1X2_FULL_TIME',selection:'HOME'},{marketFamily:'TOTAL_GOALS_OVER_UNDER_FULL_TIME',selection:'UNDER',line:3.5}],{jointOdds:2});assert.equal(joint.status,'MODELLED');assert.ok(joint.joint_probability<joint.component_probabilities[1]);assert.notEqual(joint.joint_probability,joint.component_probabilities[0]*joint.component_probabilities[1]);});
test('user execution loss does not rewrite successful system signal',()=>{const signal=Object.freeze({immutable:true,signal_id:'s1',marketFamily:'TOTAL_GOALS_OVER_UNDER_FULL_TIME',selection:'UNDER',line:3.5});const settled=settleSystemSignalAndUserExecution({systemSignal:signal,userExecution:{execution_id:'u1',components:[{marketFamily:'1X2_FULL_TIME',selection:'HOME'},{marketFamily:'TOTAL_GOALS_OVER_UNDER_FULL_TIME',selection:'UNDER',line:3.5}]},homeScore:0,awayScore:1,settledAt:'2026-08-31T14:00:00Z'});assert.equal(settled.system_signal.result,'WIN');assert.equal(settled.user_execution.result,'LOSS');});
test('unsupported market returns UNSUPPORTED without probability',()=>{const row=buildFullMarketInference(base()).candidate_outcomes.find(x=>x.marketFamily==='CORNERS');assert.equal(row.classification,'UNSUPPORTED');assert.equal(row.model_probability,null);});
test('missing market provenance blocks candidate promotion',()=>{const b=base();b.marketObservations=b.marketObservations.map(x=>x.observationId==='u35'?{...x,source:null}:x);const out=buildFullMarketInference(b);const row=out.candidate_outcomes.find(x=>x.selection==='UNDER');assert.equal(row.classification,'ABSTAIN_MISSING_PROVENANCE');assert.ok(out.abstain_reasons.includes('MARKET_PROVENANCE_MISSING'));});
test('uncertain XI reduces confidence',()=>{const mature=buildFullMarketInference(base());const uncertain=buildFullMarketInference(base({teamAState:state('home',{xi:.4}),teamBState:state('away',{xi:.4})}));const key=x=>x.candidate_outcomes.find(r=>r.selection==='UNDER').confidence;assert.ok(key(uncertain)<key(mature));});
test('post-kickoff evidence cannot mutate frozen signal',()=>{const out=buildFullMarketInference(base());assert.ok(Object.isFrozen(out));assert.throws(()=>{out.home_probability=.99},TypeError);const b=base();b.marketObservations=[{...b.marketObservations[0],observedAt:'2026-08-31T10:01:00Z'}];assert.throws(()=>buildFullMarketInference(b),/AFTER_FREEZE/);});
test('market movement appends a new observation without mutating history',()=>{const history=appendMarketObservation([],{observationId:'m1',odds:2,observedAt:'2026-08-31T09:00:00Z'});const next=appendMarketObservation(history,{observationId:'m2',odds:1.8,observedAt:'2026-08-31T09:30:00Z'});assert.equal(history.length,1);assert.equal(next.length,2);assert.ok(Object.isFrozen(history[0]));});
test('candidate ranking is deterministic for identical frozen inputs',()=>{const a=buildFullMarketInference(base()),b=buildFullMarketInference(base());assert.equal(a.fingerprint,b.fingerprint);assert.deepEqual(a.candidate_outcomes.map(x=>[x.marketFamily,x.selection,x.tier]),b.candidate_outcomes.map(x=>[x.marketFamily,x.selection,x.tier]));});
test('match worlds form a coherent exhaustive partition',()=>{const worlds=buildMatchWorlds(buildScoreDistribution({homeLambda:1.4,awayLambda:1.1}));assert.ok(Math.abs(worlds.reduce((s,x)=>s+x.probability,0)-1)<1e-9);assert.ok(worlds.every(x=>x.score_family.length>0));});

test('de-vig isolates provider and snapshot observations sharing a market group id',()=>{const rows=devigMarketObservations([
 {...obs({id:'p1h',family:'1X2_FULL_TIME',selection:'HOME',odds:2,group:'shared'}),provider:'P1',marketSnapshotId:'s1'},
 {...obs({id:'p1a',family:'1X2_FULL_TIME',selection:'AWAY',odds:2,group:'shared'}),provider:'P1',marketSnapshotId:'s1'},
 {...obs({id:'p2h',family:'1X2_FULL_TIME',selection:'HOME',odds:4,group:'shared'}),provider:'P2',marketSnapshotId:'s2'},
 {...obs({id:'p2a',family:'1X2_FULL_TIME',selection:'AWAY',odds:4/3,group:'shared'}),provider:'P2',marketSnapshotId:'s2'}
],frozenAt,kickoffAt);const sum=provider=>rows.filter(x=>x.provider===provider).reduce((s,x)=>s+x.market_fair_probability,0);assert.ok(Math.abs(sum('P1')-1)<1e-12);assert.ok(Math.abs(sum('P2')-1)<1e-12);assert.equal(rows.find(x=>x.observationId==='p1h').market_fair_probability,.5);assert.equal(rows.find(x=>x.observationId==='p2h').market_fair_probability,.25);});
test('team-state completeness counts missing required quality dimensions',()=>{const x=buildIndependentTeamState({teamId:'sparse',asOf:frozenAt,currentSeasonSample:4,previousSeason:{attack:.6},currentSeason:{attack:.7},xiConfidence:.8,evidence:[{source:'gate1',observedAt:'2026-08-31T09:00:00Z',verified:true,type:'FORM'}]});assert.equal(x.data_completeness,.2);assert.equal(x.quality_separation.PLAYER_QUALITY,null);assert.equal(x.quality_separation.TACTICAL_QUALITY,null);});
test('score-derived multigoals and any exact correct score remain modelled',()=>{const b=base({marketSelections:[{marketFamily:'MULTIGOALS_FULL_TIME',selection:'2-4'},{marketFamily:'CORRECT_SCORE_FULL_TIME',selection:'4-2'}]});b.marketObservations=[
 obs({id:'mg',family:'MULTIGOALS_FULL_TIME',selection:'2-4',odds:1.9,group:'mg'}),
 obs({id:'cs',family:'CORRECT_SCORE_FULL_TIME',selection:'4-2',odds:30,group:'cs'})
];const out=buildFullMarketInference(b);for(const row of out.candidate_outcomes){assert.notEqual(row.classification,'UNSUPPORTED');assert.ok(Number.isFinite(row.model_probability));assert.ok(row.model_probability>0);}});
test('integer totals preserve PUSH mass in joints and settlement',()=>{const dist=buildScoreDistribution({homeLambda:1.2,awayLambda:.8});const joint=recomputeJointSelection(dist,[{marketFamily:'1X2_FULL_TIME',selection:'HOME'},{marketFamily:'TOTAL_GOALS_OVER_UNDER_FULL_TIME',selection:'UNDER',line:2}],{jointOdds:2.5});assert.equal(joint.status,'MODELLED');assert.ok(joint.joint_push_probability>0);const signal=Object.freeze({immutable:true,signal_id:'push-1',marketFamily:'TOTAL_GOALS_OVER_UNDER_FULL_TIME',selection:'UNDER',line:2});const settled=settleSystemSignalAndUserExecution({systemSignal:signal,homeScore:1,awayScore:1,settledAt:'2026-08-31T14:00:00Z'});assert.equal(settled.system_signal.components[0].status,'PUSH');assert.equal(settled.system_signal.result,'PUSH');});
