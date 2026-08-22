import { depsFor } from "./dependencies.js";
export function decideOrchestration(event, targetStage, completedStages, priorRuns, circuit, now) {
    if (circuit?.state === "OPEN")
        return { action: "BLOCKED_BY_CIRCUIT", reason: "stage circuit breaker open", next_retry_at: null };
    const d = depsFor(targetStage);
    const missing = d.requires.filter(x => !completedStages.has(x));
    if (missing.length)
        return { action: "WAIT", reason: `missing dependencies: ${missing.join(",")}`, next_retry_at: null };
    const same = priorRuns.filter(r => r.stage === targetStage && r.input_hash === hashEvent(event));
    if (same.some(r => r.status === "SUCCEEDED"))
        return { action: "SKIP_IDEMPOTENT", reason: "identical input already succeeded", next_retry_at: null };
    const failures = same.filter(r => r.status === "FAILED").length;
    if (failures >= d.dead_letter_after_attempts)
        return { action: "DEAD_LETTER", reason: "retry budget exhausted", next_retry_at: null };
    if (failures > 0) {
        const backoff = d.retry_backoff_seconds[Math.min(failures - 1, d.retry_backoff_seconds.length - 1)] ?? 60;
        const next = new Date(Date.parse(now) + backoff * 1000).toISOString();
        return { action: "RETRY", reason: `retry attempt ${failures + 1}`, next_retry_at: next };
    }
    return { action: "RUN", reason: "dependencies satisfied and no idempotent success exists", next_retry_at: null };
}
export function hashEvent(e) {
    const s = JSON.stringify({ type: e.event_type, entity: e.entity_id, payload: e.payload, lineage: e.lineage_refs });
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return "fnv1a32:" + ((h >>> 0).toString(16).padStart(8, "0"));
}
