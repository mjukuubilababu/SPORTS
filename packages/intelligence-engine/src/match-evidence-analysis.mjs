import { createHash } from 'node:crypto';
import { buildBidirectionalMatchReasoning, buildScoreDistribution } from './bidirectional-match-reasoning.mjs';
import { mapReasoningToMarketSelection } from './market-mapping.mjs';
import { recomputeJointSelection } from './full-market-inference.mjs';

export const MATCH_EVIDENCE_ANALYSIS_VERSION = 'MATCH_EVIDENCE_ANALYSIS_V0_1';
export const MATCH_EVIDENCE_FEATURE_VERSION = 'MATCH_EVIDENCE_FEATURES_V0_1';

export const RECENCY_WEIGHT_CONFIGS = Object.freeze({
  RECENCY_WEIGHTS_V1: Object.freeze([1.00, 0.85, 0.70, 0.55, 0.40])
});

export const FORM_CONTEXT_WEIGHT_CONFIGS = Object.freeze({
  FORM_CONTEXT_WEIGHTS_V1: Object.freeze({ overall: 0.40, venue: 0.60 })
});

export const H2H_DECAY_CONFIGS = Object.freeze({
  H2H_DECAY_V1: Object.freeze({ halfLifeDays: 730, fullConfidenceSample: 10 })
});

export const MATCH_EVIDENCE_CONFIDENCE_CONFIGS = Object.freeze({
  MATCH_EVIDENCE_CONFIDENCE_V1: Object.freeze({
    model: 0.25,
    sample: 0.20,
    provenance: 0.20,
    context: 0.20,
    market: 0.15,
    conflictPenalty: 0.35,
    missingPenalty: 0.25
  })
});

const COMPLETENESS_WEIGHTS = Object.freeze({
  recent_form: 20,
  venue_split: 15,
  h2h: 5,
  market: 15,
  lineup: 15,
  injuries: 10,
  xg: 15,
  rest: 5
});

const DEFAULT_MARKET_SELECTIONS = Object.freeze([
  Object.freeze({ marketFamily: '1X2_FULL_TIME', selection: 'HOME' }),
  Object.freeze({ marketFamily: '1X2_FULL_TIME', selection: 'DRAW' }),
  Object.freeze({ marketFamily: '1X2_FULL_TIME', selection: 'AWAY' }),
  Object.freeze({ marketFamily: 'DOUBLE_CHANCE_FULL_TIME', selection: '1X' }),
  Object.freeze({ marketFamily: 'DOUBLE_CHANCE_FULL_TIME', selection: 'X2' }),
  Object.freeze({ marketFamily: 'DOUBLE_CHANCE_FULL_TIME', selection: '12' }),
  Object.freeze({ marketFamily: 'DRAW_NO_BET_FULL_TIME', selection: 'HOME' }),
  Object.freeze({ marketFamily: 'DRAW_NO_BET_FULL_TIME', selection: 'AWAY' }),
  Object.freeze({ marketFamily: 'TOTAL_GOALS_OVER_UNDER_FULL_TIME', selection: 'OVER', line: 1.5 }),
  Object.freeze({ marketFamily: 'TOTAL_GOALS_OVER_UNDER_FULL_TIME', selection: 'UNDER', line: 2.5 }),
  Object.freeze({ marketFamily: 'TOTAL_GOALS_OVER_UNDER_FULL_TIME', selection: 'UNDER', line: 3.5 }),
  Object.freeze({ marketFamily: 'BTTS_FULL_TIME', selection: 'YES' }),
  Object.freeze({ marketFamily: 'BTTS_FULL_TIME', selection: 'NO' }),
  Object.freeze({ marketFamily: 'HOME_TEAM_OVER_UNDER_FULL_TIME', selection: 'OVER', line: 0.5 }),
  Object.freeze({ marketFamily: 'AWAY_TEAM_OVER_UNDER_FULL_TIME', selection: 'OVER', line: 0.5 })
]);

const SEGMENTS = Object.freeze([
  Object.freeze({ id: '0_15', min: 0, max: 15 }),
  Object.freeze({ id: '16_30', min: 16, max: 30 }),
  Object.freeze({ id: '31_45_PLUS', min: 31, max: 45 }),
  Object.freeze({ id: '46_60', min: 46, max: 60 }),
  Object.freeze({ id: '61_75', min: 61, max: 75 }),
  Object.freeze({ id: '76_90_PLUS', min: 76, max: 130 })
]);

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function finite01(value, code) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(code);
  return value;
}

function timestamp(value, code) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
}

function iso(value, code) {
  return new Date(timestamp(value, code)).toISOString();
}

function round(value, places = 12) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function requireString(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value.trim();
}

function nullableNumber(value, code, { min = -Infinity, max = Infinity } = {}) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(code);
  return value;
}

function sourceConfidence({ sourceType, verified, independentlyVerified }) {
  if (sourceType === 'MANUAL_SCREENSHOT_CAPTURE') {
    return independentlyVerified ? 0.75 : 0.35;
  }
  return verified ? 0.90 : 0.45;
}

function normalizeSource(input, capturedAt) {
  const sourceType = requireString(input.sourceType, 'SOURCE_TYPE_REQUIRED').toUpperCase();
  const independentlyVerified = Boolean(input.independentlyVerified);
  const verified = sourceType === 'MANUAL_SCREENSHOT_CAPTURE'
    ? independentlyVerified
    : Boolean(input.verified);
  return deepFreeze({
    provider: requireString(input.sourceProvider, 'SOURCE_PROVIDER_REQUIRED'),
    source_type: sourceType,
    source_reference: requireString(input.sourceReference, 'SOURCE_REFERENCE_REQUIRED'),
    captured_at: capturedAt,
    verified,
    independently_verified: independentlyVerified,
    confidence: sourceConfidence({ sourceType, verified, independentlyVerified })
  });
}

function normalizeMinutes(value, code) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.some((minute) => !Number.isInteger(minute) || minute < 0 || minute > 130)) {
    throw new Error(code);
  }
  return Object.freeze([...value].sort((a, b) => a - b));
}

