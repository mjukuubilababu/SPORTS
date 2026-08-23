import { buildBidirectionalMatchReasoning } from './bidirectional-match-reasoning.mjs';
import { deriveHalfSpecificLambdas } from './half-specific-model.mjs';
import { buildHalfSpecificReasoning } from './half-specific-reasoning.mjs';
import { rankAvailableMarketSelections, evaluatePricedMarketSelections } from './market-mapping.mjs';
import { buildTeamMatchIntelligence } from './team-match-intelligence.mjs';
import { applyCalibratedTeamIntelligence } from './calibrated-intelligence-adjustment.mjs';

function truthState(truth, { evidenceMaturity, lineupGate, contextRisk, intelligenceState = null }) {
  const probability = truth.probability;
  const counter = truth.counterProbability;
  const strongMath = probability >= 0.70 && counter <= 0.30;
  const mature = evidenceMaturity >= 70;
  const lineupReady = lineupGate === 'PASS';
  const contextReady = contextRisk !== 'HIGH';
  const intelligenceReady = intelligenceState === null || intelligenceState === 'ANALYSIS_MATURE';
  if (strongMath && mature && lineupReady && contextReady && intelligenceReady) return 'ROBUST_MODEL_TRUTH';
  if (probability >= 0.60) return 'MODEL_LEAN';
  return 'UNCERTAIN';
}

function tagHalfTruths(reasoning, period, context) {
  return reasoning.strongestTruths.map((truth) => Object.freeze({
    ...truth,
    period,
    state: truthState(truth, context)
  }));
}

