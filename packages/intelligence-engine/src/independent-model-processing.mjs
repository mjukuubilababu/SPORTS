import { attachIndependentVenueModels } from './venue-strength-model.mjs';
import { processObservedMarketBatch } from './real-market-processing.mjs';

const OUTCOME_TO_MARKET = Object.freeze({
  HOME_WIN: 'HOME',
  DRAW: 'DRAW',
  AWAY_WIN: 'AWAY'
});

function topSelection(probabilities) {
  if (!probabilities) return null;
  return Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function annotateModelMarketEvent(event) {
  if (event.modelState !== 'MODEL_VERIFIED' || !event.prediction) return event;
  const modelTopSelection = OUTCOME_TO_MARKET[event.prediction.predictedOutcome] ?? null;
  const marketTopSelection = topSelection(event.bookmakerComparison?.consensusFair);
  const directionConflict = Boolean(modelTopSelection && marketTopSelection && modelTopSelection !== marketTopSelection);
  const absEdge = Number.isFinite(event.edge) ? Math.abs(event.edge) : null;
  const highTransitionLargeDivergence = event.modelContext?.contextRisk === 'HIGH'
    && absEdge !== null
    && absEdge >= 0.10;
  const extraReasons = [];
  if (directionConflict) extraReasons.push('MODEL_MARKET_DIRECTION_CONFLICT');
  if (highTransitionLargeDivergence) extraReasons.push('HIGH_TRANSITION_RISK_LARGE_MARKET_DIVERGENCE');
  return {
    ...event,
    reasons: [...new Set([...(event.reasons ?? []), ...extraReasons])],
    modelMarketDiagnostics: {
      modelTopSelection,
      marketTopSelection,
      directionConflict,
      absoluteEdgePp: absEdge === null ? null : absEdge * 100,
      highTransitionLargeDivergence,
      policy: 'DIAGNOSTIC_ONLY_NO_AUTOMATIC_LAMBDA_REWRITE'
    }
  };
}

export function processIndependentModelMarketBatch(marketBatch, modelDataset, options = {}) {
  const enrichedBatch = attachIndependentVenueModels(marketBatch, modelDataset);
  const baseReport = processObservedMarketBatch(enrichedBatch, options);
  const events = baseReport.events.map(annotateModelMarketEvent);
  const modelBoard = events
    .filter((event) => event.modelState === 'MODEL_VERIFIED')
    .map((event) => ({
      eventId: event.eventId,
      match: `${event.homeTeam} vs ${event.awayTeam}`,
      state: event.state,
      reasons: event.reasons,
      homeLambda: event.prediction.homeLambda,
      awayLambda: event.prediction.awayLambda,
      expectedTotalGoals: event.prediction.expectedTotalGoals,
      probabilities: event.prediction.probabilities,
      predictedOutcome: event.prediction.predictedOutcome,
      marketConsensus: event.bookmakerComparison.consensusFair,
      bestPrice: event.bestPrice,
      edgePp: event.edgePp,
      ev: event.ev,
      evidenceMaturity: event.evidenceMaturity,
      lineupGate: event.lineupGate,
      contextRisk: event.modelContext?.contextRisk ?? null,
      diagnostics: event.modelMarketDiagnostics
    }));
  const directionConflicts = modelBoard.filter((row) => row.diagnostics?.directionConflict).length;
  const highTransitionLargeDivergences = modelBoard.filter((row) => row.diagnostics?.highTransitionLargeDivergence).length;
  return {
    ...baseReport,
    events,
    modelDatasetId: modelDataset.datasetId,
    modelDataNature: modelDataset.dataNature,
    summary: {
      ...baseReport.summary,
      directionConflicts,
      highTransitionLargeDivergences
    },
    modelBoard,
    governance: {
      ...baseReport.governance,
      bookmakerOddsExcludedFromModelInputs: true,
      previousSeasonBaselineOnly: true,
      contextRiskCapsEvidenceMaturity: true,
      lineupConfirmationStillRequired: true,
      largeDivergenceIsDiagnosticNotAutoRetune: true
    }
  };
}
