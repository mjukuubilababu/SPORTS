export function assessProviderTrust(p) {
    if (p.anomaly_score >= .85 || p.schema_violation_rate >= .25 || p.timestamp_anomaly_rate >= .20)
        return "BLOCKED";
    if (p.anomaly_score >= .60 || p.conflict_rate >= .20 || p.schema_violation_rate >= .10)
        return "QUARANTINED";
    if (p.anomaly_score >= .30 || p.conflict_rate >= .10)
        return "LIMITED";
    return "TRUSTED";
}
