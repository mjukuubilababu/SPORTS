import { predict1X2 } from './outcome-1x2.mjs';
import { compareBookmakerSnapshots } from './bookmaker-comparison.mjs';
import { buildPaperCombinations } from './paper-combination.mjs';

const OUTCOME_TO_MARKET = Object.freeze({
  HOME_WIN: 'HOME',
  DRAW: 'DRAW',
  AWAY_WIN: 'AWAY'
});

const OUTCOME_TO_PROBABILITY = Object.freeze({
  HOME_WIN: 'homeWin',
  DRAW: 'draw',
  AWAY_WIN: 'awayWin'
});

function validTimestamp(value) {
  return Number.isFinite(Date.parse(value));
}

function gate5QuoteType(market, provider) {
  return market.rows.find((row) => row.provider === provider)?.sourceType ?? 'UNKNOWN';
}

export function buildGate5SignalDraft({
  event,
  batch,
  prediction,
  market,
  selectionKey,
  modelProbability,
  marketFairProbability,
  bestPrice,
  edge
}) {
  return {
    match_id: event.eventId,
    pattern_id: 'P1X2_TRIAL_OPERATIONAL_V0_1',
    created_at: batch.capturedAt,
    kickoff_at: event.kickoffAt,
    selection: prediction.predictedOutcome,
    model_prob: modelProbability,
    market_prob: marketFairProbability,
    reference_odds: bestPrice.odds,
    lambda_total: prediction.expectedTotalGoals,
    raw_edge_pp: edge * 100,
    lineup_gate: event.lineupGate,
    quote_source: bestPrice.provider,
    quote_type: gate5QuoteType(market, bestPrice.provider),
    rule_version: 'TRIAL_1X2_OPERATIONAL_V0.1',
    metadata: {
      batch_id: batch.batchId,
      league: event.league ?? null,
      home_team: event.homeTeam ?? null,
      away_team: event.awayTeam ?? null,
      market_key: event.marketKey,
      market_selection: selectionKey,
      evidence_maturity: event.evidenceMaturity,
      bookmaker_providers: market.providers,
      bookmaker_status: market.status,
      real_money: 'NO'
    }
  };
}

export function processTrialEvent(event, batch, {
  minEdge = 0.05,
  minEvidenceMaturity = 70,
  maxSkewSeconds = 120
} = {}) {
  if (!event?.eventId || !event?.kickoffAt) throw new Error('EVENT_IDENTITY_REQUIRED');
  if (event.marketKey !== '1X2_90M') throw new Error('UNSUPPORTED_MARKET');
  if (!validTimestamp(batch.capturedAt) || !validTimestamp(event.kickoffAt)) throw new Error('INVALID_TIMESTAMP');
  if (Date.parse(batch.capturedAt) >= Date.parse(event.kickoffAt)) {
    return {
      eventId: event.eventId,
      league: event.league ?? null,
      homeTeam: event.homeTeam ?? null,
      awayTeam: event.awayTeam ?? null,
      state: 'REJECTED',
      reasons: ['CAPTURE_AT_OR_AFTER_KICKOFF'],
      realMoney: 'NO'
    };
  }

  const prediction = predict1X2({
    homeLambda: event.model?.homeLambda,
    awayLambda: event.model?.awayLambda,
    maxGoals: event.model?.maxGoals ?? 12
  });

  const snapshots = (event.bookmakerSnapshots ?? []).map((snapshot) => ({
    ...snapshot,
    eventId: snapshot.eventId ?? event.eventId,
    marketKey: snapshot.marketKey ?? event.marketKey
  }));
  const market = compareBookmakerSnapshots(snapshots, { maxSkewSeconds });

  if (market.status === 'WAIT') {
    return {
      eventId: event.eventId,
      league: event.league ?? null,
      homeTeam: event.homeTeam ?? null,
      awayTeam: event.awayTeam ?? null,
      state: 'WAIT',
      reasons: [market.reason],
      prediction,
      bookmakerComparison: market,
      realMoney: 'NO'
    };
  }

  if (market.status === 'BLOCK') {
    return {
      eventId: event.eventId,
      league: event.league ?? null,
      homeTeam: event.homeTeam ?? null,
      awayTeam: event.awayTeam ?? null,
      state: 'REJECTED',
      reasons: [market.reason],
      prediction,
      bookmakerComparison: market,
      realMoney: 'NO'
    };
  }

  const selectionKey = OUTCOME_TO_MARKET[prediction.predictedOutcome];
  const probabilityKey = OUTCOME_TO_PROBABILITY[prediction.predictedOutcome];
  const modelProbability = prediction.probabilities[probabilityKey];
  const marketFairProbability = market.consensusFair[selectionKey];
  const bestPrice = market.bestPrice[selectionKey];

  if (!Number.isFinite(marketFairProbability) || !(bestPrice?.odds > 1)) {
    throw new Error('TARGET_SELECTION_MARKET_DATA_INVALID');
  }

  const edge = modelProbability - marketFairProbability;
  const ev = modelProbability * bestPrice.odds - 1;
  const reasons = [];

  if (market.status !== 'PASS') reasons.push('BOOKMAKER_DISAGREEMENT_WATCH');
  if ((event.evidenceMaturity ?? 0) < minEvidenceMaturity) reasons.push('EVIDENCE_TOO_WEAK');
  if (event.lineupGate !== 'PASS') reasons.push('LINEUP_GATE_NOT_PASS');
  if (edge < minEdge) reasons.push('EDGE_TOO_SMALL');
  if (!(ev > 0)) reasons.push('NON_POSITIVE_EV');

  const state = reasons.length === 0 ? 'QUALIFIED' : 'WATCH';
  const gate5SignalDraft = state === 'QUALIFIED'
    ? buildGate5SignalDraft({
        event,
        batch,
        prediction,
        market,
        selectionKey,
        modelProbability,
        marketFairProbability,
        bestPrice,
        edge
      })
    : null;

  return {
    eventId: event.eventId,
    league: event.league ?? null,
    homeTeam: event.homeTeam ?? null,
    awayTeam: event.awayTeam ?? null,
    kickoffAt: event.kickoffAt,
    state,
    reasons,
    evidenceMaturity: event.evidenceMaturity ?? 0,
    lineupGate: event.lineupGate ?? 'UNKNOWN',
    independenceVerified: event.independenceVerified === true,
    correlationGroup: event.correlationGroup ?? null,
    prediction,
    selectedOutcome: prediction.predictedOutcome,
    selectionKey,
    modelProbability,
    marketFairProbability,
    edge,
    edgePp: edge * 100,
    bestPrice,
    ev,
    bookmakerComparison: {
      status: market.status,
      providers: market.providers,
      consensusFair: market.consensusFair,
      dispersion: market.dispersion,
      meanOverround: market.meanOverround,
      overroundGap: market.overroundGap,
      skewSeconds: market.skewSeconds,
      hypotheses: market.hypotheses,
      explanationPolicy: market.explanationPolicy
    },
    gate5SignalDraft,
    realMoney: 'NO'
  };
}

