# Global Multi-League Real Data Expansion v0.1

## Purpose

This capability proves that the historical truth/backfill path is not MLS- or EPL-specific. One canonical contract is used for five top-flight European competitions:

- EPL
- La Liga
- Serie A
- Bundesliga
- Ligue 1

The v0.1 pilot uses the public Football-Data.co.uk 2025/26 datasets. It is a historical research/backfill pilot, not a claim of complete current/live global coverage.

## Canonical identity

Every settled match receives a competition-scoped identity derived from:

`competition_id + season + date + home + away`

Competition identity is explicit. Gate2 history is grouped and processed separately per competition, so an EPL match can never warm a La Liga team's chronological history.

## Results and football statistics

The adapter preserves settled FT results and, when supplied, HT goals, shots and shots on target. Raw source rows are SHA-256 hashed and the runtime pilot also hashes each downloaded source CSV.

## Market evidence

Football-Data datasets may contain source-defined closing price columns. Those values may be retained as historical research observations, but they do **not** automatically become strict Gate1/P002 evidence.

Every v0.1 pilot record is explicitly:

- `qualification_scope = RESEARCH_BACKFILL_ONLY`
- `strict_gate1_eligible = false`
- `bookmaker_odds_used_as_model_input = false`

The adapter does not fabricate O3.5/U3.5 when the source does not provide that pair. Gate2 therefore receives no invented U3.5 market probability.

## Real pilot

`scripts/run_global_multileague_pilot.py` downloads the five registered 2025/26 CSVs, hashes each raw payload, parses settled records, builds Gate2 features independently per competition and writes a coverage artifact.

The pilot reports data coverage only: settled count, warm-up count, model-probability count and available source closing columns. It does not grant qualification, promotion or capital readiness.

## Governance

No P002 threshold, Gate4 promotion threshold, Test B state, model coefficient or capital rule is changed. Capital remains locked and `realMoney` remains `NO`.