function normalizeMatch(match, index, kickoffMs, source, prefix) {
  if (!match || typeof match !== 'object') throw new Error(prefix + '_MATCH_INVALID');
  const playedAt = iso(match.playedAt, prefix + '_PLAYED_AT_INVALID');
  if (Date.parse(playedAt) >= kickoffMs) throw new Error('POST_KICKOFF_FEATURE_REJECTED');
  const goalsFor = nullableNumber(match.goalsFor, prefix + '_GOALS_FOR_INVALID', { min: 0 });
  const goalsAgainst = nullableNumber(match.goalsAgainst, prefix + '_GOALS_AGAINST_INVALID', { min: 0 });
  if (!Number.isInteger(goalsFor) || !Number.isInteger(goalsAgainst)) throw new Error(prefix + '_SCORE_REQUIRED');
  const opponentStrength = nullableNumber(match.opponentStrength, prefix + '_OPPONENT_STRENGTH_INVALID', { min: 0, max: 1 });
  const scoringMinutes = normalizeMinutes(match.scoringMinutes, prefix + '_SCORING_MINUTES_INVALID');
  const concedingMinutes = normalizeMinutes(match.concedingMinutes, prefix + '_CONCEDING_MINUTES_INVALID');
  return deepFreeze({
    match_id: String(match.matchId ?? prefix + '-' + (index + 1)),
    played_at: playedAt,
    goals_for: goalsFor,
    goals_against: goalsAgainst,
    opponent_strength: opponentStrength,
    scoring_minutes: scoringMinutes,
    conceding_minutes: concedingMinutes,
    event_time: playedAt,
    source
  });
}

function normalizeMatches(matches, kickoffMs, source, prefix) {
  if (matches === null || matches === undefined) return Object.freeze([]);
  if (!Array.isArray(matches)) throw new Error(prefix + '_MATCHES_INVALID');
  return Object.freeze(matches
    .map((match, index) => normalizeMatch(match, index, kickoffMs, source, prefix))
    .sort((a, b) => Date.parse(b.played_at) - Date.parse(a.played_at)));
}

function normalizeMarketObservations(observations, kickoffMs, capturedMs, source) {
  if (observations === null || observations === undefined) return Object.freeze([]);
  if (!Array.isArray(observations)) throw new Error('MARKET_OBSERVATIONS_INVALID');
  const normalized = observations.map((row, index) => {
    const provider = requireString(row.provider ?? source.provider, 'MARKET_PROVIDER_REQUIRED');
    const observedAt = iso(row.observedAt, 'MARKET_OBSERVED_AT_INVALID');
    if (Date.parse(observedAt) >= kickoffMs) throw new Error('POST_KICKOFF_MARKET_REJECTED');
    if (Date.parse(observedAt) > capturedMs) throw new Error('MARKET_OBSERVATION_AFTER_SNAPSHOT');
    const rawProbability = row.odds === null || row.odds === undefined
      ? null
      : (row.odds > 1 ? 1 / row.odds : (() => { throw new Error('MARKET_ODDS_INVALID'); })());
    const fair = nullableNumber(row.marketFairProbability, 'MARKET_FAIR_PROBABILITY_INVALID', { min: 0, max: 1 });
    return deepFreeze({
      observation_id: String(row.observationId ?? 'market-' + (index + 1)),
      market_snapshot_id: requireString(row.marketSnapshotId, 'MARKET_SNAPSHOT_ID_REQUIRED'),
      market_family: requireString(row.marketFamily, 'MARKET_FAMILY_REQUIRED'),
      selection: requireString(String(row.selection), 'MARKET_SELECTION_REQUIRED'),
      line: nullableNumber(row.line, 'MARKET_LINE_INVALID', { min: 0 }),
      odds: row.odds ?? null,
      raw_probability: rawProbability,
      fair_probability: fair,
      provider,
      observed_at: observedAt,
      source
    });
  });
  const providers = new Set(normalized.map((row) => row.provider));
  const snapshots = new Set(normalized.map((row) => row.market_snapshot_id));
  if (providers.size > 1) throw new Error('MARKET_PROVIDER_MIXING_REJECTED');
  if (snapshots.size > 1) throw new Error('MARKET_SNAPSHOT_MIXING_REJECTED');
  return Object.freeze(normalized);
}

function featureRecord(value, { source, featureVersion, sampleSize = 0, confidence = 0, eventTime = null, status = null, fallback = null, sources = [] }) {
  const known = value !== null && value !== undefined;
  return deepFreeze({
    value: known && Number.isFinite(value) ? round(value) : value,
    status: status ?? (known ? 'OBSERVED_OR_DERIVED' : 'UNKNOWN'),
    source,
    source_type: source.source_type,
    captured_at: source.captured_at,
    event_time: eventTime,
    feature_version: featureVersion,
    provider: source.provider,
    confidence: round(clamp01(confidence)),
    sample_size: sampleSize,
    fallback,
    source_events: sources
  });
}

function weightedMean(values, weights) {
  const mass = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(mass > 0) || values.length !== weights.length) return null;
  return values.reduce((sum, value, index) => sum + value * weights[index], 0) / mass;
}

function weightedRate(matches, weights, predicate) {
  return weightedMean(matches.map((match) => predicate(match) ? 1 : 0), weights);
}

