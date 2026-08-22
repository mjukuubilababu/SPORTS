export const ERROR_CLASSES = Object.freeze([
  'PROBABILITY_CALIBRATION','DISTRIBUTION_SHAPE','TEAM_STRENGTH','FINISHING_VARIANCE',
  'EVENT_SHOCK','PRICE_ERROR','DATA_ERROR','REGIME_DRIFT'
]);
export function learningResponse(errorClass){
  if (!ERROR_CLASSES.includes(errorClass)) throw new Error('UNKNOWN_ERROR_CLASS');
  const batchOnly = new Set(ERROR_CLASSES);
  return { errorClass, canRetuneFromOneMatch: !batchOnly.has(errorClass), action: 'DIAGNOSE_AND_ACCUMULATE_BATCH_EVIDENCE' };
}
