import { compareChallenger } from './champion-challenger.mjs';

export function proposeLearningChange({ errorEvidence, challengerScore, championScore, modelId }) {
  const comparison = compareChallenger({ champion: championScore, challenger: challengerScore });
  return Object.freeze({
    proposalType: 'CHALLENGER_REVIEW',
    modelId,
    comparison,
    errorEvidence,
    autoApply: false,
    productionMutationAllowed: false,
    decisionWeightChange: comparison.decision === 'ELIGIBLE_FOR_GOVERNANCE_REVIEW' ? 'REVIEW_REQUIRED' : 'NO_CHANGE'
  });
}

export const RESEARCH_CHALLENGERS = Object.freeze({
  M011: { name:'Bayesian Team Memory', decisionWeight:0, status:'CHALLENGER_REJECTED_CURRENT_SEED', reason:'WORSE_THAN_MARKET_BRIER_LOGLOSS' },
  M012: { name:'Recency Memory', decisionWeight:0, status:'DIAGNOSTIC_ONLY', reason:'HALF_LIFE_NOT_SELECTED_OOS' }
});
