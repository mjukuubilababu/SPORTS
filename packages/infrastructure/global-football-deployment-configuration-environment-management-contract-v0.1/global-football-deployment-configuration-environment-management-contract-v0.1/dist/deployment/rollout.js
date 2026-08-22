export function rolloutAction(s) {
    if (s.critical_alert || s.config_drift || s.model_quality_regression)
        return "ROLLBACK";
    if (s.slo_burn_rate >= 2 || s.error_rate >= .05 || s.latency_regression_pct >= .30)
        return "PAUSE";
    return "CONTINUE";
}
