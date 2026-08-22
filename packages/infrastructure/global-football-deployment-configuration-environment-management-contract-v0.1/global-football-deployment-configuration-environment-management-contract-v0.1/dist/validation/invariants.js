export function validateBuild(b) {
    const x = [];
    if (!b.source_commit)
        x.push({ code: "SOURCE_COMMIT_REQUIRED", message: "source commit required" });
    if (!b.artifact_hash)
        x.push({ code: "ARTIFACT_HASH_REQUIRED", message: "artifact hash required" });
    if (!b.reproducible)
        x.push({ code: "NON_REPRODUCIBLE_BUILD", message: "build must be reproducible" });
    if (b.immutable !== true)
        x.push({ code: "MUTABLE_BUILD", message: "build artifact immutable" });
    return x;
}
export function validateRelease(r) {
    const x = [];
    if (["SIGNED", "STAGED", "CANARY", "PROMOTED"].includes(r.state) && (!r.signature || !r.key_id))
        x.push({ code: "UNSIGNED_RELEASE", message: "signed release required" });
    if (r.immutable !== true)
        x.push({ code: "MUTABLE_RELEASE", message: "release artifact immutable" });
    return x;
}
export function validateConfig(c) {
    const x = [];
    if (!c.content_hash)
        x.push({ code: "CONFIG_HASH_REQUIRED", message: "config hash required" });
    if (c.immutable !== true)
        x.push({ code: "MUTABLE_CONFIG", message: "config snapshot immutable" });
    return x;
}
export function validateDeploymentResult(d) {
    return d.immutable === true ? [] : [{ code: "MUTABLE_DEPLOYMENT_RESULT", message: "deployment result immutable" }];
}
