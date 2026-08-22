import { compareBookmakerSnapshots } from './bookmaker-comparison.mjs';
import { canonicalize1X2Snapshot } from './provider-odds-adapter.mjs';
import { processTrialEvent } from './trial-processing.mjs';

function validTimestamp(value) {
  return Number.isFinite(Date.parse(value));
}

function modelIsVerified(event) {
  return event?.model?.verified === true
    && Number.isFinite(event.model.homeLambda)
    && event.model.homeLambda >= 0
    && Number.isFinite(event.model.awayLambda)
    && event.model.awayLambda >= 0;
}

function sourceAudit(snapshot) {
  return {
    provider: snapshot.provider,
    observedAt: snapshot.observedAt,
    observedAtSemantic: snapshot.observedAtSemantic ?? 'CAPTURE_TIME',
    sourceType: snapshot.sourceType ?? 'PUBLIC_WEB',
    sourceUrl: snapshot.sourceUrl ?? null,
    sourceFreshness: snapshot.sourceFreshness ?? 'UNSPECIFIED',
    providerGameId: snapshot.providerGameId ?? null,
    rawOdds: snapshot.rawOdds ?? null,
    rawOrder: snapshot.rawOrder ?? null,
    canonicalOdds: snapshot.odds,
    adaptation: snapshot.adaptation
  };
}

function compactMarket(market) {
  return {
    status: market.status,
    reason: market.reason ?? null,
    eventId: market.eventId ?? null,
    marketKey: market.marketKey ?? null,
    providers: market.providers ?? market.rows?.map((row) => row.provider) ?? [],
    consensusFair: market.consensusFair ?? null,
    dispersion: market.dispersion ?? null,
    bestPrice: market.bestPrice ?? null,
    meanOverround: market.meanOverround ?? null,
    overroundGap: market.overroundGap ?? null,
    skewSeconds: market.skewSeconds ?? null,
    hypotheses: market.hypotheses ?? [],
    explanationPolicy: market.explanationPolicy ?? 'HYPOTHESES_NOT_INTERNAL_BOOKMAKER_FACTS'
  };
}

export function processObservedMarketEvent(event, batch, {
  maxSkewSeconds = 120,
  minEdge = 0.05,
  minEvidenceMaturity = 70
} = {}) {
  if (!event?.eventId || !event?.kickoffAt || !event?.marketKey) throw new Error('EVENT_IDENTITY_REQUIRED');
  if (event.marketKey !== '1X2_90M') throw new Error('UNSUPPORTED_MARKET');
  if (!validTimestamp(batch?.capturedAt) || !validTimestamp(event.kickoffAt)) throw new Error('INVALID_TIMESTAMP');

  if (Date.parse(batch.capturedAt) >= Date.parse(event.kickoffAt)) {
    return {
      eventId: event.eventId,
      state: 'REJECTED',
      marketState: 'NOT_EVALUATED',
      reasons: ['CAPTURE_AT_OR_AFTER_KICKOFF'],
      realMoney: 'NO'
    };
  }

  const excludedSnapshots = (event.bookmakerSnapshots ?? [])
    .filter((snapshot) => snapshot.eligibleForConsensus === false)
    .map((snapshot) => ({
      provider: snapshot.provider ?? null,
      reason: snapshot.exclusionReason ?? 'INELIGIBLE_FOR_CONSENSUS',
      sourceUrl: snapshot.sourceUrl ?? null
    }));

  const snapshots = (event.bookmakerSnapshots ?? [])
    .filter((snapshot) => snapshot.eligibleForConsensus !== false)
    .map((snapshot) => canonicalize1X2Snapshot({
      ...snapshot,
      eventId: snapshot.eventId ?? event.eventId,
      marketKey: snapshot.marketKey ?? event.marketKey
    }));

  const market = compareBookmakerSnapshots(snapshots, { maxSkewSeconds });
  const base = {
    eventId: event.eventId,
    league: event.league ?? null,
    homeTeam: event.homeTeam ?? null,
    awayTeam: event.awayTeam ?? null,
    kickoffAt: event.kickoffAt,
    marketKey: event.marketKey,
    sourceObservations: snapshots.map(sourceAudit),
    excludedSnapshots,
    supplementalMarkets: event.supplementalMarkets ?? [],
    bookmakerComparison: compactMarket(market),
    realMoney: 'NO'
  };

  if (market.status === 'BLOCK') {
    return {
      ...base,
      state: 'REJECTED',
      marketState: 'BLOCKED',
      reasons: [market.reason]
    };
  }

  if (market.status === 'WAIT') {
    return {
      ...base,
      state: 'WAIT',
      marketState: 'MARKET_PARTIAL',
      reasons: [market.reason]
    };
  }

  if (!modelIsVerified(event)) {
    return {
      ...base,
      state: 'WAIT',
      marketState: 'MARKET_READY',
      modelState: 'MODEL_INPUT_NOT_VERIFIED',
      reasons: ['MODEL_INPUT_NOT_VERIFIED']
    };
  }

  const predictionResult = processTrialEvent({
    ...event,
    bookmakerSnapshots: snapshots
  }, batch, { maxSkewSeconds, minEdge, minEvidenceMaturity });

  return {
    ...predictionResult,
    marketState: 'MARKET_READY',
    modelState: 'MODEL_VERIFIED',
    sourceObservations: snapshots.map(sourceAudit),
    excludedSnapshots,
    supplementalMarkets: event.supplementalMarkets ?? [],
    dataNature: 'REAL_OBSERVED_MARKET_DATA'
  };
}

