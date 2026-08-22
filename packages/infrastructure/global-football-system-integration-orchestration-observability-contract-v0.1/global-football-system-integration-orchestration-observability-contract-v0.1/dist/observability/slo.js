export function sloBurnRate(slo, good, total) {
    if (total <= 0)
        return 0;
    const observedBad = 1 - good / total;
    const allowedBad = Math.max(1e-9, 1 - slo.target);
    return observedBad / allowedBad;
}
export function metricSeverity(value, warn, critical) {
    if (value >= critical)
        return "CRITICAL";
    if (value >= warn)
        return "WARN";
    return "INFO";
}
export function health(metric, value, unit, observed_at, stage = null) {
    return { metric, stage, observed_at, value, unit, severity: "INFO" };
}