function formFeatures(matches, config, source, featureVersion) {
  const selected = matches.slice(0, config.length);
  if (!selected.length) return null;
  const weights = config.slice(0, selected.length);
  const sampleConfidence = Math.min(1, selected.length / config.length) * source.confidence;
  const eventTime = selected[0].played_at;
  const sources = selected.map((match) => match.match_id);
  const ppg = weightedMean(selected.map((match) => match.goals_for > match.goals_against ? 3 : match.goals_for === match.goals_against ? 1 : 0), weights);
  return {
    ppg: featureRecord(ppg, { source, featureVersion, sampleSize: selected.length, confidence: sampleConfidence, eventTime, sources }),
    goalsFor: featureRecord(weightedMean(selected.map((match) => match.goals_for), weights), { source, featureVersion, sampleSize: selected.length, confidence: sampleConfidence, eventTime, sources }),
    goalsAgainst: featureRecord(weightedMean(selected.map((match) => match.goals_against), weights), { source, featureVersion, sampleSize: selected.length, confidence: sampleConfidence, eventTime, sources }),
    winRate: featureRecord(weightedRate(selected, weights, (match) => match.goals_for > match.goals_against), { source, featureVersion, sampleSize: selected.length, confidence: sampleConfidence, eventTime, sources }),
    drawRate: featureRecord(weightedRate(selected, weights, (match) => match.goals_for === match.goals_against), { source, featureVersion, sampleSize: selected.length, confidence: sampleConfidence, eventTime, sources }),
    lossRate: featureRecord(weightedRate(selected, weights, (match) => match.goals_for < match.goals_against), { source, featureVersion, sampleSize: selected.length, confidence: sampleConfidence, eventTime, sources }),
    over15Rate: featureRecord(weightedRate(selected, weights, (match) => match.goals_for + match.goals_against > 1.5), { source, featureVersion, sampleSize: selected.length, confidence: sampleConfidence, eventTime, sources }),
    over25Rate: featureRecord(weightedRate(selected, weights, (match) => match.goals_for + match.goals_against > 2.5), { source, featureVersion, sampleSize: selected.length, confidence: sampleConfidence, eventTime, sources }),
    over35Rate: featureRecord(weightedRate(selected, weights, (match) => match.goals_for + match.goals_against > 3.5), { source, featureVersion, sampleSize: selected.length, confidence: sampleConfidence, eventTime, sources }),
    bttsRate: featureRecord(weightedRate(selected, weights, (match) => match.goals_for > 0 && match.goals_against > 0), { source, featureVersion, sampleSize: selected.length, confidence: sampleConfidence, eventTime, sources }),
    cleanSheetRate: featureRecord(weightedRate(selected, weights, (match) => match.goals_against === 0), { source, featureVersion, sampleSize: selected.length, confidence: sampleConfidence, eventTime, sources }),
    failedToScoreRate: featureRecord(weightedRate(selected, weights, (match) => match.goals_for === 0), { source, featureVersion, sampleSize: selected.length, confidence: sampleConfidence, eventTime, sources }),
    weights: Object.freeze([...weights])
  };
}

function missingForm(source, featureVersion) {
  const record = () => featureRecord(null, { source, featureVersion, status: 'UNKNOWN', fallback: 'MATCH_SAMPLE_UNAVAILABLE' });
  return {
    ppg: record(), goalsFor: record(), goalsAgainst: record(), winRate: record(), drawRate: record(), lossRate: record(),
    over15Rate: record(), over25Rate: record(), over35Rate: record(), bttsRate: record(), cleanSheetRate: record(),
    failedToScoreRate: record(), weights: Object.freeze([])
  };
}

function opponentAdjusted(matches, recencyWeights, source, featureVersion) {
  const selected = matches.slice(0, recencyWeights.length);
  if (!selected.length || selected.some((match) => match.opponent_strength === null)) {
    return deepFreeze({
      adjusted_goals_for: featureRecord(null, { source, featureVersion, sampleSize: selected.length, status: 'UNKNOWN', fallback: 'OPPONENT_STRENGTH_UNAVAILABLE' }),
      adjusted_goals_against: featureRecord(null, { source, featureVersion, sampleSize: selected.length, status: 'UNKNOWN', fallback: 'OPPONENT_STRENGTH_UNAVAILABLE' }),
      adjusted_form_score: featureRecord(null, { source, featureVersion, sampleSize: selected.length, status: 'UNKNOWN', fallback: 'OPPONENT_STRENGTH_UNAVAILABLE' })
    });
  }
  const weights = recencyWeights.slice(0, selected.length);
  const confidence = source.confidence * Math.min(1, selected.length / recencyWeights.length);
  const eventTime = selected[0].played_at;
  const sources = selected.map((match) => match.match_id);
  const adjustedGoalsFor = weightedMean(selected.map((match) => match.goals_for * (0.5 + match.opponent_strength)), weights);
  const adjustedGoalsAgainst = weightedMean(selected.map((match) => match.goals_against * (1.5 - match.opponent_strength)), weights);
  const adjustedForm = weightedMean(selected.map((match) => {
    const ppg = match.goals_for > match.goals_against ? 3 : match.goals_for === match.goals_against ? 1 : 0;
    return ppg * (0.5 + match.opponent_strength);
  }), weights);
  return deepFreeze({
    adjusted_goals_for: featureRecord(adjustedGoalsFor, { source, featureVersion, sampleSize: selected.length, confidence, eventTime, sources }),
    adjusted_goals_against: featureRecord(adjustedGoalsAgainst, { source, featureVersion, sampleSize: selected.length, confidence, eventTime, sources }),
    adjusted_form_score: featureRecord(adjustedForm, { source, featureVersion, sampleSize: selected.length, confidence, eventTime, sources })
  });
}

