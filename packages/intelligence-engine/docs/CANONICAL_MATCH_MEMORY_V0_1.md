# Canonical Match Memory v0.1 — Step 1

## Purpose

Step 1 creates a durable, immutable per-match memory envelope for Pattern Intelligence while preserving the existing canonical system.

It does **not** replace Gate1. Gate1 remains the authoritative truth and provenance owner. Match Memory is a derived materialized view that makes already-canonical truth and related evidence easy to retain, audit, compare, and later consume by behavioral pattern stages.

## Core principle

A win, draw, or loss is not good or bad data. It is football truth. A correct or incorrect prediction is also retained. The system may later learn from both, but Step 1 does not discover or validate patterns.

## Input boundary

The main runtime accepts an existing Gate1 canonical truth record plus optional:

- normalized observations satisfying the Pattern Intelligence observation contract;
- market snapshots;
- prediction settlement records, including existing `outcome-settlement.mjs` output;
- an explicit prediction cutoff timestamp when pre-match eligibility needs to be evaluated.

Missing timestamps are never guessed. Evidence without a provable cutoff relationship is retained but receives `pre_match_eligible=false`.

## Memory sections

Each memory contains:

1. `identity`
   - canonical match id/date
   - season/league
   - home/away teams

2. `truth`
   - accepted/quarantined state
   - verified flag
   - final score
   - HOME_WIN / DRAW / AWAY_WIN
   - total goals
   - BTTS truth
   - team-scored truth
   - exact result provenance
   - deterministic truth fingerprint

3. `evidence`
   - observations
   - market snapshots
   - prediction settlements

4. `learning`
   - retain-for-learning flag
   - pattern-truth eligibility
   - correct/incorrect prediction counts
   - no outcome-based deletion
   - no pattern discovery or validation at this layer

5. `timeline`
   - explicitly `STEP_2_PENDING`
   - no minute-by-minute goal/card/substitution modeling yet

6. `governance`
   - Gate1 remains truth owner
   - no hindsight
   - no market-to-model circularity
   - no retuning or pattern auto-promotion
   - no P002 change
   - no Gate1–6 ownership change
   - real money remains NO

7. `memory_fingerprint`
   - deterministic SHA-256 over canonicalized memory content

## Truth eligibility vs retention

Retention and decision eligibility are deliberately different.

- Verified + `ACCEPTED` Gate1 truth: retained and eligible as truth evidence for later governed pattern research.
- `QUARANTINED` or unverified truth: retained for audit/history but `pattern_truth_eligible=false` and truth decision weight is zero.
- Correct prediction: retained.
- Incorrect prediction: retained.
- Post-cutoff observation: retained, but cannot influence the frozen pre-match state.

## Existing capability reuse

This component complements rather than replaces:

- Gate1 historical truth importer and provenance rules;
- `evidence-graph.mjs` for governed evidence relationships;
- `outcome-settlement.mjs` for correct/incorrect 1X2 settlement;
- the existing governed learning loop and error taxonomy;
- Gate5 immutable signal freeze / settlement ownership;
- Gate6 capital and execution-risk ownership.

## Step boundary

Step 1 does not model the chronology of goals, cards, substitutions, score-state transitions, or tactical changes. Those belong to **Step 2 — Game-State Timeline**.

Step 1 is complete when the system can represent all settled outcome classes under one immutable schema, preserve provenance/timestamps without guessing, retain both correct and incorrect predictions, exclude unverified truth from pattern influence without deleting it, and detect memory tampering deterministically.
