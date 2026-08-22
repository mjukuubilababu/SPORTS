function validProbability(x) {
  return Number.isFinite(x) && x > 0 && x < 1;
}

export function qualifyPaperLeg(candidate, {
  minEdge = 0.05,
  minEvidenceMaturity = 70,
  requireQualifiedState = true
} = {}) {
  if (!candidate?.eventId || !candidate?.selection) return { qualified: false, reason: 'IDENTITY_MISSING' };
  if (!validProbability(candidate.modelProbability) || !validProbability(candidate.marketFairProbability)) {
    return { qualified: false, reason: 'PROBABILITY_INVALID' };
  }
  if (!(candidate.bestOdds > 1)) return { qualified: false, reason: 'ODDS_INVALID' };
  if (requireQualifiedState && candidate.state !== 'QUALIFIED') return { qualified: false, reason: 'NOT_QUALIFIED' };
  if ((candidate.evidenceMaturity ?? 0) < minEvidenceMaturity) return { qualified: false, reason: 'EVIDENCE_TOO_WEAK' };
  const edge = candidate.modelProbability - candidate.marketFairProbability;
  if (edge < minEdge) return { qualified: false, reason: 'EDGE_TOO_SMALL', edge };
  const ev = candidate.modelProbability * candidate.bestOdds - 1;
  if (!(ev > 0)) return { qualified: false, reason: 'NON_POSITIVE_EV', edge, ev };
  if (candidate.independenceVerified !== true) return { qualified: false, reason: 'INDEPENDENCE_NOT_VERIFIED', edge, ev };
  return {
    qualified: true,
    edge,
    ev,
    reliabilityScore: edge * Math.min(1, candidate.evidenceMaturity / 100)
  };
}

function combinations(items, size, start = 0, prefix = [], out = []) {
  if (prefix.length === size) { out.push(prefix); return out; }
  for (let i = start; i < items.length; i += 1) combinations(items, size, i + 1, [...prefix, items[i]], out);
  return out;
}

function compatible(legs) {
  const events = new Set(legs.map((x) => x.eventId));
  if (events.size !== legs.length) return false;
  const groups = legs.map((x) => x.correlationGroup).filter(Boolean);
  return new Set(groups).size === groups.length;
}

export function buildPaperCombinations(candidates, {
  maxSets = 2,
  minLegs = 2,
  maxLegs = 3,
  minEdge = 0.05,
  minEvidenceMaturity = 70
} = {}) {
  const qualified = [];
  const rejected = [];
  for (const c of candidates) {
    const q = qualifyPaperLeg(c, { minEdge, minEvidenceMaturity });
    if (q.qualified) qualified.push({ ...c, ...q }); else rejected.push({ candidate: c, ...q });
  }

  const sets = [];
  for (let size = minLegs; size <= Math.min(maxLegs, qualified.length); size += 1) {
    for (const legs of combinations(qualified, size)) {
      if (!compatible(legs)) continue;
      const combinedProbability = legs.reduce((p, x) => p * x.modelProbability, 1);
      const combinedOdds = legs.reduce((o, x) => o * x.bestOdds, 1);
      const combinedEv = combinedProbability * combinedOdds - 1;
      const score = legs.reduce((s, x) => s + x.reliabilityScore, 0) / legs.length;
      sets.push({ legs, combinedProbability, combinedOdds, combinedEv, score });
    }
  }

  sets.sort((a, b) => (b.score - a.score) || (b.combinedEv - a.combinedEv));
  const selected = [];
  const usedEventSets = new Set();
  for (const set of sets) {
    const key = set.legs.map((x) => x.eventId).sort().join('|');
    if (usedEventSets.has(key)) continue;
    usedEventSets.add(key);
    selected.push(set);
    if (selected.length >= maxSets) break;
  }

  return {
    mode: 'PAPER_ONLY',
    realMoney: 'NO',
    selected,
    qualifiedCount: qualified.length,
    rejected,
    note: 'COMBINED_PROBABILITY_REQUIRES_VERIFIED_INDEPENDENCE; NO_AUTO_EXECUTION'
  };
}