function h2hFeatures(matches, kickoffMs, config, source, featureVersion) {
  if (!matches.length) {
    const unknown = featureRecord(null, { source, featureVersion, status: 'UNKNOWN', fallback: 'H2H_UNAVAILABLE' });
    return deepFreeze({
      h2h_sample_size: featureRecord(0, { source, featureVersion, status: 'INSUFFICIENT_SAMPLE' }),
      h2h_age_days: unknown,
      h2h_weighted_goals: unknown,
      h2h_weighted_btts: unknown,
      h2h_weighted_over25: unknown,
      h2h_match_weights: Object.freeze([])
    });
  }
  const ageDays = matches.map((match) => (kickoffMs - Date.parse(match.played_at)) / 86400000);
  const weights = ageDays.map((age) => 0.5 ** (age / config.halfLifeDays));
  const recencyConfidence = weights.reduce((sum, weight) => sum + weight, 0) / matches.length;
  const confidence = source.confidence * Math.min(1, matches.length / config.fullConfidenceSample) * recencyConfidence;
  const meta = { source, featureVersion, sampleSize: matches.length, confidence, eventTime: matches[0].played_at, sources: matches.map((match) => match.match_id) };
  return deepFreeze({
    h2h_sample_size: featureRecord(matches.length, { ...meta, confidence }),
    h2h_age_days: featureRecord(Math.min(...ageDays), meta),
    h2h_weighted_goals: featureRecord(weightedMean(matches.map((match) => match.goals_for + match.goals_against), weights), meta),
    h2h_weighted_btts: featureRecord(weightedRate(matches, weights, (match) => match.goals_for > 0 && match.goals_against > 0), meta),
    h2h_weighted_over25: featureRecord(weightedRate(matches, weights, (match) => match.goals_for + match.goals_against > 2.5), meta),
    h2h_match_weights: Object.freeze(matches.map((match, index) => deepFreeze({ match_id: match.match_id, age_days: round(ageDays[index]), weight: round(weights[index]) })))
  });
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function variance(values) {
  if (!values.length) return null;
  const average = mean(values);
  return mean(values.map((value) => (value - average) ** 2));
}

function classifyGoalEnvironment(value) {
  if (value === null) return null;
  if (value < 1.5) return 'VERY_LOW';
  if (value < 2.2) return 'LOW';
  if (value < 3.0) return 'MODERATE';
  if (value < 3.8) return 'HIGH';
  return 'VERY_HIGH';
}

function goalEnvironment(homeRecent, awayRecent, homeVenue, awayVenue, source, featureVersion) {
  const recent = [...homeRecent, ...awayRecent].map((match) => match.goals_for + match.goals_against);
  const venue = [...homeVenue, ...awayVenue].map((match) => match.goals_for + match.goals_against);
  const combined = venue.length ? venue : recent;
  const confidence = source.confidence * Math.min(1, combined.length / 10);
  const meta = { source, featureVersion, sampleSize: combined.length, confidence, eventTime: combined.length ? source.captured_at : null };
  const totalMatches = [...homeRecent, ...awayRecent];
  const rate = (predicate) => totalMatches.length ? totalMatches.filter(predicate).length / totalMatches.length : null;
  const combinedMean = mean(combined);
  return deepFreeze({
    combined_recent_goals_mean: featureRecord(mean(recent), { ...meta, sampleSize: recent.length }),
    combined_recent_goals_median: featureRecord(median(recent), { ...meta, sampleSize: recent.length }),
    combined_home_away_goals_mean: featureRecord(mean(venue), { ...meta, sampleSize: venue.length, status: venue.length ? null : 'UNKNOWN', fallback: venue.length ? null : 'VENUE_SPLIT_UNAVAILABLE' }),
    combined_goals_variance: featureRecord(variance(combined), meta),
    combined_over15_rate: featureRecord(rate((match) => match.goals_for + match.goals_against > 1.5), { ...meta, sampleSize: totalMatches.length }),
    combined_over25_rate: featureRecord(rate((match) => match.goals_for + match.goals_against > 2.5), { ...meta, sampleSize: totalMatches.length }),
    combined_over35_rate: featureRecord(rate((match) => match.goals_for + match.goals_against > 3.5), { ...meta, sampleSize: totalMatches.length }),
    combined_btts_rate: featureRecord(rate((match) => match.goals_for > 0 && match.goals_against > 0), { ...meta, sampleSize: totalMatches.length }),
    combined_clean_sheet_rate: featureRecord(rate((match) => match.goals_against === 0), { ...meta, sampleSize: totalMatches.length }),
    combined_failed_to_score_rate: featureRecord(rate((match) => match.goals_for === 0), { ...meta, sampleSize: totalMatches.length }),
    goal_environment_classification: featureRecord(classifyGoalEnvironment(combinedMean), { ...meta, status: combinedMean === null ? 'UNKNOWN' : 'SUPPORTING_EVIDENCE_ONLY' })
  });
}

function timeSegmentFeatures(matches, prefix, source, featureVersion) {
  const explicit = matches.filter((match) => match.scoring_minutes !== null && match.conceding_minutes !== null);
  const complete = matches.length > 0 && explicit.length === matches.length;
  const confidence = source.confidence * Math.min(1, explicit.length / 5) * (complete ? 1 : 0.7);
  return Object.fromEntries(SEGMENTS.flatMap((segment) => {
    const scoring = explicit.length
      ? explicit.reduce((sum, match) => sum + match.scoring_minutes.filter((minute) => minute >= segment.min && minute <= segment.max).length, 0) / explicit.length
      : null;
    const conceding = explicit.length
      ? explicit.reduce((sum, match) => sum + match.conceding_minutes.filter((minute) => minute >= segment.min && minute <= segment.max).length, 0) / explicit.length
      : null;
    const meta = {
      source, featureVersion, sampleSize: explicit.length, confidence,
      eventTime: explicit.length ? explicit[0].played_at : null,
      status: explicit.length ? (complete ? 'OBSERVED_MINUTE_DATA' : 'PARTIAL_MINUTE_DATA') : 'UNKNOWN',
      fallback: explicit.length ? null : 'MINUTE_DATA_UNAVAILABLE',
      sources: explicit.map((match) => match.match_id)
    };
    return [
      [prefix + '_score_rate_' + segment.id, featureRecord(scoring, meta)],
      [prefix + '_concede_rate_' + segment.id, featureRecord(conceding, meta)]
    ];
  }));
}

function available(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined;
}

function computeCompleteness(input) {
  const checks = {
    recent_form: input.homeRecent.length > 0 && input.awayRecent.length > 0,
    venue_split: input.homeVenue.length > 0 && input.awayVenue.length > 0,
    h2h: input.h2h.length > 0,
    market: input.market.length > 0,
    lineup: available(input.lineups?.home) && available(input.lineups?.away),
    injuries: input.injuries !== null && input.injuries !== undefined,
    xg: Number.isFinite(input.xg?.home) && Number.isFinite(input.xg?.away),
    rest: Number.isFinite(input.restDays?.home) && Number.isFinite(input.restDays?.away)
  };
  const score = Object.entries(checks).reduce((sum, [key, present]) => sum + (present ? COMPLETENESS_WEIGHTS[key] : 0), 0);
  return deepFreeze({ score, checks: deepFreeze(checks), weights: COMPLETENESS_WEIGHTS, version: 'EVIDENCE_COMPLETENESS_V1' });
}

function snapshotPayload(snapshot) {
  const { fingerprint: ignored, ...payload } = snapshot;
  return payload;
}

export function verifyMatchEvidenceSnapshot(snapshot) {
  if (!snapshot || snapshot.immutable !== true) throw new Error('EVIDENCE_SNAPSHOT_NOT_IMMUTABLE');
  if (snapshot.fingerprint !== fingerprint(snapshotPayload(snapshot))) throw new Error('EVIDENCE_SNAPSHOT_FINGERPRINT_MISMATCH');
  return true;
}

export function buildMatchEvidenceSnapshot({
  evidenceSnapshotId,
  eventId,
  kickoffAt,
  capturedAt,
  sourceProvider,
  sourceType,
  sourceReference,
  verified = false,
  independentlyVerified = false,
  featureVersion = MATCH_EVIDENCE_FEATURE_VERSION,
  recencyConfigVersion = 'RECENCY_WEIGHTS_V1',
  formContextWeightVersion = 'FORM_CONTEXT_WEIGHTS_V1',
  h2hDecayVersion = 'H2H_DECAY_V1',
  homeRecentMatches = [],
  awayRecentMatches = [],
  homeHomeMatches = [],
  awayAwayMatches = [],
  h2hMatches = [],
  leaguePositions = null,
  restDays = null,
  injuries = null,
  suspensions = null,
  lineups = null,
  xG = null,
  marketObservations = []
}) {
  const id = requireString(evidenceSnapshotId, 'EVIDENCE_SNAPSHOT_ID_REQUIRED');
  const event = requireString(eventId, 'EVENT_ID_REQUIRED');
  const kickoff = iso(kickoffAt, 'KICKOFF_AT_INVALID');
  const captured = iso(capturedAt, 'CAPTURED_AT_INVALID');
  const kickoffMs = Date.parse(kickoff);
  if (Date.parse(captured) >= kickoffMs) throw new Error('POST_KICKOFF_FEATURE_REJECTED');
  const source = normalizeSource({ sourceProvider, sourceType, sourceReference, verified, independentlyVerified }, captured);
  const recency = RECENCY_WEIGHT_CONFIGS[recencyConfigVersion];
  const formWeights = FORM_CONTEXT_WEIGHT_CONFIGS[formContextWeightVersion];
  const h2hConfig = H2H_DECAY_CONFIGS[h2hDecayVersion];
  if (!recency) throw new Error('RECENCY_CONFIG_UNKNOWN');
  if (!formWeights) throw new Error('FORM_CONTEXT_CONFIG_UNKNOWN');
  if (!h2hConfig) throw new Error('H2H_DECAY_CONFIG_UNKNOWN');

  const homeRecent = normalizeMatches(homeRecentMatches, kickoffMs, source, 'HOME_RECENT');
  const awayRecent = normalizeMatches(awayRecentMatches, kickoffMs, source, 'AWAY_RECENT');
  const homeVenue = normalizeMatches(homeHomeMatches, kickoffMs, source, 'HOME_HOME');
  const awayVenue = normalizeMatches(awayAwayMatches, kickoffMs, source, 'AWAY_AWAY');
  const h2h = normalizeMatches(h2hMatches, kickoffMs, source, 'H2H');
  const market = normalizeMarketObservations(marketObservations, kickoffMs, Date.parse(captured), source);

  const homeOverall = formFeatures(homeRecent, recency, source, featureVersion) ?? missingForm(source, featureVersion);
  const awayOverall = formFeatures(awayRecent, recency, source, featureVersion) ?? missingForm(source, featureVersion);
  const homeAtHome = formFeatures(homeVenue, recency, source, featureVersion) ?? missingForm(source, featureVersion);
  const awayAtAway = formFeatures(awayVenue, recency, source, featureVersion) ?? missingForm(source, featureVersion);
  const h2hDerived = h2hFeatures(h2h, kickoffMs, h2hConfig, source, featureVersion);
  const completeness = computeCompleteness({ homeRecent, awayRecent, homeVenue, awayVenue, h2h, market, lineups, injuries, xg: xG, restDays });

  const blend = (overall, venue) => {
    if (overall.value === null && venue.value === null) return null;
    if (venue.value === null) return overall.value;
    if (overall.value === null) return venue.value;
    return overall.value * formWeights.overall + venue.value * formWeights.venue;
  };

  const features = deepFreeze({
    home_recent_ppg: homeOverall.ppg,
    away_recent_ppg: awayOverall.ppg,
    home_recent_goals_for: homeOverall.goalsFor,
    home_recent_goals_against: homeOverall.goalsAgainst,
    away_recent_goals_for: awayOverall.goalsFor,
    away_recent_goals_against: awayOverall.goalsAgainst,
    home_home_ppg: homeAtHome.ppg,
    away_away_ppg: awayAtAway.ppg,
    home_home_goals_for: homeAtHome.goalsFor,
    home_home_goals_against: homeAtHome.goalsAgainst,
    away_away_goals_for: awayAtAway.goalsFor,
    away_away_goals_against: awayAtAway.goalsAgainst,
    recent_goal_difference: featureRecord(
      [homeOverall.goalsFor.value, homeOverall.goalsAgainst.value, awayOverall.goalsFor.value, awayOverall.goalsAgainst.value].every(Number.isFinite)
        ? homeOverall.goalsFor.value - homeOverall.goalsAgainst.value - awayOverall.goalsFor.value + awayOverall.goalsAgainst.value
        : null,
      { source, featureVersion, sampleSize: Math.min(homeRecent.length, awayRecent.length), confidence: Math.min(homeOverall.ppg.confidence, awayOverall.ppg.confidence), eventTime: captured }
    ),
    recent_win_rate: deepFreeze({ home: homeOverall.winRate, away: awayOverall.winRate }),
    recent_draw_rate: deepFreeze({ home: homeOverall.drawRate, away: awayOverall.drawRate }),
    recent_loss_rate: deepFreeze({ home: homeOverall.lossRate, away: awayOverall.lossRate }),
    home_home_win_rate: homeAtHome.winRate,
    away_away_win_rate: awayAtAway.winRate,
    context_weighted_home_form: featureRecord(blend(homeOverall.ppg, homeAtHome.ppg), { source, featureVersion, sampleSize: homeRecent.length + homeVenue.length, confidence: Math.min(homeOverall.ppg.confidence, homeAtHome.ppg.confidence || homeOverall.ppg.confidence), eventTime: captured }),
    context_weighted_away_form: featureRecord(blend(awayOverall.ppg, awayAtAway.ppg), { source, featureVersion, sampleSize: awayRecent.length + awayVenue.length, confidence: Math.min(awayOverall.ppg.confidence, awayAtAway.ppg.confidence || awayOverall.ppg.confidence), eventTime: captured }),
    home_opponent_adjusted: opponentAdjusted(homeRecent, recency, source, featureVersion),
    away_opponent_adjusted: opponentAdjusted(awayRecent, recency, source, featureVersion),
    h2h: h2hDerived,
    goal_environment: goalEnvironment(homeRecent, awayRecent, homeVenue, awayVenue, source, featureVersion),
    scoring_time_segments: deepFreeze({
      ...timeSegmentFeatures(homeRecent, 'home', source, featureVersion),
      ...timeSegmentFeatures(awayRecent, 'away', source, featureVersion)
    })
  });

  const payload = {
    evidence_snapshot_id: id,
    event_id: event,
    kickoff_at: kickoff,
    captured_at: captured,
    created_at: captured,
    source_provider: source.provider,
    source_type: source.source_type,
    source_reference: source.source_reference,
    source,
    feature_version: featureVersion,
    config_versions: deepFreeze({
      recency: recencyConfigVersion,
      form_context: formContextWeightVersion,
      h2h_decay: h2hDecayVersion
    }),
    home_recent_matches: homeRecent,
    away_recent_matches: awayRecent,
    home_home_matches: homeVenue,
    away_away_matches: awayVenue,
    h2h_matches: h2h,
    league_positions: leaguePositions,
    rest_days: restDays,
    injuries,
    suspensions,
    lineups,
    xg: xG,
    market_observations: market,
    features,
    evidence_quality: round(source.confidence * 100, 2),
    completeness_score: completeness.score,
    completeness,
    conflict_score: null,
    immutable: true
  };
  const snapshot = { ...payload, fingerprint: fingerprint(payload) };
  return deepFreeze(snapshot);
}

function probabilityVariance(probability) {
  return probability * (1 - probability);
}

function entropyConfidence(probabilities) {
  const entropy = probabilities.reduce((sum, probability) => probability > 0 ? sum - probability * Math.log2(probability) : sum, 0);
  return clamp01(1 - entropy / Math.log2(3));
}

function marketKey(row) {
  return row.marketFamily + '|' + row.selection + '|' + (row.line ?? '');
}

function marketFairProbability(snapshot, candidate) {
  const row = snapshot.market_observations.find((observation) =>
    observation.market_family === candidate.marketFamily &&
    observation.selection === String(candidate.selection) &&
    (observation.line ?? null) === (candidate.line ?? null));
  return row?.fair_probability ?? null;
}

function detectConflicts(snapshot, reasoning) {
  const features = snapshot.features;
  const conflicts = [];
  const recentGoals = features.goal_environment.combined_recent_goals_mean.value;
  const h2hGoals = features.h2h.h2h_weighted_goals.value;
  if (recentGoals !== null && h2hGoals !== null && Math.abs(recentGoals - h2hGoals) >= 1.2) {
    conflicts.push({ code: 'H2H_VS_RECENT_GOALS', severity: clamp01(Math.abs(recentGoals - h2hGoals) / 3) });
  }
  const overallEdge = features.home_recent_ppg.value - features.away_recent_ppg.value;
  const venueEdge = features.home_home_ppg.value - features.away_away_ppg.value;
  if (Number.isFinite(overallEdge) && Number.isFinite(venueEdge) && overallEdge * venueEdge < 0) {
    conflicts.push({ code: 'VENUE_VS_OVERALL_FORM', severity: clamp01(Math.abs(overallEdge - venueEdge) / 3) });
  }
  const xgTotal = Number.isFinite(snapshot.xg?.home) && Number.isFinite(snapshot.xg?.away) ? snapshot.xg.home + snapshot.xg.away : null;
  if (xgTotal !== null && recentGoals !== null && Math.abs(xgTotal - recentGoals) >= 1) {
    conflicts.push({ code: 'RECENT_GOALS_VS_XG', severity: clamp01(Math.abs(xgTotal - recentGoals) / 3) });
  }
  const homeMarket = snapshot.market_observations.find((row) => row.market_family === '1X2_FULL_TIME' && row.selection === 'HOME' && row.fair_probability !== null);
  if (homeMarket) {
    const gap = Math.abs(homeMarket.fair_probability - reasoning.matchReality.homeWin);
    if (gap >= 0.12) conflicts.push({ code: 'MODEL_VS_MARKET', severity: clamp01(gap / 0.35) });
  }
  const varianceValue = features.goal_environment.combined_goals_variance.value;
  if (varianceValue !== null && varianceValue >= 4) conflicts.push({ code: 'RECENT_SCORE_OUTLIER', severity: clamp01(varianceValue / 8) });
  if (features.h2h.h2h_sample_size.value > 0 && features.h2h.h2h_sample_size.value < 5) {
    conflicts.push({ code: 'H2H_SMALL_SAMPLE', severity: 0.35 });
  }
  const conflictScore = conflicts.length
    ? clamp01(conflicts.reduce((sum, conflict) => sum + conflict.severity, 0) / Math.max(2, conflicts.length * 0.75))
    : 0;
  return deepFreeze({ conflicts: conflicts.map(deepFreeze), conflictScore: round(conflictScore) });
}

function trapFlags(snapshot, conflictAudit, reasoning) {
  const flags = [];
  const f = snapshot.features;
  const h2hN = f.h2h.h2h_sample_size.value;
  if (h2hN > 0 && h2hN < 5) flags.push('TRAP_H2H_OVERWEIGHT', 'TRAP_STATS_SMALL_SAMPLE');
  if (f.goal_environment.combined_goals_variance.value >= 4) flags.push('TRAP_RECENT_SCORE_OUTLIER');
  if (!available(snapshot.lineups?.home) || !available(snapshot.lineups?.away)) flags.push('TRAP_LINEUP_MISMATCH');
  if (conflictAudit.conflicts.some((row) => row.code === 'VENUE_VS_OVERALL_FORM')) flags.push('TRAP_MARKET_AGAINST_HOME_AWAY');
  if (conflictAudit.conflicts.some((row) => row.code === 'RECENT_GOALS_VS_XG')) flags.push('TRAP_MARKET_AGAINST_XG');
  const homeMarket = snapshot.market_observations.find((row) => row.market_family === '1X2_FULL_TIME' && row.selection === 'HOME' && row.fair_probability !== null);
  const marketDisagreementScore = homeMarket ? clamp01(Math.abs(homeMarket.fair_probability - reasoning.matchReality.homeWin) / 0.35) : 0;
  return deepFreeze({ trap_flags: Object.freeze([...new Set(flags)]), market_disagreement_score: round(marketDisagreementScore) });
}

function computedConfidence(snapshot, reasoning, conflictAudit) {
  const config = MATCH_EVIDENCE_CONFIDENCE_CONFIGS.MATCH_EVIDENCE_CONFIDENCE_V1;
  const model = entropyConfidence([reasoning.matchReality.homeWin, reasoning.matchReality.draw, reasoning.matchReality.awayWin]);
  const samples = [
    snapshot.features.home_recent_ppg.sample_size,
    snapshot.features.away_recent_ppg.sample_size,
    snapshot.features.home_home_ppg.sample_size,
    snapshot.features.away_away_ppg.sample_size
  ];
  const sample = Math.min(1, mean(samples) / RECENCY_WEIGHT_CONFIGS[snapshot.config_versions.recency].length);
  const provenance = snapshot.source.confidence;
  const context = snapshot.completeness_score / 100;
  const market = snapshot.market_observations.length ? snapshot.source.confidence : 0;
  const conflictPenalty = conflictAudit.conflictScore * config.conflictPenalty;
  const missingPenalty = (1 - context) * config.missingPenalty;
  const final = clamp01(
    model * config.model +
    sample * config.sample +
    provenance * config.provenance +
    context * config.context +
    market * config.market -
    conflictPenalty -
    missingPenalty
  );
  return deepFreeze({
    version: 'MATCH_EVIDENCE_CONFIDENCE_V1',
    base_model_confidence: round(model),
    sample_confidence: round(sample),
    provenance_confidence: round(provenance),
    context_confidence: round(context),
    market_confidence: round(market),
    conflict_penalty: round(conflictPenalty),
    missing_data_penalty: round(missingPenalty),
    final_confidence: round(final)
  });
}

function compatibilityRule(distribution, a, b) {
  if (marketKey(a) === marketKey(b)) {
    return deepFreeze({ market_a: a.marketFamily, selection_a: a.selection, line_a: a.line ?? null, market_b: b.marketFamily, selection_b: b.selection, line_b: b.line ?? null, compatibility: 'COMPATIBLE', joint_probability: a.modelProbability });
  }
  const joint = recomputeJointSelection(distribution, [a, b]);
  let compatibility = 'CONDITIONALLY_COMPATIBLE';
  if (joint.status !== 'MODELLED') compatibility = 'UNSUPPORTED';
  else if (joint.joint_probability <= 1e-12) compatibility = 'CONTRADICTORY';
  else {
    const overlap = joint.joint_probability / Math.min(a.modelProbability, b.modelProbability);
    if (overlap >= 0.75) compatibility = 'COMPATIBLE';
  }
  return deepFreeze({
    market_a: a.marketFamily,
    selection_a: a.selection,
    line_a: a.line ?? null,
    market_b: b.marketFamily,
    selection_b: b.selection,
    line_b: b.line ?? null,
    compatibility,
    joint_probability: joint.joint_probability
  });
}

export function buildMarketCompatibilityMatrix(distribution, candidates) {
  const rules = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      rules.push(compatibilityRule(distribution, candidates[i], candidates[j]));
    }
  }
  return deepFreeze(rules);
}

