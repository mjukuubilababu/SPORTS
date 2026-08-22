# Threat Model v0.1

Protected assets:
- canonical datasets
- provider credentials
- model artifacts
- pattern definitions
- decision/risk policies
- execution records
- immutable history

Primary threats:
1. compromised provider feed
2. stolen service credential
3. unauthorized model/policy promotion
4. poisoned training data
5. artifact tampering
6. replay abuse
7. accidental privileged mutation
8. secret leakage
9. excessive access
10. insider override without audit

Defense principles:
deny by default, least privilege, dual control, immutable audit, key rotation, signed artifacts,
provider quarantine, poisoning detection, environment isolation and reproducible recovery.
