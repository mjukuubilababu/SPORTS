# Release Governance v0.1
1. No direct DEV -> PRODUCTION.
2. No unsigned production release.
3. No mutable production config snapshot.
4. No secret values in config snapshots.
5. No destructive migration without tested backup path.
6. No rollout without rollback artifact.
7. No canary continuation under critical alerts.
8. No config drift accepted silently.
9. No runtime policy mutation that bypasses versioned config.
10. Every production release preserves source, build, config, migration and approval lineage.
