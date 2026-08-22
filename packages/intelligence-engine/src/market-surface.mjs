export function devigPair(overOdds, underOdds) {
  if (!(overOdds > 1) || !(underOdds > 1)) throw new Error('INVALID_ODDS');
  const o = 1 / overOdds;
  const u = 1 / underOdds;
  const z = o + u;
  return { fairOver: o / z, fairUnder: u / z };
}

export function exactTargetLineAnchor(surface, targetLine = 3.5) {
  const row = surface.find((x) => Number(x.line) === Number(targetLine));
  if (!row) return { status: 'WAIT', reason: 'TARGET_LINE_MISSING', fairUnder: null };
  if (!row.sameProvider || !row.sameTimestamp) {
    return { status: 'BLOCK', reason: 'CROSS_PROVIDER_OR_TIME_MIX', fairUnder: null };
  }
  const { fairUnder, fairOver } = devigPair(row.overOdds, row.underOdds);
  return { status: 'PASS', line: targetLine, fairUnder, fairOver, provider: row.provider, observedAt: row.observedAt };
}

export function surfaceDisagreement(lambdaByLine, { watch = 0.10, fail = 0.25 } = {}) {
  const vals = Object.values(lambdaByLine).filter(Number.isFinite);
  if (vals.length < 2) return { status: 'WAIT', gap: null };
  const gap = Math.max(...vals) - Math.min(...vals);
  return { status: gap > fail ? 'FAIL' : gap > watch ? 'WATCH' : 'PASS', gap };
}
