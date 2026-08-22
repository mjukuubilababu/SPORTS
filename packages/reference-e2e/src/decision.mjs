import { deepFreeze, id, nowIso } from './utils.mjs';

export function decide(event,pattern,{clock}={}){
  const decision=pattern.passed?'QUALIFIED':'REJECT';
  const failed=[];
  if(!pattern.priceGate)failed.push('PRICE');
  if(!pattern.lambdaGate)failed.push('LAMBDA');
  if(!pattern.edgeGate)failed.push('EDGE');
  if(pattern.lineupGate!=='PASS')failed.push('LINEUP');
  return deepFreeze({
    id:id('dec',[event.id,pattern.id]),
    eventId:event.id,
    patternId:pattern.id,
    decision,
    failedGates:failed,
    createdAt:nowIso(clock)
  });
}

const RANKING_POLICY='EDGE_DESC_THEN_MODEL_PROB_DESC_THEN_KICKOFF_ASC_THEN_EVENT_ID';

function canonicalSignalKey(analysis){
  return `${analysis.event.id}|UNDER_3_5`;
}

function chooseCanonicalObservation(a,b){
  const ta=Date.parse(a.event.observedAt), tb=Date.parse(b.event.observedAt);
  if(ta!==tb) return ta>tb?a:b;
  // Equal event-time observations must not silently disagree. IDs alone are
  // insufficient because artifact identity and artifact content are separate concerns.
  const material=x=>JSON.stringify({
    market:x.event.market,
    lambda:x.prediction.lambda,
    probabilityUnder35:x.prediction.probabilityUnder35,
    priceGate:x.pattern.priceGate,
    lambdaGate:x.pattern.lambdaGate,
    edgeGate:x.pattern.edgeGate,
    lineupGate:x.pattern.lineupGate,
    marketFairUnder35:x.pattern.marketFairUnder35,
    rawEdgePp:x.pattern.rawEdgePp,
    passed:x.pattern.passed,
    decision:x.decision.decision,
    failedGates:x.decision.failedGates
  });
  if(material(a)!==material(b)) throw new Error(`CONFLICTING_DUPLICATE_SIGNAL:${canonicalSignalKey(a)}`);
  return a;
}

export function buildQualifiedSet(analyses,{clock}={}){
  if(!Array.isArray(analyses)) throw new Error('QUALIFIED_SET_REQUIRES_ARRAY');

  const canonical=new Map();
  for(const analysis of analyses){
    if(!analysis?.event || !analysis?.prediction || !analysis?.pattern || !analysis?.decision) throw new Error('INVALID_ANALYSIS_ITEM');
    const key=canonicalSignalKey(analysis);
    canonical.set(key,canonical.has(key)?chooseCanonicalObservation(canonical.get(key),analysis):analysis);
  }

  const canonicalAnalyses=[...canonical.values()].sort((a,b)=>
    Date.parse(a.event.kickoffAt)-Date.parse(b.event.kickoffAt) || a.event.id.localeCompare(b.event.id)
  );

  const qualified=canonicalAnalyses
    .filter(x=>x.decision.decision==='QUALIFIED')
    .sort((a,b)=>
      b.pattern.rawEdgePp-a.pattern.rawEdgePp ||
      b.prediction.probabilityUnder35-a.prediction.probabilityUnder35 ||
      Date.parse(a.event.kickoffAt)-Date.parse(b.event.kickoffAt) ||
      a.event.id.localeCompare(b.event.id)
    )
    .map((x,index)=>deepFreeze({
      rank:index+1,
      signalKey:canonicalSignalKey(x),
      eventId:x.event.id,
      decisionId:x.decision.id,
      patternId:x.pattern.id,
      homeTeam:x.event.homeTeam,
      awayTeam:x.event.awayTeam,
      kickoffAt:x.event.kickoffAt,
      provider:x.event.provider,
      market:'UNDER_3_5',
      offeredPrice:x.event.market.u35,
      modelProbability:x.prediction.probabilityUnder35,
      marketFairProbability:x.pattern.marketFairUnder35,
      rawEdgePp:x.pattern.rawEdgePp,
      lambda:x.prediction.lambda,
      gates:{
        price:x.pattern.priceGate,
        lambda:x.pattern.lambdaGate,
        edge:x.pattern.edgeGate,
        lineup:x.pattern.lineupGate
      },
      status:'QUALIFIED'
    }));

  const decisions=canonicalAnalyses.map(x=>deepFreeze({
    eventId:x.event.id,
    decisionId:x.decision.id,
    homeTeam:x.event.homeTeam,
    awayTeam:x.event.awayTeam,
    status:x.decision.decision,
    failedGates:[...x.decision.failedGates]
  }));

  return deepFreeze({
    id:id('qset',[...[...canonical.keys()].sort(),...qualified.map(x=>x.decisionId)]),
    contractVersion:'QUALIFIED_SIGNAL_SET_V0_1',
    market:'UNDER_3_5',
    analyzedCount:canonicalAnalyses.length,
    qualifiedCount:qualified.length,
    rejectedCount:canonicalAnalyses.length-qualified.length,
    duplicateInputsRemoved:analyses.length-canonicalAnalyses.length,
    rankingPolicy:RANKING_POLICY,
    truncation:'NONE',
    qualificationHistoryImmutable:true,
    qualifiedSignals:qualified,
    decisions,
    createdAt:nowIso(clock)
  });
}
