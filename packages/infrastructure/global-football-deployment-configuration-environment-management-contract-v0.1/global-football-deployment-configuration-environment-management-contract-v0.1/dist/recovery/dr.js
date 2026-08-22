export function validateDRPlan(p) {
    const r = [];
    if (p.rpo_minutes < 0)
        r.push("INVALID_RPO");
    if (p.rto_minutes <= 0)
        r.push("INVALID_RTO");
    if (p.multi_region_required && !p.failover_target)
        r.push("FAILOVER_TARGET_REQUIRED");
    if (Date.parse(p.next_dr_test_due_at).toString() === "NaN")
        r.push("INVALID_DR_TEST_DATE");
    return r;
}
