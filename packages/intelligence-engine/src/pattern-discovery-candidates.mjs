import { createHash } from 'node:crypto';
import { verifyBehavioralStateFeatureCorpus, FROZEN_DISCOVERY_MIN_N } from './behavioral-state-features.mjs';

export const PATTERN_DISCOVERY_CANDIDATES_VERSION = 'PATTERN_DISCOVERY_CANDIDATES_V0_1';
export const DISCOVERY_EFFECT_FLOOR = 0.10;
export const DISCOVERY_CONTEXTS = Object.freeze(['ALL', 'HOME', 'AWAY']);

export const PREDECLARED_CANDIDATE_FAMILIES = Object.freeze([
  Object.freeze({ key: 'LEAD_SURRENDER_RATE', pattern_class: 'GAME_STATE', group: 'LEAD_BEHAVIOR', target: 'lead_surrendered', opportunity: 'led_at_any_time' }),
  Object.freeze({ key: 'POINTS_DROPPED_AFTER_LEADING_RATE', pattern_class: 'GAME_STATE', group: 'LEAD_BEHAVIOR', target: 'points_dropped_after_leading', opportunity: 'led_at_any_time' }),
  Object.freeze({ key: 'EQUALIZE_AFTER_TRAILING_RATE', pattern_class: 'GAME_STATE', group: 'TRAILING_RESPONSE', target: 'equalized_after_trailing', opportunity: 'trailed_at_any_time' }),
  Object.freeze({ key: 'WIN_AFTER_TRAILING_RATE', pattern_class: 'TEAM_BEHAVIOR', group: 'TRAILING_RESPONSE', target: 'recovered_win_after_trailing', opportunity: 'trailed_at_any_time' }),
  Object.freeze({ key: 'COMEBACK_GO_AHEAD_RATE', pattern_class: 'GAME_STATE', group: 'TRAILING_RESPONSE', target: 'comeback_go_ahead', opportunity: 'trailed_at_any_time' }),
  Object.freeze({ key: 'LATE_GOAL_SCORED_MATCH_RATE', pattern_class: 'TIME_SEGMENT', group: 'TEMPORAL_BEHAVIOR', target: 'late_goal_scored_n_gt_0', opportunity: 'MATCH' }),
  Object.freeze({ key: 'LATE_GOAL_CONCEDED_MATCH_RATE', pattern_class: 'TIME_SEGMENT', group: 'TEMPORAL_BEHAVIOR', target: 'late_goal_conceded_n_gt_0', opportunity: 'MATCH' }),
  Object.freeze({ key: 'OPENING_GOAL_SCORED_SHARE', pattern_class: 'GAME_STATE', group: 'OPENING_GOAL', target: 'opening_goal_scored', opportunity: 'opening_goal_observed' })
]);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function parseTimestamp(name, value) {
  const ms = Date.parse(value);
  if (!value || Number.isNaN(ms)) throw new Error(`${name}_INVALID_TIMESTAMP`);
  return ms;
}

function parseCutoff(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('TRAINING_CUTOFF_INVALID_DATE');
  const ms = Date.parse(`${value}T23:59:59.999Z`);
  if (Number.isNaN(ms)) throw new Error('TRAINING_CUTOFF_INVALID_DATE');
  return ms;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function wilson95(successN, opportunityN) {
  if (!Number.isInteger(successN) || !Number.isInteger(opportunityN) || successN < 0 || opportunityN < 0 || successN > opportunityN) {
    throw new Error('DISCOVERY_PROPORTION_COUNTS_INVALID');
  }
  if (opportunityN === 0) return null;
  const z = 1.959963984540054;
  const p = successN / opportunityN;
  const z2 = z * z;
  const denominator = 1 + z2 / opportunityN;
  const centre = (p + z2 / (2 * opportunityN)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) / opportunityN) + (z2 / (4 * opportunityN * opportunityN)))) / denominator;
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

function proportion(successN, opportunityN) {
  return {
    success_n: successN,
    opportunity_n: opportunityN,
    rate: opportunityN === 0 ? null : successN / opportunityN,
    wilson95: wilson95(successN, opportunityN)
  };
}

