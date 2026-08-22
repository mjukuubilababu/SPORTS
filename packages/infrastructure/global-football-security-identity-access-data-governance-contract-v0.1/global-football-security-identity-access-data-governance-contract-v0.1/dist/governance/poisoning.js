export function aggregatePoisoning(signals) {
    if (signals.some(s => s.action === "INVALIDATE_ARTIFACT" || s.anomaly_type === "ARTIFACT_TAMPER" && s.severity === "CRITICAL"))
        return "INVALIDATE_ARTIFACT";
    if (signals.some(s => s.action === "BLOCK_SOURCE" || s.severity === "CRITICAL"))
        return "BLOCK_SOURCE";
    if (signals.some(s => s.action === "QUARANTINE_SOURCE"))
        return "QUARANTINE_SOURCE";
    if (signals.some(s => s.severity === "WARN"))
        return "WATCH";
    return "NONE";
}
