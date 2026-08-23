from __future__ import annotations

import csv
import sys
from dataclasses import replace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))
sys.path.insert(0, str(ROOT / "packages" / "gate2"))

from historical_truth_importer import import_historical_rows, input_from_mapping
from canonical_backfill import build_backfill_from_truth_store


seed_path = ROOT / "packages" / "gate1" / "gate1_real_historical_seed_2026_mls.csv"
with seed_path.open(newline="", encoding="utf-8") as handle:
    seed = [input_from_mapping(row) for row in csv.DictReader(handle)]

store = import_historical_rows(seed, dataset_id="MLS-2026-OPENING-REAL-SEED-V0.1")
summary = store["summary"]

assert summary["rows_received"] == 6
assert summary["canonical_matches"] == 6
assert summary["gate2_backfill_eligible"] == 6
assert summary["gate1_validation_n_eligible"] == 1
assert summary["conflicting_matches_quarantined"] == 0

# Venue-local canonical date is independent of an archive's source-reported date.
dc = next(x for x in store["records"] if x["home_team"] == "dc united")
assert dc["canonical_match_date"] == "2026-02-21"
assert dc["market"]["source_match_date"] == "2026-02-22"

# Vancouver is the only seed row satisfying the frozen Gate1 O2.5/U3.5 price gate.
validation_rows = [x for x in store["records"] if x["gate1_validation_n_eligible"]]
assert len(validation_rows) == 1
assert validation_rows[0]["home_team"] == "vancouver whitecaps"

backfill = build_backfill_from_truth_store(store)
assert backfill["summary"]["matches_backfilled"] == 6
assert backfill["summary"]["warmup_pass"] == 0
assert backfill["summary"]["warmup_pending"] == 6
assert backfill["summary"]["model_probability_available"] == 0

# Conflicting final scores for one canonical identity must be quarantined.
conflict = replace(seed[0], home_goals=9, away_goals=9)
conflicted = import_historical_rows([seed[0], conflict], dataset_id="CONFLICT-TEST")
assert conflicted["summary"]["conflicting_matches_quarantined"] == 1
assert conflicted["summary"]["canonical_matches"] == 0

# An unverified result must never enter Gate2 even if market data exists.
unverified = replace(seed[1], result_verified=False)
unverified_store = import_historical_rows([unverified], dataset_id="UNVERIFIED-TEST")
assert unverified_store["summary"]["gate2_backfill_eligible"] == 0
assert build_backfill_from_truth_store(unverified_store)["summary"]["matches_backfilled"] == 0

print("CANONICAL_HISTORICAL_TRUTH_BACKFILL=PASS")
