import { StateTransitionError } from './errors.mjs';
const allowed = new Map([
  ['DISCOVERED',new Set(['DATA_READY'])],
  ['DATA_READY',new Set(['FEATURES_READY'])],
  ['FEATURES_READY',new Set(['MODEL_READY'])],
  ['MODEL_READY',new Set(['PATTERN_READY'])],
  ['PATTERN_READY',new Set(['DECIDED'])],
  ['DECIDED',new Set(['RISK_APPROVED'])],
  ['RISK_APPROVED',new Set(['PAPER_EXECUTED'])],
  ['PAPER_EXECUTED',new Set(['STARTED'])],
  ['STARTED',new Set(['SETTLED'])],
  ['SETTLED',new Set(['EVALUATED'])],
  ['EVALUATED',new Set(['ASSURED'])],
]);
export function transition(from,to){ if(!allowed.get(from)?.has(to)) throw new StateTransitionError(from,to); return to; }