export function processTrialBatch(batch, options = {}) {
  if (!batch?.batchId || !batch?.capturedAt || !Array.isArray(batch?.events)) {
    throw new Error('TRIAL_BATCH_IDENTITY_REQUIRED');
  }

  const seen = new Set();
  const events = batch.events.map((event) => {
    if (seen.has(event.eventId)) {
      return {
        eventId: event.eventId,
        state: 'REJECTED',
        reasons: ['DUPLICATE_EVENT_ID'],
        realMoney: 'NO'
      };
    }
    seen.add(event.eventId);
    try {
      return processTrialEvent(event, batch, options);
    } catch (error) {
      return {
        eventId: event?.eventId ?? null,
        league: event?.league ?? null,
        homeTeam: event?.homeTeam ?? null,
        awayTeam: event?.awayTeam ?? null,
        state: 'REJECTED',
        reasons: ['PROCESSING_ERROR'],
        errorCode: error?.message ?? 'UNKNOWN_ERROR',
        realMoney: 'NO'
      };
    }
  });

  const candidates = events
    .filter((event) => event.state === 'QUALIFIED')
    .map((event) => ({
      eventId: event.eventId,
      selection: event.selectedOutcome,
      modelProbability: event.modelProbability,
      marketFairProbability: event.marketFairProbability,
      bestOdds: event.bestPrice.odds,
      evidenceMaturity: event.evidenceMaturity,
      state: event.state,
      independenceVerified: event.independenceVerified,
      correlationGroup: event.correlationGroup
    }));

  const paperCombinations = buildPaperCombinations(candidates, {
    maxSets: options.maxSets ?? 2,
    minLegs: options.minLegs ?? 2,
    maxLegs: options.maxLegs ?? 3,
    minEdge: options.minEdge ?? 0.05,
    minEvidenceMaturity: options.minEvidenceMaturity ?? 70
  });

  const rankedCandidates = events
    .filter((event) => Number.isFinite(event.edge))
    .sort((a, b) => (b.edge - a.edge) || (b.evidenceMaturity - a.evidenceMaturity))
    .map((event, index) => ({
      rank: index + 1,
      eventId: event.eventId,
      league: event.league,
      match: `${event.homeTeam ?? 'HOME'} vs ${event.awayTeam ?? 'AWAY'}`,
      state: event.state,
      selection: event.selectedOutcome,
      modelProbability: event.modelProbability,
      marketFairProbability: event.marketFairProbability,
      edgePp: event.edgePp,
      bestPrice: event.bestPrice,
      ev: event.ev,
      evidenceMaturity: event.evidenceMaturity
    }));

  const counts = events.reduce((acc, event) => {
    acc[event.state] = (acc[event.state] ?? 0) + 1;
    return acc;
  }, {});

  return {
    batchId: batch.batchId,
    fixtureNature: batch.fixtureNature ?? 'UNSPECIFIED',
    capturedAt: batch.capturedAt,
    mode: 'TRIAL_PAPER_ONLY',
    realMoney: 'NO',
    summary: {
      eventsReceived: batch.events.length,
      states: counts,
      qualifiedSignals: candidates.length,
      gate5SignalDrafts: events.filter((event) => event.gate5SignalDraft).length,
      paperCombinationSets: paperCombinations.selected.length
    },
    rankedCandidates,
    events,
    gate5SignalDrafts: events
      .filter((event) => event.gate5SignalDraft)
      .map((event) => event.gate5SignalDraft),
    paperCombinations,
    governance: {
      predictionNotExecution: true,
      noHindsight: true,
      preKickoffCaptureRequired: true,
      bookmakerSnapshotsDeviggedBeforeConsensus: true,
      unverifiedFeedsNotAutoFetched: true,
      capitalLocked: true
    }
  };
}
