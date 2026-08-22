# Acceptance Criteria v0.1

1. One controlled event traverses the complete reference pipeline.
2. Duplicate replay cannot produce a second execution business effect.
3. Frozen/immutable artifacts reject conflicting overwrite.
4. Illegal backward lifecycle transition is rejected.
5. Evidence timestamp at or after kickoff is rejected by the Data Contract.
6. Unknown identities/actions are denied by default.
7. One correlation lineage is visible through audit/trace artifacts.
8. Settlement is a separate immutable artifact, not mutation of prediction/decision.
9. Evaluation is reproducible from prediction + settlement lineage.
10. Assurance emits PROMOTE only when its reference checks pass.
11. Migration executes successfully in isolated TEST SQLite database.
12. Automated tests are actually executed, not merely authored.
13. Real-capital state remains LOCKED; paper execution only.
