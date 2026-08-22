export function allocateReliabilityWeights(models) {
  const rows = models.map(m => {
    const multipliers = ['validation','calibration','freshness','drift','availability'].map(k => Number(m[k] ?? 0));
    const raw = Number(m.baseWeight || 0) * multipliers.reduce((a,b) => a*b, 1);
    return { ...m, rawEffectiveWeight: raw };
  });
  const total = rows.reduce((a,x)=>a+x.rawEffectiveWeight,0);
  return rows.map(x => ({ ...x, normalizedWeight: total > 0 ? x.rawEffectiveWeight / total : 0, canInfluence: x.rawEffectiveWeight > 0 }));
}
