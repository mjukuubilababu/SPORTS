import { attachIndependentVenueModels } from './venue-strength-model.mjs';
import { processObservedMarketEvent } from './real-market-processing.mjs';
import { annotateModelMarketEvent } from './independent-model-processing.mjs';
import {
  prepareFinalPrematchEvent,
  freezeFinalPrematchSnapshot
} from './lineup-final-gate.mjs';

function guardDiagnosticConflict(event) {
  if (event.state !== 'QUALIFIED') return event;
  const conflict = event.modelMarketDiagnostics?.directionConflict === true;
  const largeTransition = event.modelMarketDiagnostics?.highTransitionLargeDivergence === true;
  if (!conflict && !largeTransition) return event;
  const reasons = [...new Set([
    ...(event.reasons ?? []),
    ...(conflict ? ['MODEL_MARKET_DIRECTION_CONFLICT'] : []),
    ...(largeTransition ? ['HIGH_TRANSITION_RISK_LARGE_MARKET_DIVERGENCE'] : [])
  ])];
  return {
    ...event,
    state: 'WATCH',
    reasons,
    gate5SignalDraft: null,
    finalGuard: 'DIAGNOSTIC_CONFLICT_BLOCKS_QUALIFICATION'
  };
}

export function processFinalPrematchEvent({
  baseEvent,
  finalObservation,
  finalCaptureBatch,
  baselineBatchId,
  modelDatasetId,
  options = {}
}) {
  if (!baseEvent) {
    return {
      eventId: finalObservation?.eventId ?? null,
      state: 'REJECTED',
      reasons: ['BASE_EVENT_NOT_FOUND'],
      realMoney: 'NO'
    };
  }

  const prepared = prepareFinalPrematchEvent({
    baseEvent,
    kickoffObservation: finalObservation.kickoffObservation,
    lineupSnapshot: finalObservation.lineupSnapshot,
    latestBookmakerSnapshots: finalObservation.bookmakerSnapshots,
    finalCapturedAt: finalCaptureBatch.capturedAt,
    lineupImpact: finalObservation.lineupImpact ?? null,
    finalContextAssessment: finalObservation.finalContextAssessment ?? null
  });

  if (prepared.terminal) {
    return {
      ...prepared,
      finalSnapshot: freezeFinalPrematchSnapshot({
        result: prepared,
        baselineBatchId,
        modelDatasetId,
        finalCaptureId: finalCaptureBatch.captureId,
        finalCapturedAt: finalCaptureBatch.capturedAt,
        kickoff: prepared.kickoff,
        lineup: null,
        modelAdjustment: null
      })
    };
  }

  const result = processObservedMarketEvent(prepared.event, {
    batchId: finalCaptureBatch.captureId,
    capturedAt: finalCaptureBatch.capturedAt,
    captureTimezone: finalCaptureBatch.captureTimezone ?? null
  }, options);

  const withContext = {
    ...result,
    confirmedLineup: prepared.lineup,
    kickoffObservation: prepared.kickoff,
    finalContext: prepared.finalContext,
    lineupAdjustment: prepared.modelAdjustment,
    dataNature: 'FINAL_PREMATCH_REAL_MARKET_AND_CONFIRMED_LINEUP'
  };
  const annotated = annotateModelMarketEvent(withContext);
  const guarded = guardDiagnosticConflict(annotated);
  const finalSnapshot = freezeFinalPrematchSnapshot({
    result: guarded,
    baselineBatchId,
    modelDatasetId,
    finalCaptureId: finalCaptureBatch.captureId,
    finalCapturedAt: finalCaptureBatch.capturedAt,
    kickoff: prepared.kickoff,
    lineup: prepared.lineup,
    modelAdjustment: prepared.modelAdjustment
  });
  return { ...guarded, finalSnapshot };
}

export function processFinalPrematchBatch(marketBatch, modelDataset, finalCaptureBatch, options = {}) {
  if (!marketBatch?.batchId || !modelDataset?.datasetId) throw new Error('BASE_INPUTS_REQUIRED');
  if (!finalCaptureBatch?.captureId || !finalCaptureBatch?.capturedAt || !Array.isArray(finalCaptureBatch.events)) {
    throw new Error('FINAL_CAPTURE_BATCH_INVALID');
  }

  const enriched = attachIndependentVenueModels(marketBatch, modelDataset);
  const baseByEvent = new Map(enriched.events.map((event) => [event.eventId, event]));
  const seen = new Set();
  const events = finalCaptureBatch.events.map((finalObservation) => {
    if (!finalObservation?.eventId) {
      return { eventId: null, state: 'REJECTED', reasons: ['FINAL_EVENT_ID_REQUIRED'], realMoney: 'NO' };
    }
    if (seen.has(finalObservation.eventId)) {
      return { eventId: finalObservation.eventId, state: 'REJECTED', reasons: ['DUPLICATE_FINAL_EVENT_ID'], realMoney: 'NO' };
    }
    seen.add(finalObservation.eventId);
    try {
      return processFinalPrematchEvent({
        baseEvent: baseByEvent.get(finalObservation.eventId),
        finalObservation,
        finalCaptureBatch,
        baselineBatchId: marketBatch.batchId,
        modelDatasetId: modelDataset.datasetId,
        options
      });
    } catch (error) {
      return {
        eventId: finalObservation.eventId,
        state: 'REJECTED',
        reasons: ['FINAL_PREMATCH_PROCESSING_ERROR'],
        errorCode: error?.message ?? 'UNKNOWN_ERROR',
        realMoney: 'NO'
      };
    }
  });

  const states = events.reduce((acc, event) => {
    acc[event.state] = (acc[event.state] ?? 0) + 1;
    return acc;
  }, {});
  const qualified = events.filter((event) => event.state === 'QUALIFIED');
  const lineupConfirmed = events.filter((event) => event.confirmedLineup?.status === 'CONFIRMED').length;
  const adjustedModels = events.filter((event) => event.lineupAdjustment?.adjustmentApplied === true).length;

  return {
    captureId: finalCaptureBatch.captureId,
    baselineBatchId: marketBatch.batchId,
    modelDatasetId: modelDataset.datasetId,
    capturedAt: finalCaptureBatch.capturedAt,
    mode: 'FINAL_PREMATCH_PAPER_ONLY',
    realMoney: 'NO',
    summary: {
      eventsReceived: finalCaptureBatch.events.length,
      states,
      confirmedLineups: lineupConfirmed,
      lineupAdjustedModels: adjustedModels,
      qualifiedSignals: qualified.length,
      finalSnapshots: events.filter((event) => event.finalSnapshot).length
    },
    events,
    finalSnapshots: events.filter((event) => event.finalSnapshot).map((event) => event.finalSnapshot),
    gate5SignalDrafts: qualified.map((event) => event.gate5SignalDraft).filter(Boolean),
    governance: {
      kickoffSourceMustBeVerified: true,
      confirmedStartingXIRequired: true,
      exactlyElevenUniqueStartersPerTeam: true,
      lineupBeforeEffectiveKickoffRequired: true,
      latestMultiBookmakerSnapshotRequired: true,
      lineupDoesNotSilentlyRewriteLambda: true,
      verifiedLineupImpactRequiredForLambdaAdjustment: true,
      finalContextProvenanceRequiredToChangeEvidenceMaturity: true,
      modelMarketDirectionConflictBlocksQualification: true,
      previousSnapshotsRemainImmutable: true,
      noHindsight: true,
      predictionNotExecution: true,
      capitalLocked: true
    }
  };
}