function compatibleWithAll(distribution, candidate, selected) {
  return selected.every((other) => {
    const state = compatibilityRule(distribution, candidate, other).compatibility;
    return state === 'COMPATIBLE' || state === 'CONDITIONALLY_COMPATIBLE';
  });
}

function evidenceSupport(snapshot) {
  const support = [];
  if (snapshot.features.home_recent_ppg.value !== null) support.push('RECENT_FORM');
  if (snapshot.features.home_home_ppg.value !== null && snapshot.features.away_away_ppg.value !== null) support.push('VENUE_SPLIT');
  if (snapshot.features.h2h.h2h_weighted_goals.value !== null) support.push('H2H_DECAYED');
  if (snapshot.features.home_opponent_adjusted.adjusted_form_score.value !== null) support.push('OPPONENT_STRENGTH_ADJUSTED');
  if (snapshot.xg !== null) support.push('XG_CONTEXT');
  return Object.freeze(support);
}

function decorateCandidate(snapshot, mapped, confidence, conflictAudit) {
  const fair = marketFairProbability(snapshot, mapped);
  const edge = fair === null ? null : mapped.modelProbability - fair;
  const valueBonus = edge === null ? 0 : Math.max(-0.1, Math.min(0.1, edge));
  const rankingScore = mapped.modelProbability * 0.60 + confidence.final_confidence * 0.35 + valueBonus * 0.05;
  return deepFreeze({
    market: mapped.marketFamily,
    marketFamily: mapped.marketFamily,
    selection: mapped.selection,
    line: mapped.line ?? null,
    model_probability: round(mapped.modelProbability),
    modelProbability: mapped.modelProbability,
    market_probability_if_available: fair,
    edge_if_available: edge === null ? null : round(edge),
    confidence: confidence.final_confidence,
    evidence_support: evidenceSupport(snapshot),
    evidence_conflicts: Object.freeze(conflictAudit.conflicts.map((row) => row.code)),
    reason_codes: Object.freeze(['CANONICAL_SCORE_DISTRIBUTION', 'EVIDENCE_CONFIDENCE_COMPUTED']),
    probability_variance: round(probabilityVariance(mapped.modelProbability)),
    ranking_score: round(rankingScore)
  });
}

