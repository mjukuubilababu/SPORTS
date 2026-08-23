import { TEAM_MATCH_INTELLIGENCE_DOMAINS, deriveTeamMatchSignals } from './team-match-feature-signals.mjs';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseTime(value, name) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${name}_INVALID_TIMESTAMP`);
  return ms;
}

function validateSignal(signal) {
  if (!signal?.id || !signal?.domain) throw new Error('SIGNAL_ID_AND_DOMAIN_REQUIRED');
  if (!TEAM_MATCH_INTELLIGENCE_DOMAINS.includes(signal.domain)) throw new Error('UNKNOWN_TEAM_MATCH_DOMAIN');
  if (!Number.isFinite(signal.impact) || signal.impact < -1 || signal.impact > 1) throw new Error('SIGNAL_IMPACT_INVALID');
  if (!Number.isFinite(signal.confidence) || signal.confidence < 0 || signal.confidence > 1) throw new Error('SIGNAL_CONFIDENCE_INVALID');
  if (!Number.isInteger(signal.sampleSize) || signal.sampleSize < 0) throw new Error('SIGNAL_SAMPLE_SIZE_INVALID');
  if (!signal.source || !signal.observedAt) throw new Error('SIGNAL_PROVENANCE_REQUIRED');
  if (!signal.correlationGroup) throw new Error('SIGNAL_CORRELATION_GROUP_REQUIRED');
}

function freshnessFactor(signal, asOfMs, maxAgeDays) {
  const observedMs = parseTime(signal.observedAt, 'SIGNAL_OBSERVED_AT');
  const ageDays = Math.max(0, (asOfMs - observedMs) / 86400000);
  if (ageDays > maxAgeDays) return { ageDays, factor: 0 };
  return { ageDays, factor: 1 - (ageDays / maxAgeDays) * 0.5 };
}

function groupWithinDomain(signals, asOfMs, minimumSample, maxAgeDays) {
  const groups = new Map();
  for (const signal of signals) {
    validateSignal(signal);
    const freshness = freshnessFactor(signal, asOfMs, maxAgeDays);
    const eligible = signal.verified === true && signal.sampleSize >= minimumSample && freshness.factor > 0;
    const sampleFactor = eligible ? clamp(signal.sampleSize / Math.max(minimumSample, 1), 0, 1) : 0;
    const effectiveWeight = eligible ? signal.confidence * sampleFactor * freshness.factor : 0;
    const key = `${signal.domain}::${signal.correlationGroup}`;
    const row = { ...signal, eligible, ageDays: freshness.ageDays, freshnessFactor: freshness.factor, effectiveWeight };
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const reduced = [];
  let suppressedDuplicateSignals = 0;
  for (const [key, rows] of groups.entries()) {
    const eligibleRows = rows.filter((row) => row.eligible && row.effectiveWeight > 0);
    if (!eligibleRows.length) {
      reduced.push({
        key,
        domain: rows[0].domain,
        correlationGroup: rows[0].correlationGroup,
        impact: 0,
        weight: 0,
        confidence: 0,
        sourceSignals: rows,
        status: 'INELIGIBLE'
      });
      continue;
    }
    const totalWeight = eligibleRows.reduce((sum, row) => sum + row.effectiveWeight, 0);
    const impact = eligibleRows.reduce((sum, row) => sum + row.impact * row.effectiveWeight, 0) / totalWeight;
    const confidence = eligibleRows.reduce((sum, row) => sum + row.confidence * row.effectiveWeight, 0) / totalWeight;
    suppressedDuplicateSignals += Math.max(0, eligibleRows.length - 1);
    reduced.push({
      key,
      domain: rows[0].domain,
      correlationGroup: rows[0].correlationGroup,
      impact,
      weight: Math.min(1, totalWeight),
      confidence,
      sourceSignals: rows,
      status: 'ACTIVE_CORRELATION_GROUP'
    });
  }
  return { groups: reduced, suppressedDuplicateSignals };
}

function defaultDomainWeights() {
  return Object.fromEntries(TEAM_MATCH_INTELLIGENCE_DOMAINS.map((domain) => [domain, 1]));
}

export function buildTeamMatchIntelligence({
  eventId = null,
  homeTeam = 'HOME',
  awayTeam = 'AWAY',
  asOf,
  featureSet = null,
  signals = null,
  minimumSample = 5,
  maxAgeDays = 365,
  domainWeights = null
}) {
  if (!asOf) throw new Error('TEAM_MATCH_AS_OF_REQUIRED');
  if (!Number.isInteger(minimumSample) || minimumSample < 1) throw new Error('MINIMUM_SAMPLE_INVALID');
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) throw new Error('MAX_AGE_DAYS_INVALID');
  const asOfMs = parseTime(asOf, 'TEAM_MATCH_AS_OF');
  const derivedSignals = signals ?? deriveTeamMatchSignals(featureSet ?? {});
  if (!Array.isArray(derivedSignals)) throw new Error('TEAM_MATCH_SIGNALS_REQUIRED');
  const weights = { ...defaultDomainWeights(), ...(domainWeights ?? {}) };
  for (const domain of TEAM_MATCH_INTELLIGENCE_DOMAINS) {
    if (!Number.isFinite(weights[domain]) || weights[domain] < 0) throw new Error(`DOMAIN_WEIGHT_INVALID_${domain}`);
  }

  const reduced = groupWithinDomain(derivedSignals, asOfMs, minimumSample, maxAgeDays);
  const domainBoard = TEAM_MATCH_INTELLIGENCE_DOMAINS.map((domain) => {
    const groups = reduced.groups.filter((group) => group.domain === domain && group.status === 'ACTIVE_CORRELATION_GROUP');
    const totalWeight = groups.reduce((sum, group) => sum + group.weight, 0);
    const score = totalWeight > 0
      ? groups.reduce((sum, group) => sum + group.impact * group.weight, 0) / totalWeight
      : 0;
    const confidence = totalWeight > 0
      ? groups.reduce((sum, group) => sum + group.confidence * group.weight, 0) / totalWeight
      : 0;
    return Object.freeze({
      domain,
      score,
      confidence,
      activeGroups: groups.length,
      configuredWeight: weights[domain],
      state: groups.length ? 'ACTIVE' : 'MISSING_OR_INELIGIBLE'
    });
  });

  const active = domainBoard.filter((row) => row.state === 'ACTIVE' && row.configuredWeight > 0);
  const totalDomainWeight = active.reduce((sum, row) => sum + row.configuredWeight * row.confidence, 0);
  const overallDirectionalScore = totalDomainWeight > 0
    ? active.reduce((sum, row) => sum + row.score * row.configuredWeight * row.confidence, 0) / totalDomainWeight
    : 0;
  const coverage = active.length / TEAM_MATCH_INTELLIGENCE_DOMAINS.length;
  const averageConfidence = active.length
    ? active.reduce((sum, row) => sum + row.confidence, 0) / active.length
    : 0;
  const homeSupport = active.filter((row) => row.score > 0).reduce((sum, row) => sum + row.score * row.confidence, 0);
  const awaySupport = active.filter((row) => row.score < 0).reduce((sum, row) => sum + Math.abs(row.score) * row.confidence, 0);
  const maxSupport = Math.max(homeSupport, awaySupport);
  const contradictionPressure = maxSupport > 0 ? Math.min(homeSupport, awaySupport) / maxSupport : 0;
  const reliability = clamp(coverage * averageConfidence * (1 - 0.5 * contradictionPressure), 0, 1);

  const supportingEvidence = reduced.groups
    .filter((group) => group.status === 'ACTIVE_CORRELATION_GROUP' && group.impact > 0)
    .sort((a, b) => (b.impact * b.confidence) - (a.impact * a.confidence));
  const counterEvidence = reduced.groups
    .filter((group) => group.status === 'ACTIVE_CORRELATION_GROUP' && group.impact < 0)
    .sort((a, b) => (Math.abs(b.impact) * b.confidence) - (Math.abs(a.impact) * a.confidence));

  return Object.freeze({
    version: 'TEAM_MATCH_INTELLIGENCE_V0_1',
    eventId,
    homeTeam,
    awayTeam,
    asOf,
    overallDirectionalScore,
    favoredSide: overallDirectionalScore > 0 ? 'HOME' : (overallDirectionalScore < 0 ? 'AWAY' : 'NEUTRAL'),
    coverage,
    averageConfidence,
    contradictionPressure,
    reliability,
    reliabilityScore100: reliability * 100,
    domainBoard: Object.freeze(domainBoard),
    correlationGroups: Object.freeze(reduced.groups.map((group) => Object.freeze(group))),
    supportingEvidence: Object.freeze(supportingEvidence.map((group) => Object.freeze(group))),
    counterEvidence: Object.freeze(counterEvidence.map((group) => Object.freeze(group))),
    suppressedDuplicateSignals: reduced.suppressedDuplicateSignals,
    missingDomains: Object.freeze(domainBoard.filter((row) => row.state !== 'ACTIVE').map((row) => row.domain)),
    state: coverage >= 0.75 && reliability >= 0.55 ? 'ANALYSIS_MATURE' : (active.length ? 'ANALYSIS_PARTIAL' : 'ANALYSIS_BLOCKED'),
    governance: Object.freeze({
      teamAnalysisBeforeMarket: true,
      positiveAndNegativeEvidenceRequired: true,
      correlatedSignalsCountOncePerDomainGroup: true,
      staleOrUnverifiedSignalsDoNotContribute: true,
      rawOverallScoreDoesNotChangeLambdaWithoutCalibration: true,
      probabilityIsNotGuarantee: true
    })
  });
}
