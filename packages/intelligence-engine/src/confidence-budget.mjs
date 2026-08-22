export function evaluateConfidenceBudget(items, { start = 100, promotionMinimum = 80 } = {}) {
  const triggered = items.filter(x => x.triggered);
  const penalty = triggered.reduce((a, x) => a + Number(x.penalty || 0), 0);
  const criticalBlocks = triggered.filter(x => x.blocksPromotion).length;
  const score = Math.max(0, start - penalty);
  return {
    score,
    penalty,
    criticalBlocks,
    status: score >= promotionMinimum && criticalBlocks === 0 ? 'PASS' : 'BLOCKED',
    interpretation: 'EVIDENCE_MATURITY_NOT_EVENT_PROBABILITY'
  };
}
