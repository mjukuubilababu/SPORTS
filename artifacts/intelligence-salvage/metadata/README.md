# Decision Intelligence Selective Salvage Transfer v0.1

This package is a **discovery + preservation** handoff only. It does not merge, rewrite, migrate, or promote anything into the canonical Unified Repository.

## Inventory result

- Conversation file records scanned: **27**.
- Unique filenames: **21**.
- Standalone files found outside `.xlsx`: **none**.
- No `.zip`, `.ts/.tsx`, `.js/.mjs`, `.py`, `.sql`, `.json`, `.yaml/.yml`, `.md`, `.csv`, `package.json`, `tsconfig`, standalone tests, or migration files were found as conversation artifacts.
- Six duplicate-name generation records existed because corrected revisions were produced under the same filename. The final mounted revisions were used for lineage analysis; duplicate revisions were not selected independently.

## Selected original

`selected-originals/Betting_Intelligence_v0.4.3_Later_Season_Recency.xlsx`  
SHA-256: `e21e9bd770dcc7b98535fb3638e37933db07175afee596f149bd15e84fdd6354`

Why only one original is selected: v0.4.3 is a cumulative workbook with 54 sheets and includes the important local lineage through Pattern Freeze v0.1.9, Data Integrity v0.2.x, Market Surface v0.3.1, Live/Learning Governance v0.3.2, Source/Event Intelligence v0.3.3, Probabilistic Brain v0.4.0, Bayesian Memory v0.4.1, Walk-Forward Bayes v0.4.2, and Recency/Change-Point v0.4.3. Selecting earlier workbooks as well would duplicate the same logic.

## Important comparison limitation

Classification against canonical is based on the **canonical state summary supplied by the user**, not on a direct file-level diff of the canonical repository. Therefore no `NEWER_HERE` or canonical `CONFLICT` claim is made without evidence. Specific local modules absent from the declared canonical state are marked `UNIQUE_HERE`. Exact equivalence of P002 frozen rules is marked `UNKNOWN` and must not be overwritten automatically.

## Test discipline

- Workbook formula-integrity scan: executed and passed (0 formula-error matches after the final v0.4.3 patch).
- Anti-hindsight immutability audit: present and passed.
- Bayesian challenger vs market: executed and **failed**; market remains champion.
- Validation sample gate: **failed/not ready**; empirical validation remains insufficient.
- Source-quorum live-state gate: **failed** under incomplete/conflicting live evidence, correctly blocking live inference.
- Overall artifact test state is therefore **not PASS**.

## Migration discipline

No SQL/database migration artifact exists in this conversation:
- MIGRATION_AUTHORED: false
- MIGRATION_APPLIED: false
- MIGRATION_VERIFIED: false

Canonical review sequence should be: verify hash → inspect sheet/module diffs → decide merge strategy → author canonical code/tests separately if approved → run canonical tests → integrate approved deltas only.
