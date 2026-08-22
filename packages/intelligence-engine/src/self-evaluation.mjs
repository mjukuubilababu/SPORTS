export function selfEvaluate(state) {
  const checks = [
    ['verifiedLiveState', state.verifiedLiveState === true, 'KEEP_LIVE_MODEL_WEIGHT_ZERO'],
    ['calibrated', state.calibrated === true, 'PENALIZE_INTERNAL_MODEL_WEIGHT'],
    ['beatsMarketOOS', state.beatsMarketOOS === true, 'MARKET_REMAINS_CHAMPION'],
    ['priceHasValue', state.priceHasValue === true, 'NO_EXECUTION'],
    ['noMissingGuesses', state.noMissingGuesses !== false, 'PRESERVE_NULLS'],
    ['oneMatchRetuneForbidden', state.oneMatchRetuneForbidden !== false, 'BATCH_ONLY']
  ];
  const results = checks.map(([name, pass, action]) => ({ name, status: pass ? 'PASS' : 'FAIL', action: pass ? 'NONE' : action }));
  return { results, canClaimSuperiority: Boolean(state.beatsMarketOOS && state.calibrated), realMoneyEligible: false };
}
