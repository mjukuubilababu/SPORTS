import { createHash } from 'node:crypto';

export const MATCH_MEMORY_VERSION = 'CANONICAL_MATCH_MEMORY_V0_1';
export const STEP_2_TIMELINE_STATE = 'STEP_2_PENDING';

function assertNonEmpty(name, value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name}_REQUIRED`);
}

function assertScore(name, value) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name}_INVALID`);
}

function parseTimestamp(name, value) {
  assertNonEmpty(name, value);
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new Error(`${name}_INVALID`);
  return epoch;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

export function classifyFinalOutcome(homeScore, awayScore) {
  assertScore('HOME_SCORE', homeScore);
  assertScore('AWAY_SCORE', awayScore);
  if (homeScore > awayScore) return 'HOME_WIN';
  if (homeScore < awayScore) return 'AWAY_WIN';
  return 'DRAW';
}

function normalizeIdentity(record) {
  assertNonEmpty('MATCH_ID', record?.match_id);
  assertNonEmpty('CANONICAL_MATCH_DATE', record?.canonical_match_date);
  if (!Number.isInteger(record?.season)) throw new Error('SEASON_INVALID');
  assertNonEmpty('LEAGUE', record?.league);
  assertNonEmpty('HOME_TEAM', record?.home_team);
  assertNonEmpty('AWAY_TEAM', record?.away_team);
  return {
    match_id: record.match_id,
    canonical_match_date: record.canonical_match_date,
    canonical_date_policy: record.canonical_date_policy ?? null,
    season: record.season,
    league: record.league,
    home_team: record.home_team,
    away_team: record.away_team
  };
}

function normalizeResultProvenance(record) {
  const result = record?.result ?? {};
  const verified = result.verified === true;
  if (verified) {
    assertNonEmpty('RESULT_SOURCE', result.source);
    assertNonEmpty('RESULT_SOURCE_URL', result.source_url);
  }
  return {
    verification_method: result.verification_method ?? null,
    source: result.source ?? null,
    source_url: result.source_url ?? null,
    source_match_date: result.source_match_date ?? null,
    crosscheck: clone(result.crosscheck ?? null),
    supporting_result_sources: clone(record.supporting_result_sources ?? []),
    duplicate_observations: Number.isInteger(record.duplicate_observations) ? record.duplicate_observations : 0
  };
}

function normalizeTruth(record, identity) {
  const score = record?.final_score ?? {};
  assertScore('HOME_SCORE', score.home);
  assertScore('AWAY_SCORE', score.away);
  const actualOutcome = classifyFinalOutcome(score.home, score.away);
  const provenance = normalizeResultProvenance(record);
  const truthCore = {
    match_id: identity.match_id,
    status: record.status ?? 'UNKNOWN',
    verified: record?.result?.verified === true,
    final_score: { home: score.home, away: score.away },
    actual_outcome: actualOutcome,
    total_goals: score.home + score.away,
    both_teams_scored: score.home > 0 && score.away > 0,
    home_team_scored: score.home > 0,
    away_team_scored: score.away > 0,
    result_provenance: provenance,
    gate2_backfill_eligible: record.gate2_backfill_eligible === true,
    gate1_validation_n_eligible: record.gate1_validation_n_eligible === true,
    reasons: clone(record.reasons ?? [])
  };
  return { ...truthCore, truth_fingerprint: fingerprint(truthCore) };
}

function normalizeObservation(observation, eventId, predictionCutoffEpoch) {
  const required = [
    'observation_id', 'event_id', 'entity_type', 'entity_id', 'observation_type',
    'observed_at', 'available_at', 'source', 'source_type', 'provenance_id'
  ];
  for (const field of required) assertNonEmpty(`OBSERVATION_${field.toUpperCase()}`, observation?.[field]);
  if (observation.event_id !== eventId) throw new Error('OBSERVATION_EVENT_ID_MISMATCH');
  if (typeof observation.is_verified !== 'boolean') throw new Error('OBSERVATION_IS_VERIFIED_REQUIRED');
  if (!Object.prototype.hasOwnProperty.call(observation, 'value')) throw new Error('OBSERVATION_VALUE_REQUIRED');
  const observedEpoch = parseTimestamp('OBSERVATION_OBSERVED_AT', observation.observed_at);
  const availableEpoch = parseTimestamp('OBSERVATION_AVAILABLE_AT', observation.available_at);
  if (availableEpoch < observedEpoch) throw new Error('OBSERVATION_AVAILABLE_BEFORE_OBSERVED');
  const preMatchEligible = predictionCutoffEpoch === null
    ? false
    : Boolean(observation.is_verified && availableEpoch <= predictionCutoffEpoch);
  return {
    ...clone(observation),
    pre_match_eligible: preMatchEligible,
    pre_match_eligibility_reason: predictionCutoffEpoch === null
      ? 'PREDICTION_CUTOFF_NOT_SUPPLIED'
      : preMatchEligible
        ? 'VERIFIED_AVAILABLE_BY_CUTOFF'
        : observation.is_verified !== true
          ? 'OBSERVATION_NOT_VERIFIED'
          : 'AVAILABLE_AFTER_CUTOFF'
  };
}

function normalizeMarketSnapshot(snapshot, eventId, predictionCutoffEpoch) {
  const event = snapshot?.event_id ?? snapshot?.eventId ?? eventId;
  if (event !== eventId) throw new Error('MARKET_SNAPSHOT_EVENT_ID_MISMATCH');
  const observedAt = snapshot?.observed_at ?? snapshot?.observedAt ?? null;
  let observedEpoch = null;
  if (observedAt !== null) observedEpoch = parseTimestamp('MARKET_OBSERVED_AT', observedAt);
  const verified = snapshot?.is_verified === true || snapshot?.status === 'ACCEPTED';
  const snapshotCore = {
    event_id: eventId,
    provider: snapshot?.provider ?? null,
    source: snapshot?.source ?? null,
    source_url: snapshot?.source_url ?? snapshot?.sourceUrl ?? null,
    observed_at: observedAt,
    quote_type: snapshot?.quote_type ?? snapshot?.quoteType ?? null,
    status: snapshot?.status ?? (verified ? 'ACCEPTED' : 'UNKNOWN'),
    is_verified: verified,
    market: snapshot?.market ?? null,
    selection: snapshot?.selection ?? null,
    prices: clone(snapshot?.prices ?? {
      o25: snapshot?.o25 ?? null,
      u25: snapshot?.u25 ?? null,
      o35: snapshot?.o35 ?? null,
      u35: snapshot?.u35 ?? null
    }),
    source_payload_fingerprint: fingerprint(clone(snapshot))
  };
  const preMatchEligible = predictionCutoffEpoch !== null
    && observedEpoch !== null
    && verified
    && observedEpoch <= predictionCutoffEpoch;
  return {
    ...snapshotCore,
    snapshot_id: snapshot?.snapshot_id ?? `MARKET-${fingerprint(snapshotCore).slice(0, 24)}`,
    pre_match_eligible: preMatchEligible,
    pre_match_eligibility_reason: predictionCutoffEpoch === null
      ? 'PREDICTION_CUTOFF_NOT_SUPPLIED'
      : observedEpoch === null
        ? 'OBSERVED_AT_MISSING_NOT_GUESSED'
        : !verified
          ? 'MARKET_NOT_VERIFIED'
          : preMatchEligible
            ? 'VERIFIED_OBSERVED_BY_CUTOFF'
            : 'OBSERVED_AFTER_CUTOFF'
  };
}

function marketFromTruthRecord(record) {
  const market = record?.market;
  if (!market || market.status === 'MISSING') return null;
  return {
    event_id: record.match_id,
    provider: market.provider ?? null,
    source: market.source ?? null,
    source_url: market.source_url ?? null,
    observed_at: market.observed_at ?? null,
    quote_type: market.quote_type ?? null,
    status: market.status ?? 'UNKNOWN',
    is_verified: market.status === 'ACCEPTED',
    market: 'GATE1_HISTORICAL_MARKET',
    selection: null,
    prices: {
      o25: market.o25 ?? null,
      u25: market.u25 ?? null,
      o35: market.o35 ?? null,
      u35: market.u35 ?? null
    }
  };
}

function normalizeSettlement(settlement, eventId) {
  const settlementEventId = settlement?.event_id ?? settlement?.eventId;
  if (settlementEventId !== eventId) throw new Error('SETTLEMENT_EVENT_ID_MISMATCH');
  const settledAt = settlement?.settled_at ?? settlement?.settledAt ?? null;
  if (settledAt !== null) parseTimestamp('SETTLED_AT', settledAt);
  const result = settlement?.result ?? settlement?.outcome ?? null;
  assertNonEmpty('SETTLEMENT_RESULT', result);
  const sourceSignalId = settlement?.source_signal_id ?? settlement?.sourceSignalId ?? settlement?.prediction_id ?? null;
  const normalizedCore = {
    event_id: eventId,
    source_signal_id: sourceSignalId,
    source_snapshot_type: settlement?.source_snapshot_type ?? settlement?.sourceSnapshotType ?? null,
    market: settlement?.market ?? null,
    selection: settlement?.selection ?? settlement?.predictedOutcome ?? null,
    result,
    prediction_correct: typeof settlement?.prediction_correct === 'boolean'
      ? settlement.prediction_correct
      : typeof settlement?.predictionCorrect === 'boolean'
        ? settlement.predictionCorrect
        : null,
    actual_outcome: settlement?.actual_outcome ?? settlement?.actualOutcome ?? null,
    predicted_outcome: settlement?.predicted_outcome ?? settlement?.predictedOutcome ?? null,
    final_score: clone(settlement?.final_score ?? settlement?.finalScore ?? null),
    brier_score: settlement?.brier_score ?? settlement?.brierScore ?? null,
    log_loss: settlement?.log_loss ?? settlement?.logLoss ?? null,
    settled_at: settledAt,
    no_hindsight: settlement?.no_hindsight ?? settlement?.noHindsight ?? null,
    source_payload: clone(settlement),
    source_payload_fingerprint: fingerprint(clone(settlement))
  };
  return {
    ...normalizedCore,
    settlement_id: settlement?.settlement_id ?? `SETTLEMENT-${fingerprint(normalizedCore).slice(0, 24)}`
  };
}

function assertUnique(items, key, errorCode) {
  const seen = new Set();
  for (const item of items) {
    const value = item[key];
    if (seen.has(value)) throw new Error(errorCode);
    seen.add(value);
  }
}

export function buildCanonicalMatchMemory({
  truthRecord,
  observations = [],
  marketSnapshots = [],
  predictionSettlements = [],
  predictionCutoff = null,
  materializedAt
}) {
  if (!truthRecord || typeof truthRecord !== 'object') throw new Error('GATE1_TRUTH_RECORD_REQUIRED');
  if (!Array.isArray(observations)) throw new Error('OBSERVATIONS_ARRAY_REQUIRED');
  if (!Array.isArray(marketSnapshots)) throw new Error('MARKET_SNAPSHOTS_ARRAY_REQUIRED');
  if (!Array.isArray(predictionSettlements)) throw new Error('PREDICTION_SETTLEMENTS_ARRAY_REQUIRED');
  parseTimestamp('MATERIALIZED_AT', materializedAt);
  const predictionCutoffEpoch = predictionCutoff === null ? null : parseTimestamp('PREDICTION_CUTOFF', predictionCutoff);

  const sourceRecordFingerprint = fingerprint(clone(truthRecord));
  const identity = normalizeIdentity(truthRecord);
  const truth = normalizeTruth(truthRecord, identity);

  const normalizedObservations = observations.map(item => normalizeObservation(item, identity.match_id, predictionCutoffEpoch));
  assertUnique(normalizedObservations, 'observation_id', 'DUPLICATE_OBSERVATION_ID');

  const suppliedMarkets = marketSnapshots.map(item => normalizeMarketSnapshot(item, identity.match_id, predictionCutoffEpoch));
  const truthMarket = marketFromTruthRecord(truthRecord);
  const normalizedMarkets = truthMarket
    ? [normalizeMarketSnapshot(truthMarket, identity.match_id, predictionCutoffEpoch), ...suppliedMarkets]
    : suppliedMarkets;
  assertUnique(normalizedMarkets, 'snapshot_id', 'DUPLICATE_MARKET_SNAPSHOT_ID');

  const normalizedSettlements = predictionSettlements.map(item => normalizeSettlement(item, identity.match_id));
  assertUnique(normalizedSettlements, 'settlement_id', 'DUPLICATE_SETTLEMENT_ID');

  const patternTruthEligible = truth.verified === true && truth.status === 'ACCEPTED';
  const evidence = {
    observations: normalizedObservations,
    market_snapshots: normalizedMarkets,
    prediction_settlements: normalizedSettlements
  };
  const learning = {
    retain_for_learning: true,
    pattern_truth_eligible: patternTruthEligible,
    truth_decision_weight: patternTruthEligible ? 'NOT_ASSIGNED_AT_MEMORY_LAYER' : 0,
    correct_prediction_n: normalizedSettlements.filter(x => x.prediction_correct === true || x.result === 'CORRECT' || x.result === 'WIN').length,
    incorrect_prediction_n: normalizedSettlements.filter(x => x.prediction_correct === false || x.result === 'INCORRECT' || x.result === 'LOSS').length,
    outcome_based_deletion_forbidden: true,
    prediction_error_is_learning_evidence: true,
    pre_match_influence_requires_cutoff_eligibility: true,
    missing_timestamp_guessing_forbidden: true,
    pattern_discovery_performed_here: false,
    pattern_validation_performed_here: false
  };
  const timeline = {
    state: STEP_2_TIMELINE_STATE,
    minute_by_minute_events_materialized: false,
    reason: 'GAME_STATE_TIMELINE_BELONGS_TO_STEP_2'
  };
  const governance = {
    authoritative_truth_owner: 'GATE1',
    memory_role: 'DERIVED_IMMUTABLE_MATERIALIZED_VIEW',
    source_truth_record_fingerprint: sourceRecordFingerprint,
    source_truth_record_mutated: false,
    prediction_validation_execution_separate: true,
    no_hindsight: true,
    market_to_model_circularity_forbidden: true,
    automatic_retuning: false,
    automatic_pattern_promotion: false,
    p002_changed: false,
    gate1_to_gate6_ownership_changed: false,
    capital_effect: 'NONE',
    real_money: 'NO'
  };

  const fingerprintPayload = {
    memory_version: MATCH_MEMORY_VERSION,
    identity,
    truth,
    evidence,
    learning,
    timeline,
    governance
  };
  const memory = {
    memory_version: MATCH_MEMORY_VERSION,
    memory_id: `MATCH-MEMORY-${fingerprint({ version: MATCH_MEMORY_VERSION, match_id: identity.match_id }).slice(0, 24)}`,
    materialized_at: materializedAt,
    prediction_cutoff: predictionCutoff,
    identity,
    truth,
    evidence,
    learning,
    timeline,
    governance,
    memory_fingerprint: fingerprint(fingerprintPayload)
  };
  return deepFreeze(memory);
}

export function verifyCanonicalMatchMemory(memory) {
  if (!memory || memory.memory_version !== MATCH_MEMORY_VERSION) throw new Error('MATCH_MEMORY_VERSION_INVALID');
  if (!memory.identity || !memory.truth || !memory.evidence || !memory.learning || !memory.timeline || !memory.governance) {
    throw new Error('MATCH_MEMORY_SECTION_MISSING');
  }
  if (memory.timeline.state !== STEP_2_TIMELINE_STATE || memory.timeline.minute_by_minute_events_materialized !== false) {
    throw new Error('STEP_1_TIMELINE_BOUNDARY_VIOLATION');
  }
  if (memory.governance.authoritative_truth_owner !== 'GATE1') throw new Error('GATE1_TRUTH_OWNERSHIP_VIOLATION');
  if (memory.governance.p002_changed !== false) throw new Error('P002_MUTATION_FORBIDDEN');
  const expectedTruth = fingerprint({
    match_id: memory.identity.match_id,
    status: memory.truth.status,
    verified: memory.truth.verified,
    final_score: memory.truth.final_score,
    actual_outcome: memory.truth.actual_outcome,
    total_goals: memory.truth.total_goals,
    both_teams_scored: memory.truth.both_teams_scored,
    home_team_scored: memory.truth.home_team_scored,
    away_team_scored: memory.truth.away_team_scored,
    result_provenance: memory.truth.result_provenance,
    gate2_backfill_eligible: memory.truth.gate2_backfill_eligible,
    gate1_validation_n_eligible: memory.truth.gate1_validation_n_eligible,
    reasons: memory.truth.reasons
  });
  if (expectedTruth !== memory.truth.truth_fingerprint) throw new Error('TRUTH_FINGERPRINT_INVALID');
  const expectedMemory = fingerprint({
    memory_version: memory.memory_version,
    identity: memory.identity,
    truth: memory.truth,
    evidence: memory.evidence,
    learning: memory.learning,
    timeline: memory.timeline,
    governance: memory.governance
  });
  if (expectedMemory !== memory.memory_fingerprint) throw new Error('MEMORY_FINGERPRINT_INVALID');
  return true;
}
