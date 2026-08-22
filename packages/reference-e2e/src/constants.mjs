export const SYSTEM_VERSION = 'bootstrap-e2e-v0.1';
export const RULES_VERSION = 'P002-v1-frozen';
export const MODEL_VERSION = 'reference-poisson-v0.1';
export const FEATURE_VERSION = 'reference-features-v0.1';
export const DATA_CONTRACT_VERSION = 'global-football-data-v0.2-ref';
export const RISK_POLICY_VERSION = 'paper-risk-v0.1';

export const P002 = Object.freeze({
  o25Max: 1.60,
  u35Min: 1.55,
  u35Max: 1.75,
  lambdaMin: 2.70,
  lambdaMax: 3.10,
  rawEdgePpMin: 5.0,
});

export const EVENT_STATES = Object.freeze([
  'DISCOVERED','DATA_READY','FEATURES_READY','MODEL_READY','PATTERN_READY',
  'DECIDED','RISK_APPROVED','PAPER_EXECUTED','STARTED','SETTLED','EVALUATED','ASSURED'
]);

export const TERMINAL_DECISIONS = Object.freeze(['REJECT','WAIT','QUALIFIED']);