export function processObservedMarketBatch(batch, options = {}) {
  if (!batch?.batchId || !batch?.capturedAt || !Array.isArray(batch.events)) {
    throw new Error('OBSERVED_BATCH_IDENTITY_REQUIRED');
  }

  const seen = new Set();
  const events = batch.events.map((event) => {
    if (seen.has(event.eventId)) {
      return {
        eventId: event.eventId,
        state: 'REJECTED',
        marketState: 'NOT_EVALUATED',
        reasons: ['DUPLICATE_EVENT_ID'],
        realMoney: 'NO'
      };
    }
    seen.add(event.eventId);
    try {
      return processObservedMarketEvent(event, batch, options);
    } catch (error) {
      return {
        eventId: event?.eventId ?? null,
        league: event?.league ?? null,
        homeTeam: event?.homeTeam ?? null,
        awayTeam: event?.awayTeam ?? null,
        state: 'REJECTED',
        marketState: 'PROCESSING_ERROR',
        reasons: ['PROCESSING_ERROR'],
        errorCode: error?.message ?? 'UNKNOWN_ERROR',
        realMoney: 'NO'
      };
    }
  });

  const stateCounts = events.reduce((acc, event) => {
    acc[event.state] = (acc[event.state] ?? 0) + 1;
    return acc;
  }, {});

  const marketReady = events.filter((event) => event.marketState === 'MARKET_READY');
  const modelVerified = events.filter((event) => event.modelState === 'MODEL_VERIFIED');
  const qualified = events.filter((event) => event.state === 'QUALIFIED');

  const marketBoard = marketReady.map((event) => ({
    eventId: event.eventId,
    league: event.league,
    match: `${event.homeTeam ?? 'HOME'} vs ${event.awayTeam ?? 'AWAY'}`,
    kickoffAt: event.kickoffAt,
    providers: event.bookmakerComparison.providers,
    consensusFair: event.bookmakerComparison.consensusFair,
    bestPrice: event.bookmakerComparison.bestPrice,
    dispersion: event.bookmakerComparison.dispersion,
    meanOverround: event.bookmakerComparison.meanOverround,
    hypotheses: event.bookmakerComparison.hypotheses,
    modelState: event.modelState ?? 'MODEL_INPUT_NOT_VERIFIED',
    state: event.state
  }));

  return {
    batchId: batch.batchId,
    fixtureNature: batch.fixtureNature ?? 'REAL_OBSERVED_MARKET_DATA',
    capturedAt: batch.capturedAt,
    captureTimezone: batch.captureTimezone ?? null,
    mode: 'REAL_DATA_PAPER_ONLY',
    realMoney: 'NO',
    summary: {
      eventsReceived: batch.events.length,
      states: stateCounts,
      marketReadyEvents: marketReady.length,
      modelVerifiedEvents: modelVerified.length,
      qualifiedSignals: qualified.length
    },
    marketBoard,
    events,
    governance: {
      sourceProvenanceRequired: true,
      explicitRawOddsOrderMapping: true,
      staleOrIneligibleSnapshotsExcludedFromConsensus: true,
      bookmakerSnapshotsDeviggedBeforeConsensus: true,
      marketDerivedModelLeakageForbidden: true,
      modelMustBeIndependentlyVerified: true,
      predictionNotExecution: true,
      capitalLocked: true
    }
  };
}