function differenceInterval(subject, reference) {
  if (!subject.wilson95 || !reference.wilson95) return null;
  return {
    method: 'NEWCOMBE_WILSON_CONSERVATIVE_DIFFERENCE_95',
    low: subject.wilson95.low - reference.wilson95.high,
    high: subject.wilson95.high - reference.wilson95.low
  };
}

function contextEligible(row, context) {
  if (context === 'ALL') return true;
  return row.venue_side === context;
}

function opportunityPredicate(definition, row) {
  switch (definition.opportunity) {
    case 'MATCH': return true;
    case 'led_at_any_time': return row.led_at_any_time === true;
    case 'trailed_at_any_time': return row.trailed_at_any_time === true;
    case 'opening_goal_observed': return row.opening_goal_observed === true;
    default: throw new Error('UNKNOWN_DISCOVERY_OPPORTUNITY');
  }
}

function successPredicate(definition, row) {
  switch (definition.target) {
    case 'lead_surrendered': return row.lead_surrendered === true;
    case 'points_dropped_after_leading': return row.points_dropped_after_leading === true;
    case 'equalized_after_trailing': return row.equalized_after_trailing === true;
    case 'recovered_win_after_trailing': return row.recovered_win_after_trailing === true;
    case 'comeback_go_ahead': return row.comeback_go_ahead === true;
    case 'late_goal_scored_n_gt_0': return Number(row.late_goal_scored_n) > 0;
    case 'late_goal_conceded_n_gt_0': return Number(row.late_goal_conceded_n) > 0;
    case 'opening_goal_scored': return row.opening_goal_scored === true;
    default: throw new Error('UNKNOWN_DISCOVERY_TARGET');
  }
}

function assertObservationStructure(rows) {
  const byMatch = new Map();
  for (const row of rows) {
    if (!row?.canonical_match_id || !row?.canonical_match_date || !row?.subject_team || !row?.opponent_team || !row?.league) {
      throw new Error('DISCOVERY_SOURCE_OBSERVATION_FIELDS_REQUIRED');
    }
    if (!['HOME', 'AWAY'].includes(row.venue_side)) throw new Error('DISCOVERY_SOURCE_VENUE_SIDE_INVALID');
    if (row.descriptive_only !== true || row.predictive_weight !== 0) throw new Error('STEP3_DESCRIPTIVE_BOUNDARY_VIOLATION');
    const list = byMatch.get(row.canonical_match_id) ?? [];
    list.push(row);
    byMatch.set(row.canonical_match_id, list);
  }
  for (const pair of byMatch.values()) {
    if (pair.length !== 2) throw new Error('STEP3_BOTH_SIDES_SOURCE_REQUIRED');
    const home = pair.find(row => row.venue_side === 'HOME');
    const away = pair.find(row => row.venue_side === 'AWAY');
    if (!home || !away) throw new Error('STEP3_HOME_AWAY_PAIR_REQUIRED');
    if (home.subject_team !== away.opponent_team || away.subject_team !== home.opponent_team) {
      throw new Error('STEP3_RECIPROCAL_OPPONENT_IDENTITY_REQUIRED');
    }
    if (home.league !== away.league || home.canonical_match_date !== away.canonical_match_date) {
      throw new Error('STEP3_MATCH_CONTEXT_PAIR_MISMATCH');
    }
  }
}

function evaluateMetric(definition, subjectRows, referenceRows) {
  const subjectOpportunities = subjectRows.filter(row => opportunityPredicate(definition, row));
  const referenceOpportunities = referenceRows.filter(row => opportunityPredicate(definition, row));
  const subjectSuccess = subjectOpportunities.filter(row => successPredicate(definition, row)).length;
  const referenceSuccess = referenceOpportunities.filter(row => successPredicate(definition, row)).length;
  const subject = proportion(subjectSuccess, subjectOpportunities.length);
  const reference = proportion(referenceSuccess, referenceOpportunities.length);
  const effect = subject.rate === null || reference.rate === null ? null : subject.rate - reference.rate;
  const uncertainty = differenceInterval(subject, reference);
  return { subject, reference, effect, uncertainty };
}

