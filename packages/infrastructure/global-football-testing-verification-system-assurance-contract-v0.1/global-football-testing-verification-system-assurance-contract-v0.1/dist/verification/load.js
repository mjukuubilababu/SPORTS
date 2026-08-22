export function loadPass(r, limits) {
    return r.p95_latency_ms <= limits.p95 && r.p99_latency_ms <= limits.p99 && r.error_rate <= limits.error && r.max_queue_age_seconds <= limits.queueAge && r.autoscaling_worked && r.load_shedding_worked;
}
