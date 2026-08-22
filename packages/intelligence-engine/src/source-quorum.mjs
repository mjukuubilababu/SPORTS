export function resolveSourceQuorum(observations) {
  const authoritative = observations.filter(o => o.tier === 'A' && o.explicitTimestamp && o.explicitMinute && o.verified !== false);
  if (authoritative.length >= 1) return { status: 'PASS', value: authoritative[0].claim, basis: 'TIER_A_TIMESTAMPED' };

  const exact = observations.filter(o => o.independent && o.explicitTimestamp && o.verified !== false);
  const groups = new Map();
  for (const o of exact) {
    const k = JSON.stringify(o.claim);
    groups.set(k, (groups.get(k) || 0) + 1);
  }
  const winner = [...groups.entries()].find(([, n]) => n >= 2);
  if (winner) return { status: 'PASS', value: JSON.parse(winner[0]), basis: 'TWO_SOURCE_AGREEMENT' };
  return { status: 'FAIL', value: null, basis: 'PRESERVE_NULL' };
}
