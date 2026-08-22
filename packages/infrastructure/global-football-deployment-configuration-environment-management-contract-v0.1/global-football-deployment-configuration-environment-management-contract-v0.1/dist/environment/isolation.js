export function secretReferenceViolations(snapshot) {
    const bad = [];
    for (const e of snapshot.entries) {
        const looksSecret = /password|secret|token|api[_-]?key/i.test(e.key);
        if (looksSecret && e.secret_ref === null)
            bad.push(e.key);
    }
    return bad;
}
export function crossEnvironmentReferenceAllowed(from, to) {
    if (from === to)
        return true;
    return false;
}