function evaluationStatus({ subjectMatchN, metric }) {
  if (subjectMatchN < FROZEN_DISCOVERY_MIN_N) return 'INSUFFICIENT_SUBJECT_MATCH_N';
  if (metric.subject.opportunity_n < FROZEN_DISCOVERY_MIN_N) return 'INSUFFICIENT_SUBJECT_OPPORTUNITY_N';
  if (metric.reference.opportunity_n < FROZEN_DISCOVERY_MIN_N) return 'INSUFFICIENT_REFERENCE_OPPORTUNITY_N';
  if (metric.effect === null || Math.abs(metric.effect) < DISCOVERY_EFFECT_FLOOR) return 'EFFECT_BELOW_DISCOVERY_FLOOR';
  if (!metric.uncertainty || (metric.uncertainty.low <= 0 && metric.uncertainty.high >= 0)) return 'UNCERTAINTY_OVERLAPS_ZERO';
  return 'CANDIDATE';
}

function candidateFromEvaluation({ definition, team, league, context, discoveredAt, trainingCutoff, subjectRows, referenceRows, metric, evaluationId, corpus }) {
  const direction = metric.effect > 0 ? 'HIGHER_THAN_REFERENCE' : 'LOWER_THAN_REFERENCE';
  const subjectMatchIds = uniqueSorted(subjectRows.map(row => row.canonical_match_id));
  const referenceMatchIds = uniqueSorted(referenceRows.map(row => row.canonical_match_id));
  const overlap = subjectMatchIds.filter(id => referenceMatchIds.includes(id));
  if (overlap.length) throw new Error('DISCOVERY_REFERENCE_DIRECT_MATCH_OVERLAP_FORBIDDEN');
  const payload = {
    pattern_id: `PATTERN-${sha256({ version: PATTERN_DISCOVERY_CANDIDATES_VERSION, team, league, context, key: definition.key, trainingCutoff }).slice(0, 24)}`,
    pattern_version: PATTERN_DISCOVERY_CANDIDATES_VERSION,
    pattern_class: definition.pattern_class,
    hypothesis: `${team} shows a ${direction === 'HIGHER_THAN_REFERENCE' ? 'higher' : 'lower'} ${definition.key} than independent ${league} reference-team observations within the frozen discovery sample.`,
    target_definition: {
      metric_key: definition.key,
      success_definition: definition.target,
      opportunity_definition: definition.opportunity,
      direction
    },
    feature_definition: {
      source: 'BEHAVIORAL_STATE_FEATURES_V0_1_OBSERVATIONS',
      group: definition.group,
      context,
      effect_floor_absolute: DISCOVERY_EFFECT_FLOOR,
      uncertainty_method: 'NEWCOMBE_WILSON_CONSERVATIVE_DIFFERENCE_95'
    },
    scope: { subject_team: team, league, venue_context: context },
    discovered_at: discoveredAt,
    training_cutoff: trainingCutoff,
    sample_n: metric.subject.opportunity_n,
    subject_match_n: subjectMatchIds.length,
    reference_match_n: referenceMatchIds.length,
    source_lineage: {
      corpus_version: corpus.corpus_version,
      corpus_fingerprint: corpus.corpus_fingerprint,
      subject_observation_fingerprints: subjectRows.map(row => row.observation_fingerprint).sort(),
      reference_observation_fingerprints: referenceRows.map(row => row.observation_fingerprint).sort(),
      discovery_match_ids: subjectMatchIds,
      reference_match_ids: referenceMatchIds,
      direct_match_overlap_n: 0,
      evaluation_id: evaluationId
    },
    state: 'CANDIDATE',
    effect_estimate: {
      measure: 'ABSOLUTE_PROPORTION_DIFFERENCE',
      subject_rate: metric.subject.rate,
      reference_rate: metric.reference.rate,
      difference: metric.effect,
      difference_pp: metric.effect * 100
    },
    uncertainty: metric.uncertainty,
    baseline_comparison: {
      reference_definition: 'SAME_LEAGUE_SAME_VENUE_CONTEXT_OTHER_TEAMS_EXCLUDING_ALL_DIRECT_SUBJECT_MATCHES',
      subject: metric.subject,
      reference: metric.reference,
      direct_subject_match_rows_excluded: true
    },
    out_of_sample_result: 'NOT_RUN_STEP_4',
    forward_result: 'NOT_RUN_STEP_4',
    temporal_stability: 'NOT_TESTED_STEP_4',
    failure_modes: [
      'DISCOVERY_SELECTION_BIAS_REQUIRES_HOLDOUT',
      'MULTIPLE_TESTING_REQUIRES_CONFIRMATORY_CONTROL',
      'MATCH_LEVEL_CLUSTER_DEPENDENCE_NOT_CONFIRMATORY_TESTED',
      'OPPONENT_AND_SEASON_GENERALIZATION_NOT_YET_VALIDATED',
      'OBSERVATIONAL_PATTERN_IS_NOT_CAUSAL_CLAIM'
    ],
    lifecycle: {
      current_state: 'CANDIDATE',
      minimum_n_met: true,
      next_allowed_state: 'MIN_N_MET',
      automatic_transition: false,
      validation_complete: false
    },
    evidence_graph_bridge: {
      node_id: null,
      source_verified: true,
      pattern_validated: false,
      decision_weight: 0,
      decision_eligible: false
    },
    governed_learning_bridge: {
      auto_apply: false,
      production_mutation_allowed: false,
      decision_weight_change: 'NO_CHANGE'
    },
    governance: {
      discovery_is_validation: false,
      evidence_maturity_is_probability: false,
      market_data_used: false,
      predictive_weight: 0,
      automatic_retuning: false,
      automatic_pattern_promotion: false,
      p002_changed: false,
      gate1_to_gate6_ownership_changed: false,
      capital_effect: 'NONE',
      real_money: 'NO'
    }
  };
  payload.evidence_graph_bridge.node_id = `EVIDENCE-${payload.pattern_id}`;
  return deepFreeze({ ...payload, candidate_fingerprint: sha256(payload) });
}

