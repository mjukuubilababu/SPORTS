# Decision Intelligence Unified Repository v0.5

This is the first canonical repository integration of the actually available Gate 1-6 engines plus the verified System Bootstrap / Reference E2E v0.1.

## Verification

Run:

```bash
python scripts/verify_unified.py
```

The verifier executes all six Python gate acceptance suites and the Node reference E2E `npm run verify`, records stdout/stderr, computes SHA-256 hashes, and emits a machine-readable assurance report.

Two assurance statuses are intentionally separated:

- **CORE_INTEGRATED_ASSURANCE**: available artifacts compile/run/test together at repository level.
- **FULL_PLATFORM_ASSURANCE**: additionally requires original infrastructure artifacts from the other branch to be physically imported and verified.

No missing artifact is recreated from prose. That preserves branch reconciliation integrity.

## Intelligence Engine Consolidation v0.1

Selective salvage from `Betting_Intelligence_v0.4.3_Later_Season_Recency.xlsx` is now integrated under `packages/intelligence-engine`.

Runtime evidence: **13/13 intelligence tests PASS**; root full-platform runtime checks **14/14 PASS**.

Governance locks remain unchanged: P002 frozen rules are not overwritten, M011/M012 decision weights remain zero, market remains champion until beaten OOS, automatic production self-modification is prohibited, and capital remains LOCKED.

## Qualified Signal Set Contract v0.1

Batch analysis now returns **every canonical signal that passes all frozen qualification gates**. The Decision layer performs no top-1 truncation. Qualified signals are deterministically ranked for display/priority only; ranking cannot suppress qualification. Portfolio Risk remains a downstream layer and may approve, reduce, or deny execution without rewriting the immutable qualification history.

Reference tests cover zero, one, and many qualifiers; deterministic ranking; duplicate deduplication; conflicting-duplicate rejection; and portfolio-risk restriction with qualification preserved. Qualified Signal Set contract tests: **7/7 PASS**; full Reference E2E tests: **16/16 PASS**; root runtime checks: **15/15 PASS**. This change does not alter P002 thresholds and has no capital-unlock effect.