function abstentionReasons(snapshot, conflictAudit, trapAudit) {
  const reasons = [];
  if (snapshot.completeness_score < 35) reasons.push('INSUFFICIENT_DATA');
  if (!snapshot.market_observations.length) reasons.push('MARKET_MISSING');
  if (!available(snapshot.lineups?.home) || !available(snapshot.lineups?.away)) reasons.push('LINEUP_UNKNOWN');
  if (!snapshot.home_home_matches.length || !snapshot.away_away_matches.length) reasons.push('VENUE_SPLIT_UNAVAILABLE');
  if (!snapshot.source.verified) reasons.push('SOURCE_UNVERIFIED');
  if (conflictAudit.conflictScore >= 0.61) reasons.push('HIGH_EVIDENCE_CONFLICT');
  if (trapAudit.market_disagreement_score >= 0.8) reasons.push('MODEL_MARKET_EXTREME_DISAGREEMENT');
  if (snapshot.features.home_recent_ppg.sample_size < 3 || snapshot.features.away_recent_ppg.sample_size < 3) reasons.push('LOW_SAMPLE_SIZE');
  return Object.freeze([...new Set(reasons)]);
}

function decisionFor(snapshot, conflictAudit, trapAudit, abstain) {
  if (
    snapshot.completeness_score < 35 ||
    !snapshot.source.verified ||
    conflictAudit.conflictScore >= 0.81 ||
    trapAudit.market_disagreement_score >= 0.95
  ) return 'ABSTAIN';
  if (
    conflictAudit.conflictScore >= 0.41 ||
    snapshot.completeness_score < 70 ||
    !available(snapshot.lineups?.home) ||
    !available(snapshot.lineups?.away)
  ) return 'WATCH';
  return abstain.length ? 'WATCH' : 'QUALIFIED';
}

