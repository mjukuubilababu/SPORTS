export function compareChallenger({ champion, challenger, minN = 30 }) {
  if (!champion || !challenger) throw new Error('MISSING_MODEL_SCORE');
  if ((challenger.n ?? 0) < minN) return { decision: 'RETAIN_CHAMPION', reason: 'INSUFFICIENT_N' };
  const betterBrier = challenger.brier < champion.brier;
  const betterLogLoss = challenger.logLoss < champion.logLoss;
  const positiveMarketEvidence = (challenger.clv ?? 0) > 0;
  return betterBrier && betterLogLoss && positiveMarketEvidence
    ? { decision: 'ELIGIBLE_FOR_GOVERNANCE_REVIEW', reason: 'OOS_METRICS_BEAT_CHAMPION' }
    : { decision: 'RETAIN_CHAMPION', reason: 'CHALLENGER_NOT_BETTER_OOS' };
}
