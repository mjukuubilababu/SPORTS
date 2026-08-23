import { buildBidirectionalMatchReasoning } from './bidirectional-match-reasoning.mjs';
import { rankAvailableMarketSelections, evaluatePricedMarketSelections } from './market-mapping.mjs';

function truthState(truth, { evidenceMaturity, lineupGate, contextRisk }) {
  const probability = truth.probability;
  const counter = truth.counterProbability;
  const strongMath = probability >= 0.70 && counter <= 0.30;
  const mature = evidenceMaturity >= 70;
  const lineupReady = lineupGate === 'PASS';
  const contextReady = contextRisk !== 'HIGH';
  if (strongMath && mature && lineupReady && contextReady) return 'ROBUST_MODEL_TRUTH';
  if (probability >= 0.60) return 'MODEL_LEAN';
  return 'UNCERTAIN';
}

export function buildMatchDecisionUniverse({
  eventId,
  homeTeam,
  awayTeam,
  homeLambda,
  awayLambda,
  evidenceMaturity = 0,
  lineupGate = 'PENDING',
  contextRisk = 'HIGH',
  availableMarketSelections = [],
  pricedMarketSelections = [],
  minDisplayProbability = 0.5,
  minEdge = 0.05
}) {
  const reasoning = buildBidirectionalMatchReasoning({ eventId, homeTeam, awayTeam, homeLambda, awayLambda });
  const truthBoard = reasoning.strongestTruths.map((truth) => Object.freeze({
    ...truth,
    state: truthState(truth, { evidenceMaturity, lineupGate, contextRisk })
  }));
  const marketMapping = rankAvailableMarketSelections(reasoning, availableMarketSelections, {
    minimumProbability: minDisplayProbability
  });
  const pricing = evaluatePricedMarketSelections(reasoning, pricedMarketSelections, { minEdge });
  return Object.freeze({
    engineVersion: 'MATCH_DECISION_UNIVERSE_V0_1',
    eventId,
    teams: Object.freeze({ home: homeTeam, away: awayTeam }),
    analysisOrder: Object.freeze([
      'INDEPENDENT_TEAM_MODEL',
      'TEAM_REALITY_MAP',
      'BIDIRECTIONAL_MATCH_TRUTHS',
      'COUNTER_OUTCOME_PRESSURE',
      'AVAILABLE_MARKET_MAPPING',
      'MARKET_PRICE_AND_EDGE_LAYER',
      'FINAL_GOVERNED_DECISION'
    ]),
    modelContext: Object.freeze({ evidenceMaturity, lineupGate, contextRisk }),
    reasoning,
    truthBoard: Object.freeze(truthBoard),
    strongestRobustTruths: Object.freeze(truthBoard.filter((x) => x.state === 'ROBUST_MODEL_TRUTH')),
    marketMapping,
    pricing,
    governance: Object.freeze({
      analysisBeginsWithTeamsNotBookmakerMarkets: true,
      negativeConclusionsAllowed: true,
      complementMustBeEvaluated: true,
      marketMappingOccursAfterMatchReasoning: true,
      probabilityAndValueAreSeparateRankings: true,
      finalQualificationStillRequiresCanonicalGates: true,
      certaintyMeansReducedUncertaintyNotGuarantee: true
    })
  });
}
