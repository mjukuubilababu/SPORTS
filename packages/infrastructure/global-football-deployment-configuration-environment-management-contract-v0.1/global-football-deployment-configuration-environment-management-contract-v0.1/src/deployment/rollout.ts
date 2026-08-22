export type RolloutSignals={
  critical_alert:boolean;
  slo_burn_rate:number;
  error_rate:number;
  latency_regression_pct:number;
  model_quality_regression:boolean;
  config_drift:boolean;
};

export function rolloutAction(s:RolloutSignals):"CONTINUE"|"PAUSE"|"ROLLBACK"{
  if(s.critical_alert||s.config_drift||s.model_quality_regression)return"ROLLBACK";
  if(s.slo_burn_rate>=2||s.error_rate>=.05||s.latency_regression_pct>=.30)return"PAUSE";
  return"CONTINUE";
}