export function analyzeMatchEvidence({
  snapshot,
  homeLambda,
  awayLambda,
  homeTeam = 'HOME',
  awayTeam = 'AWAY',
  modelVersion,
  analysisVersion = MATCH_EVIDENCE_ANALYSIS_VERSION,
  marketSelections = DEFAULT_MARKET_SELECTIONS,
  halfReasoning = null
}) {
  verifyMatchEvidenceSnapshot(snapshot);
  requireString(modelVersion, 'MODEL_VERSION_REQUIRED');
  if (!Number.isFinite(homeLambda) || homeLambda < 0 || !Number.isFinite(awayLambda) || awayLambda < 0) throw new Error('MODEL_LAMBDAS_INVALID');
  const reasoning = buildBidirectionalMatchReasoning({
    eventId: snapshot.event_id,
    homeTeam,
    awayTeam,
    homeLambda,
    awayLambda
  });
  const distribution = buildScoreDistribution({ homeLambda, awayLambda });
  const conflictAudit = detectConflicts(snapshot, reasoning);
  const trapAudit = trapFlags(snapshot, conflictAudit, reasoning);
  const confidence = computedConfidence(snapshot, reasoning, conflictAudit);
  const mapped = marketSelections.map((selection) => mapReasoningToMarketSelection(reasoning, selection, halfReasoning));
  const unsupported = mapped.filter((row) => row.status !== 'MODELLED');
  const candidates = mapped
    .filter((row) => row.status === 'MODELLED')
    .map((row) => decorateCandidate(snapshot, row, confidence, conflictAudit))
    .sort((a, b) => (b.ranking_score - a.ranking_score) || (b.model_probability - a.model_probability) || marketKey(a).localeCompare(marketKey(b)));

  const primaryPool = candidates.filter((candidate) => !(
    candidate.marketFamily === 'DOUBLE_CHANCE_FULL_TIME' ||
    (candidate.marketFamily === 'TOTAL_GOALS_OVER_UNDER_FULL_TIME' && candidate.selection === 'UNDER' && candidate.line === 3.5) ||
    (['HOME_TEAM_OVER_UNDER_FULL_TIME', 'AWAY_TEAM_OVER_UNDER_FULL_TIME'].includes(candidate.marketFamily) && candidate.line === 0.5)
  ));
  const primary = primaryPool[0] ?? candidates[0] ?? null;
  const safer = primary
    ? candidates.find((candidate) =>
      marketKey(candidate) !== marketKey(primary) &&
      candidate.model_probability >= primary.model_probability &&
      candidate.probability_variance <= primary.probability_variance &&
      compatibleWithAll(distribution, candidate, [primary])) ?? null
    : null;
  const protectedRoles = [primary, safer].filter(Boolean);
  const secondary = primary
    ? candidates.find((candidate) =>
      !protectedRoles.some((item) => marketKey(item) === marketKey(candidate)) &&
      compatibleWithAll(distribution, candidate, protectedRoles)) ?? null
    : null;
  const cluster = Object.freeze([primary, secondary, safer].filter(Boolean));
  const matrix = buildMarketCompatibilityMatrix(distribution, candidates);
  const abstain = abstentionReasons(snapshot, conflictAudit, trapAudit);
  const decision = decisionFor(snapshot, conflictAudit, trapAudit, abstain);

  const result = {
    event_id: snapshot.event_id,
    evidence_snapshot_id: snapshot.evidence_snapshot_id,
    evidence_snapshot_fingerprint: snapshot.fingerprint,
    analysis_version: analysisVersion,
    feature_version: snapshot.feature_version,
    model_version: modelVersion,
    generated_at: snapshot.captured_at,
    primary_outcome: primary,
    secondary_outcome: secondary,
    safer_alternative: safer,
    compatible_outcome_cluster: cluster,
    model_probabilities: deepFreeze({
      home_win_probability: round(reasoning.matchReality.homeWin),
      draw_probability: round(reasoning.matchReality.draw),
      away_win_probability: round(reasoning.matchReality.awayWin),
      over15_probability: round(reasoning.matchReality.totals['1_5'].over),
      over25_probability: round(reasoning.matchReality.totals['2_5'].over),
      over35_probability: round(reasoning.matchReality.totals['3_5'].over),
      btts_yes_probability: round(reasoning.matchReality.bttsYes),
      btts_no_probability: round(reasoning.matchReality.bttsNo),
      home_clean_sheet_probability: round(reasoning.teamReality.home.cleanSheet),
      away_clean_sheet_probability: round(reasoning.teamReality.away.cleanSheet),
      expected_home_goals: homeLambda,
      expected_away_goals: awayLambda,
      score_distribution: distribution.rows
    }),
    supporting_evidence: evidenceSupport(snapshot),
    contradictory_evidence: Object.freeze(conflictAudit.conflicts.map((row) => row.code)),
    conflict_score: conflictAudit.conflictScore,
    evidence_completeness_score: snapshot.completeness_score,
    market_disagreement_score: trapAudit.market_disagreement_score,
    trap_flags: trapAudit.trap_flags,
    confidence,
    market_compatibility_rules: matrix,
    unsupported_markets: Object.freeze(unsupported),
    abstain_reasons: abstain,
    decision,
    governance: deepFreeze({
      evidenceLayerOnly: true,
      predictionIsNotValidationOrExecution: true,
      oddsAloneNeverDeterminePrediction: true,
      h2hCannotOverrideContextByItself: true,
      noPostKickoffEvidence: true,
      settlementSeparate: true,
      gateOwnershipUnchanged: true,
      capitalEffect: 'NONE',
      realMoney: 'NO',
      automaticPromotionOrRetuning: false
    })
  };
  return deepFreeze({ ...result, fingerprint: fingerprint(result) });
}