export function discoverPatternCandidates({ corpus, discoveredAt, trainingCutoff }) {
  verifyBehavioralStateFeatureCorpus(corpus);
  const discoveredMs = parseTimestamp('DISCOVERED_AT', discoveredAt);
  const cutoffMs = parseCutoff(trainingCutoff);
  const corpusMs = parseTimestamp('CORPUS_MATERIALIZED_AT', corpus.materialized_at);
  if (discoveredMs < corpusMs) throw new Error('DISCOVERY_BEFORE_CORPUS_MATERIALIZATION_FORBIDDEN');
  if (discoveredMs <= cutoffMs) throw new Error('DISCOVERY_TIMESTAMP_MUST_FOLLOW_TRAINING_CUTOFF');
  if (corpus.governance?.market_data_used !== false) throw new Error('MARKET_DERIVED_BEHAVIORAL_TRUTH_FORBIDDEN');
  if (corpus.governance?.p002_discovery_min_n !== FROZEN_DISCOVERY_MIN_N) throw new Error('P002_DISCOVERY_MIN_N_DRIFT');

  assertObservationStructure(corpus.observations ?? []);
  const cutoffRows = (corpus.observations ?? []).filter(row => parseCutoff(row.canonical_match_date) <= cutoffMs);
  const excludedPostCutoffRows = (corpus.observations ?? []).length - cutoffRows.length;
  const leagues = uniqueSorted(cutoffRows.map(row => row.league));
  const teams = uniqueSorted(cutoffRows.map(row => row.subject_team));
  const evaluations = [];
  const candidates = [];

  for (const league of leagues) {
    const leagueRows = cutoffRows.filter(row => row.league === league);
    for (const team of teams) {
      const teamLeagueRows = leagueRows.filter(row => row.subject_team === team);
      if (!teamLeagueRows.length) continue;
      const allTeamMatchIds = new Set(teamLeagueRows.map(row => row.canonical_match_id));
      for (const context of DISCOVERY_CONTEXTS) {
        const subjectRows = teamLeagueRows.filter(row => contextEligible(row, context));
        const referenceRows = leagueRows.filter(row => row.subject_team !== team && !allTeamMatchIds.has(row.canonical_match_id) && contextEligible(row, context));
        for (const definition of PREDECLARED_CANDIDATE_FAMILIES) {
          const metric = evaluateMetric(definition, subjectRows, referenceRows);
          const status = evaluationStatus({ subjectMatchN: subjectRows.length, metric });
          const evaluationPayload = {
            version: PATTERN_DISCOVERY_CANDIDATES_VERSION,
            team,
            league,
            context,
            candidate_family: definition.key,
            pattern_class: definition.pattern_class,
            training_cutoff: trainingCutoff,
            subject_match_n: subjectRows.length,
            reference_match_n: uniqueSorted(referenceRows.map(row => row.canonical_match_id)).length,
            subject: metric.subject,
            reference: metric.reference,
            effect_estimate: metric.effect,
            effect_pp: metric.effect === null ? null : metric.effect * 100,
            uncertainty: metric.uncertainty,
            effect_floor_absolute: DISCOVERY_EFFECT_FLOOR,
            discovery_min_n: FROZEN_DISCOVERY_MIN_N,
            status,
            decision_weight: 0
          };
          const evaluation = deepFreeze({ ...evaluationPayload, evaluation_fingerprint: sha256(evaluationPayload) });
          evaluations.push(evaluation);
          if (status === 'CANDIDATE') {
            candidates.push(candidateFromEvaluation({
              definition,
              team,
              league,
              context,
              discoveredAt,
              trainingCutoff,
              subjectRows,
              referenceRows,
              metric,
              evaluationId: evaluation.evaluation_fingerprint,
              corpus
            }));
          }
        }
      }
    }
  }

  candidates.sort((a, b) => a.pattern_id.localeCompare(b.pattern_id));
  evaluations.sort((a, b) => `${a.team}|${a.league}|${a.context}|${a.candidate_family}`.localeCompare(`${b.team}|${b.league}|${b.context}|${b.candidate_family}`));
  const definitionsFingerprint = sha256(PREDECLARED_CANDIDATE_FAMILIES);
  const payload = {
    discovery_version: PATTERN_DISCOVERY_CANDIDATES_VERSION,
    discovered_at: discoveredAt,
    training_cutoff: trainingCutoff,
    source_corpus_version: corpus.corpus_version,
    source_corpus_fingerprint: corpus.corpus_fingerprint,
    predeclared_candidate_definitions_fingerprint: definitionsFingerprint,
    discovery_min_n: FROZEN_DISCOVERY_MIN_N,
    effect_floor_absolute: DISCOVERY_EFFECT_FLOOR,
    context_scopes: [...DISCOVERY_CONTEXTS],
    candidate_family_n: PREDECLARED_CANDIDATE_FAMILIES.length,
    cutoff_team_observation_n: cutoffRows.length,
    excluded_post_cutoff_observation_n: excludedPostCutoffRows,
    evaluation_n: evaluations.length,
    candidate_n: candidates.length,
    evaluations,
    candidates,
    multiple_testing_ledger: {
      exploratory_comparison_n: evaluations.length,
      predeclared_family_n: PREDECLARED_CANDIDATE_FAMILIES.length,
      context_scope_n: DISCOVERY_CONTEXTS.length,
      confirmatory_alpha_spent: false,
      p_values_used_for_validation: false,
      correction_deferred_to_confirmatory_stage: true,
      candidate_selection_must_not_be_reused_as_confirmatory_evidence: true
    },
    holdout_boundary: {
      discovery_cutoff_frozen: true,
      observations_after_training_cutoff_used: false,
      future_confirmatory_sample_must_be_disjoint: true,
      candidate_definition_must_freeze_before_confirmatory_test: true
    },
    existing_intelligence_bridge: {
      evidence_graph_node_supported: true,
      target_existing_domain: 'TEMPORAL_SCORING_DEFENDING',
      automatic_signal_injection: false,
      automatic_impact_assignment: false,
      decision_weight: 0
    },
    governance: {
      pattern_discovery_performed: true,
      pattern_validation_performed: false,
      discovery_is_validation: false,
      market_data_used: false,
      bookmaker_data_used_as_feature_truth: false,
      predictive_weight_assigned: false,
      automatic_retuning: false,
      automatic_pattern_promotion: false,
      p002_changed: false,
      gate1_to_gate6_ownership_changed: false,
      capital_effect: 'NONE',
      real_money: 'NO'
    },
    next_stage: 'STEP_5_PATTERN_CANDIDATE_CONFIRMATORY_FREEZE'
  };
  return deepFreeze({ ...payload, discovery_fingerprint: sha256(payload) });
}

