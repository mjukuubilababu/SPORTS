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
  if (signal.minimumSampleRequired !== null && signal.minimumSampleRequired !== undefined) {
    if (!Number.isInteger(signal.minimumSampleRequired) || signal.minimumSampleRequired < 1) {
      throw new Error('SIGNAL_MINIMUM_SAMPLE_REQUIRED_INVALID');
    }
  }
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
    const requiredSample = Number.isInteger(signal.minimumSampleRequired)
      ? signal.minimumSampleRequired
      : minimumSample;
    const eligible = signal.verified === true && signal.sampleSize >= requiredSample && freshness.factor > 0;
    const sampleFactor = eligible ? clamp(signal.sampleSize / Math.max(requiredSample, 1), 0, 1) : 0;
    const effectiveWeight = eligible ? signal.confidence * sampleFactor * freshness.factor : 0;
    const key = `${signal.domain}::${signal.correlationGroup}`;
    const row = {
      ...signal,
      requiredSample,
      eligible,
      ageDays: freshness.ageDays,
      freshnessFactor: freshness.factor,
      effectiveWeight
    };
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const reduced = [];
  let suppressedWithinDomain = 0;
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
    suppressedWithinDomain += Math.max(0, eligibleRows.length - 1);
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
  return { groups: reduced, suppressedWithinDomain };
}

function defaultDomainWeights() {
  return Object.fromEntries(TEAM_MATCH_INTELLIGENCE_DOMAINS.map((domain) => [domain, 1]));
}

function buildGlobalCorrelationBoard(domainGroups, weights) {
  const grouped = new Map();
  for (const row of domainGroups.filter((x) => x.status === 'ACTIVE_CORRELATION_GROUP')) {
    const list = grouped.get(row.correlationGroup) ?? [];
    list.push(row);
    grouped.set(row.correlationGroup, list);
  }

  const global = [];
  let suppressedCrossDomain = 0;
  for (const [correlationGroup, rows] of grouped.entries()) {
    const contributionWeights = rows.map((row) => row.weight * row.confidence * (weights[row.domain] ?? 1));
    const totalWeight = contributionWeights.reduce((sum, value) => sum + value, 0);
    const impact = totalWeight > 0
      ? rows.reduce((sum, row, index) => sum + row.impact * contributionWeights[index], 0) / totalWeight
      : 0;
    const confidence = totalWeight > 0
      ? rows.reduce((sum, row, index) => sum + row.confidence * contributionWeights[index], 0) / totalWeight
      : 0;
    suppressedCrossDomain += Math.max(0, rows.length - 1);
    global.push(Object.freeze({
      correlationGroup,
      domains: Object.freeze(rows.map((row) => row.domain)),
      impact,
      confidence,
      weight: Math.min(1, totalWeight),
      sourceDomainGroups: Object.freeze(rows)
    }));
  }
  return { groups: global, suppressedCrossDomain };
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

  const globalCorrelation = buildGlobalCorrelationBoard(reduced.groups, weights);
  const compositeGroups = globalCorrelation.groups.filter((row) => row.weight > 0);
  const totalCompositeWeight = compositeGroups.reduce((sum, row) => sum + row.weight * row.confidence, 0);
  const overallDirectionalScore = totalCompositeWeight > 0
    ? compositeGroups.reduce((sum, row) => sum + row.impact * row.weight * row.confidence, 0) / totalCompositeWeight
    : 0;

  const activeDomains = domainBoard.filter((row) => row.state === 'ACTIVE' && row.configuredWeight > 0);
  const coverage = activeDomains.length / TEAM_MATCH_INTELLIGENCE_DOMAINS.length;
  const averageConfidence = activeDomains.length
    ? activeDomains.reduce((sum, row) => sum + row.confidence, 0) / activeDomains.length
    : 0;
  const homeSupport = compositeGroups.filter((row) => row.impact > 0).reduce((sum, row) => sum + row.impact * row.confidence, 0);
  const awaySupport = compositeGroups.filter((row) => row.impact < 0).reduce((sum, row) => sum + Math.abs(row.impact) * row.confidence, 0);
  const maxSupport = Math.max(homeSupport, awaySupport);
  const contradictionPressure = maxSupport > 0 ? Math.min(homeSupport, awaySupport) / maxSupport : 0;
  const reliability = clamp(coverage * averageConfidence * (1 - 0.5 * contradictionPressure), 0, 1);

  const supportingEvidence = compositeGroups
    .filter((group) => group.impact > 0)
    .sort((a, b) => (b.impact * b.confidence) - (a.impact * a.confidence));
  const counterEvidence = compositeGroups
    .filter((group) => group.impact < 0)
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
    domainCorrelationGroups: Object.freeze(reduced.groups.map((group) => Object.freeze(group))),
    compositeCorrelationGroups: Object.freeze(compositeGroups),
    supportingEvidence: Object.freeze(supportingEvidence),
    counterEvidence: Object.freeze(counterEvidence),
    suppressedDuplicateSignals: reduced.suppressedWithinDomain + globalCorrelation.suppressedCrossDomain,
    suppressedWithinDomainSignals: reduced.suppressedWithinDomain,
    suppressedCrossDomainCorrelations: globalCorrelation.suppressedCrossDomain,
    missingDomains: Object.freeze(domainBoard.filter((row) => row.state !== 'ACTIVE').map((row) => row.domain)),
    state: coverage >= 0.75 && reliability >= 0.55 ? 'ANALYSIS_MATURE' : (activeDomains.length ? 'ANALYSIS_PARTIAL' : 'ANALYSIS_BLOCKED'),
    governance: Object.freeze({
      teamAnalysisBeforeMarket: true,
      positiveAndNegativeEvidenceRequired: true,
      correlatedSignalsRemainVisibleForExplanation: true,
      compositeCountsEachCorrelationFamilyOnceAcrossDomains: true,
      perSignalMinimumSampleCanRepresentVerifiedContextFacts: true,
      staleOrUnverifiedSignalsDoNotContribute: true,
      rawOverallScoreDoesNotChangeLambdaWithoutCalibration: true,
      probabilityIsNotGuarantee: true
    })
  });
}
