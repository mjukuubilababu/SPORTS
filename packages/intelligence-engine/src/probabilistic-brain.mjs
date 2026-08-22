export function probabilisticBrain({ modelProbabilities, weights, offeredOdds, confidence }) {
  if (modelProbabilities.length !== weights.length) throw new Error('WEIGHT_LENGTH_MISMATCH');
  const sumW = weights.reduce((a,b)=>a+b,0);
  if (sumW <= 0) return { status:'WAIT', probability:null, ev:null, evidenceMaturity:confidence?.score ?? 0, realMoney:'NO' };
  const probability = modelProbabilities.reduce((a,p,i)=>a+p*weights[i],0)/sumW;
  const breakEven = 1/offeredOdds;
  const ev = probability*offeredOdds-1;
  return {
    status:'PAPER_ONLY', probability, breakEvenProbability:breakEven, ev,
    evidenceMaturity:confidence?.score ?? 0,
    criticalBlocks:confidence?.criticalBlocks ?? 0,
    realMoney:'NO'
  };
}