export function patternCandidateEvidenceNode(candidate) {
  if (!candidate || candidate.pattern_version !== PATTERN_DISCOVERY_CANDIDATES_VERSION) throw new Error('PATTERN_CANDIDATE_VERSION_INVALID');
  return Object.freeze({
    id: candidate.evidence_graph_bridge.node_id,
    type: 'PATTERN_DISCOVERY_CANDIDATE',
    verified: false,
    sourceVerified: candidate.evidence_graph_bridge.source_verified === true,
    patternValidated: false,
    decisionWeight: 0,
    critical: false,
    patternId: candidate.pattern_id,
    fingerprint: candidate.candidate_fingerprint
  });
}

export function verifyPatternDiscoveryBatch(batch) {
  if (!batch || batch.discovery_version !== PATTERN_DISCOVERY_CANDIDATES_VERSION) throw new Error('PATTERN_DISCOVERY_BATCH_VERSION_INVALID');
  if (batch.discovery_min_n !== FROZEN_DISCOVERY_MIN_N) throw new Error('PATTERN_DISCOVERY_MIN_N_INVALID');
  if (batch.effect_floor_absolute !== DISCOVERY_EFFECT_FLOOR) throw new Error('PATTERN_DISCOVERY_EFFECT_FLOOR_INVALID');
  if (batch.governance?.pattern_validation_performed !== false) throw new Error('STEP4_PATTERN_VALIDATION_FORBIDDEN');
  if (batch.governance?.predictive_weight_assigned !== false) throw new Error('STEP4_PREDICTIVE_WEIGHT_FORBIDDEN');
  if (batch.governance?.p002_changed !== false) throw new Error('STEP4_P002_MUTATION_FORBIDDEN');
  if (batch.multiple_testing_ledger?.confirmatory_alpha_spent !== false) throw new Error('STEP4_CONFIRMATORY_ALPHA_SPEND_FORBIDDEN');
  if (batch.holdout_boundary?.observations_after_training_cutoff_used !== false) throw new Error('STEP4_POST_CUTOFF_USAGE_FORBIDDEN');

  for (const evaluation of batch.evaluations ?? []) {
    const { evaluation_fingerprint, ...payload } = evaluation;
    if (sha256(payload) !== evaluation_fingerprint) throw new Error('PATTERN_DISCOVERY_EVALUATION_FINGERPRINT_INVALID');
    if (evaluation.decision_weight !== 0) throw new Error('STEP4_EVALUATION_DECISION_WEIGHT_FORBIDDEN');
  }
  for (const candidate of batch.candidates ?? []) {
    const { candidate_fingerprint, ...payload } = candidate;
    if (sha256(payload) !== candidate_fingerprint) throw new Error('PATTERN_CANDIDATE_FINGERPRINT_INVALID');
    if (candidate.state !== 'CANDIDATE') throw new Error('STEP4_CANDIDATE_STATE_INVALID');
    if (candidate.sample_n < FROZEN_DISCOVERY_MIN_N) throw new Error('STEP4_CANDIDATE_MIN_N_NOT_MET');
    if (candidate.baseline_comparison?.reference?.opportunity_n < FROZEN_DISCOVERY_MIN_N) throw new Error('STEP4_REFERENCE_MIN_N_NOT_MET');
    if (Math.abs(candidate.effect_estimate?.difference ?? 0) < DISCOVERY_EFFECT_FLOOR) throw new Error('STEP4_CANDIDATE_EFFECT_FLOOR_NOT_MET');
    const interval = candidate.uncertainty;
    if (!interval || (interval.low <= 0 && interval.high >= 0)) throw new Error('STEP4_CANDIDATE_UNCERTAINTY_NOT_SEPARATED');
    if (candidate.source_lineage?.direct_match_overlap_n !== 0) throw new Error('STEP4_REFERENCE_MATCH_OVERLAP_FORBIDDEN');
    if (candidate.governance?.predictive_weight !== 0) throw new Error('STEP4_CANDIDATE_DECISION_WEIGHT_FORBIDDEN');
    if (candidate.out_of_sample_result !== 'NOT_RUN_STEP_4' || candidate.forward_result !== 'NOT_RUN_STEP_4') {
      throw new Error('STEP4_CONFIRMATORY_RESULT_FABRICATION_FORBIDDEN');
    }
  }
  const { discovery_fingerprint, ...payload } = batch;
  if (sha256(payload) !== discovery_fingerprint) throw new Error('PATTERN_DISCOVERY_BATCH_FINGERPRINT_INVALID');
  return true;
}
