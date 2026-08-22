const rank = { DEV: 0, TEST: 1, STAGING: 2, PRODUCTION: 3 };
export function validatePromotionPath(plan, release) {
    const reasons = [];
    if (rank[plan.to_environment] !== rank[plan.from_environment] + 1)
        reasons.push("NON_SEQUENTIAL_ENVIRONMENT_PROMOTION");
    if (!release.target_environments.includes(plan.to_environment))
        reasons.push("RELEASE_NOT_TARGETED_FOR_ENVIRONMENT");
    if (plan.to_environment === "PRODUCTION" && release.state !== "STAGED" && release.state !== "CANARY")
        reasons.push("PRODUCTION_REQUIRES_STAGED_OR_CANARY_RELEASE");
    if (plan.strategy === "CANARY" && (plan.canary_pct === null || plan.canary_pct <= 0 || plan.canary_pct >= 100))
        reasons.push("INVALID_CANARY_PERCENT");
    if (plan.strategy !== "CANARY" && plan.canary_pct !== null)
        reasons.push("CANARY_PERCENT_WITH_NON_CANARY_STRATEGY");
    return reasons;
}
