const SOURCE_WEIGHTS = Object.freeze({
  OFFICIAL_API: 1,
  LICENSED_DATA_VENDOR: 0.95,
  PUBLIC_WEB: 0.8,
  MANUAL_CAPTURE: 0.5
});

function finitePositive(x) {
  return Number.isFinite(x) && x > 1;
}

export function devigNWay(decimalOdds) {
  const entries = Object.entries(decimalOdds ?? {});
  if (entries.length < 2) throw new Error('AT_LEAST_TWO_SELECTIONS_REQUIRED');
  for (const [, odd] of entries) if (!finitePositive(odd)) throw new Error('INVALID_ODDS');
  const implied = Object.fromEntries(entries.map(([k, odd]) => [k, 1 / odd]));
  const book = Object.values(implied).reduce((a, b) => a + b, 0);
  const fair = Object.fromEntries(Object.entries(implied).map(([k, p]) => [k, p / book]));
  return { implied, fair, overround: book - 1, book };
}

export function normalizeBookmakerSnapshot(snapshot) {
  if (!snapshot?.eventId || !snapshot?.provider || !snapshot?.marketKey || !snapshot?.observedAt) {
    throw new Error('SNAPSHOT_IDENTITY_REQUIRED');
  }
  const observedMs = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(observedMs)) throw new Error('INVALID_OBSERVED_AT');
  const sourceType = snapshot.sourceType ?? 'PUBLIC_WEB';
  if (!(sourceType in SOURCE_WEIGHTS)) throw new Error('UNSUPPORTED_SOURCE_TYPE');
  const normalized = devigNWay(snapshot.odds);
  return {
    eventId: snapshot.eventId,
    provider: snapshot.provider,
    marketKey: snapshot.marketKey,
    observedAt: new Date(observedMs).toISOString(),
    observedMs,
    sourceType,
    sourceWeight: SOURCE_WEIGHTS[sourceType],
    odds: { ...snapshot.odds },
    ...normalized
  };
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function weightedMean(rows, field, selection) {
  const usable = rows.filter((r) => Number.isFinite(r[field]?.[selection]) && r.sourceWeight > 0);
  const z = usable.reduce((a, r) => a + r.sourceWeight, 0);
  return z > 0 ? usable.reduce((a, r) => a + r[field][selection] * r.sourceWeight, 0) / z : null;
}

export function compareBookmakerSnapshots(snapshots, { maxSkewSeconds = 120, disagreementWatch = 0.03 } = {}) {
  const rows = snapshots.map(normalizeBookmakerSnapshot);
  if (rows.length < 2) return { status: 'WAIT', reason: 'NEED_MULTIPLE_PROVIDERS', rows };
  const eventIds = new Set(rows.map((r) => r.eventId));
  const markets = new Set(rows.map((r) => r.marketKey));
  const providers = new Set(rows.map((r) => r.provider));
  if (eventIds.size !== 1 || markets.size !== 1) throw new Error('EVENT_OR_MARKET_MIX');
  if (providers.size !== rows.length) throw new Error('DUPLICATE_PROVIDER_SNAPSHOT');

  const times = rows.map((r) => r.observedMs);
  const skewSeconds = (Math.max(...times) - Math.min(...times)) / 1000;
  if (skewSeconds > maxSkewSeconds) {
    return { status: 'BLOCK', reason: 'TIMESTAMP_SKEW', skewSeconds, rows };
  }

  const selections = Object.keys(rows[0].odds);
  if (!rows.every((r) => selections.length === Object.keys(r.odds).length && selections.every((s) => s in r.odds))) {
    throw new Error('SELECTION_SET_MISMATCH');
  }

  const consensusFair = Object.fromEntries(selections.map((s) => [s, weightedMean(rows, 'fair', s)]));
  const dispersion = Object.fromEntries(selections.map((s) => {
    const vals = rows.map((r) => r.fair[s]);
    return [s, Math.max(...vals) - Math.min(...vals)];
  }));
  const bestPrice = Object.fromEntries(selections.map((s) => {
    const best = [...rows].sort((a, b) => b.odds[s] - a.odds[s])[0];
    return [s, { provider: best.provider, odds: best.odds[s], observedAt: best.observedAt }];
  }));
  const overrounds = rows.map((r) => r.overround);
  const overroundGap = Math.max(...overrounds) - Math.min(...overrounds);
  const maxDispersion = Math.max(...Object.values(dispersion));

  const hypotheses = [];
  if (overroundGap >= 0.015) hypotheses.push({ code: 'MARGIN_DIFFERENCE', confidence: 'HIGH', evidence: { overroundGap } });
  if (skewSeconds >= Math.min(30, maxSkewSeconds / 2)) hypotheses.push({ code: 'TIMING_OR_INFORMATION_LATENCY', confidence: 'MEDIUM', evidence: { skewSeconds } });
  if (maxDispersion >= disagreementWatch) hypotheses.push({ code: 'MODEL_OR_RISK_SHADING_DIFFERENCE', confidence: 'MEDIUM', evidence: { maxFairProbabilityGap: maxDispersion } });
  if (hypotheses.length === 0) hypotheses.push({ code: 'NORMAL_MARKET_VARIATION', confidence: 'LOW', evidence: {} });

  return {
    status: maxDispersion >= disagreementWatch ? 'WATCH' : 'PASS',
    eventId: rows[0].eventId,
    marketKey: rows[0].marketKey,
    providers: rows.map((r) => r.provider),
    consensusFair,
    dispersion,
    bestPrice,
    meanOverround: mean(overrounds),
    overroundGap,
    skewSeconds,
    hypotheses,
    explanationPolicy: 'HYPOTHESES_NOT_INTERNAL_BOOKMAKER_FACTS',
    rows
  };
}
