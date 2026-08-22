# Data Governance Rules v0.1
1. No dataset without an owner and declared purpose.
2. Licensed data usage must remain traceable to its license.
3. Restricted data export is denied by default.
4. Retention is explicit; indefinite retention requires justification.
5. Data residency constraints are policy, not comments.
6. Training data must be authorized for model-training use.
7. Provider revocation must be able to stop future ingestion without deleting immutable historical audit.
8. Derived artifacts retain lineage to governed source datasets.
9. Security classifications propagate downstream unless a stricter class applies.
10. Governance changes are versioned and audited.