function crossHalfTruthBoard(halfReasoning, context) {
  if (!halfReasoning) return [];
  const c = halfReasoning.crossHalf;
  const rows = [
    ['HOME_WIN_EITHER_HALF', `${halfReasoning.homeTeam} WIN EITHER HALF`, c.homeWinEitherHalf],
    ['AWAY_WIN_EITHER_HALF', `${halfReasoning.awayTeam} WIN EITHER HALF`, c.awayWinEitherHalf],
    ['HOME_WIN_BOTH_HALVES', `${halfReasoning.homeTeam} WIN BOTH HALVES`, c.homeWinBothHalves],
    ['AWAY_WIN_BOTH_HALVES', `${halfReasoning.awayTeam} WIN BOTH HALVES`, c.awayWinBothHalves]
  ];
  return rows.map(([pairId, conclusion, probability]) => {
    const counterProbability = 1 - probability;
    return Object.freeze({
      pairId,
      family: 'CROSS_HALF',
      period: 'CROSS_HALF',
      conclusion: probability >= counterProbability ? conclusion : `NOT (${conclusion})`,
      probability: Math.max(probability, counterProbability),
      counterProbability: Math.min(probability, counterProbability),
      rawAffirmativeProbability: probability,
      state: truthState({
        probability: Math.max(probability, counterProbability),
        counterProbability: Math.min(probability, counterProbability)
      }, context)
    });
  });
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
  teamIntelligenceFeatureSet = null,
  teamIntelligenceSignals = null,
  teamIntelligenceAsOf = null,
  teamIntelligenceOptions = {},
  intelligenceCalibration = null,
  halfProfile = null,
  minimumHalfProfileSample = 30,
  availableMarketSelections = [],
  pricedMarketSelections = [],
  minDisplayProbability = 0.5,
  minEdge = 0.05
}) {
  let teamIntelligence = null;
  let intelligenceAdjustment = null;
  if (teamIntelligenceFeatureSet || teamIntelligenceSignals) {
    teamIntelligence = buildTeamMatchIntelligence({
      eventId,
      homeTeam,
      awayTeam,
      asOf: teamIntelligenceAsOf,
      featureSet: teamIntelligenceFeatureSet,
      signals: teamIntelligenceSignals,
      ...teamIntelligenceOptions
    });
    intelligenceAdjustment = applyCalibratedTeamIntelligence({
      homeLambda,
      awayLambda,
      intelligence: teamIntelligence,
      calibration: intelligenceCalibration
    });
  }

  const effectiveHomeLambda = intelligenceAdjustment?.adjustmentApplied
    ? intelligenceAdjustment.adjusted.homeLambda
    : homeLambda;
  const effectiveAwayLambda = intelligenceAdjustment?.adjustmentApplied
    ? intelligenceAdjustment.adjusted.awayLambda
    : awayLambda;
  const context = {
    evidenceMaturity,
    lineupGate,
    contextRisk,
    intelligenceState: teamIntelligence?.state ?? null
  };
  const reasoning = buildBidirectionalMatchReasoning({
    eventId,
    homeTeam,
    awayTeam,
    homeLambda: effectiveHomeLambda,
    awayLambda: effectiveAwayLambda
  });
  const truthBoard = reasoning.strongestTruths.map((truth) => Object.freeze({
    ...truth,
    state: truthState(truth, context)
  }));

  let halfModel = null;
  let halfReasoning = null;
  if (halfProfile) {
    halfModel = deriveHalfSpecificLambdas({
      fullTimeHomeLambda: effectiveHomeLambda,
      fullTimeAwayLambda: effectiveAwayLambda,
      halfProfile,
      minimumSample: minimumHalfProfileSample
    });
    if (halfModel.verified) {
      halfReasoning = buildHalfSpecificReasoning({ eventId, homeTeam, awayTeam, halfModel });
    }
  }

  const halfTruthBoard = halfReasoning
    ? Object.freeze([
        ...tagHalfTruths(halfReasoning.firstHalf, 'FIRST_HALF', context),
        ...tagHalfTruths(halfReasoning.secondHalf, 'SECOND_HALF', context),
        ...crossHalfTruthBoard(halfReasoning, context)
      ].sort((a, b) => b.probability - a.probability))
    : Object.freeze([]);

  const marketMapping = rankAvailableMarketSelections(reasoning, availableMarketSelections, {
    minimumProbability: minDisplayProbability,
    halfReasoning
  });
  const pricing = evaluatePricedMarketSelections(reasoning, pricedMarketSelections, { minEdge, halfReasoning });

  return Object.freeze({
    engineVersion: 'MATCH_DECISION_UNIVERSE_V0_3_TEAM_INTELLIGENCE',
    eventId,
    teams: Object.freeze({ home: homeTeam, away: awayTeam }),
    analysisOrder: Object.freeze([
      'INDEPENDENT_TEAM_MODEL',
      'TEAM_MATCH_INTELLIGENCE',
      'COUNTER_EVIDENCE_AND_CORRELATION_CONTROL',
      'CALIBRATED_LAMBDA_ADJUSTMENT_IF_VERIFIED',
      'TEAM_REALITY_MAP',
      'BIDIRECTIONAL_MATCH_TRUTHS',
      'COUNTER_OUTCOME_PRESSURE',
      'VERIFIED_HALF_PROFILE_IF_AVAILABLE',
      'HALF_SPECIFIC_REALITY_MAP',
      'AVAILABLE_MARKET_MAPPING',
      'MARKET_PRICE_AND_EDGE_LAYER',
      'FINAL_GOVERNED_DECISION'
    ]),
    modelContext: Object.freeze({
      evidenceMaturity,
      lineupGate,
      contextRisk,
      intelligenceState: teamIntelligence?.state ?? 'NOT_PROVIDED'
    }),
    baselineModel: Object.freeze({ homeLambda, awayLambda }),
    effectiveModel: Object.freeze({ homeLambda: effectiveHomeLambda, awayLambda: effectiveAwayLambda }),
    teamIntelligence,
    intelligenceAdjustment,
    reasoning,
    truthBoard: Object.freeze(truthBoard),
    strongestRobustTruths: Object.freeze(truthBoard.filter((x) => x.state === 'ROBUST_MODEL_TRUTH')),
    halfModel,
    halfModelState: !halfProfile ? 'NOT_PROVIDED' : (halfModel?.verified ? 'VERIFIED' : 'NOT_VERIFIED'),
    halfReasoning,
    halfTruthBoard,
    strongestRobustHalfTruths: Object.freeze(halfTruthBoard.filter((x) => x.state === 'ROBUST_MODEL_TRUTH')),
    marketMapping,
    pricing,
    governance: Object.freeze({
      analysisBeginsWithTeamsNotBookmakerMarkets: true,
      playerTeamTransferAttackDefenceTemporalLeagueShotVenueH2HPatternsSupported: true,
      positiveAndNegativeFootballEvidencePreserved: true,
      correlatedSignalsCannotCreateArtificialConfidence: true,
      unverifiedOrStaleFootballEvidenceCannotAdjustModel: true,
      uncalibratedTeamIntelligenceCannotRewriteLambda: true,
      negativeConclusionsAllowed: true,
      complementMustBeEvaluated: true,
      marketMappingOccursAfterMatchReasoning: true,
      probabilityAndValueAreSeparateRankings: true,
      halfMarketsRequireIndependentVerifiedHalfProfile: true,
      fullTimeLambdaNotBlindlySplitAcrossHalves: true,
      finalQualificationStillRequiresCanonicalGates: true,
      certaintyMeansReducedUncertaintyNotGuarantee: true
    })
  });
}
