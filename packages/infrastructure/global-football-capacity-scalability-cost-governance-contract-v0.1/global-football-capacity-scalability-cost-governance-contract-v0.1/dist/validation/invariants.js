export function validateCapacity(e) {
    const x = [];
    if (e.min_replicas < 0 || e.max_replicas < e.min_replicas)
        x.push({ code: "BAD_REPLICA_RANGE", message: "invalid replica range" });
    if (e.headroom_pct < 0)
        x.push({ code: "BAD_HEADROOM", message: "headroom must be >=0" });
    if (e.max_rps_per_replica <= 0)
        x.push({ code: "BAD_RPS_CAPACITY", message: "max rps per replica must be >0" });
    return x;
}
export function validateBudget(b) {
    const x = [];
    if (b.soft_limit < 0 || b.hard_limit <= 0 || b.soft_limit > b.hard_limit)
        x.push({ code: "BAD_BUDGET_LIMITS", message: "invalid budget limits" });
    if (b.critical_reserve < 0 || b.critical_reserve >= b.hard_limit)
        x.push({ code: "BAD_CRITICAL_RESERVE", message: "invalid critical reserve" });
    return x;
}
export function validateRateLimit(r) { return r.requests_per_second > 0 && r.burst >= r.requests_per_second && r.concurrency > 0 ? [] : [{ code: "BAD_RATE_LIMIT", message: "invalid provider rate limit" }]; }
export function validateStorage(p) { return p.hot_days <= p.warm_days && p.warm_days <= p.cold_after_days ? [] : [{ code: "BAD_STORAGE_TIERS", message: "storage ages must be ordered" }]; }
