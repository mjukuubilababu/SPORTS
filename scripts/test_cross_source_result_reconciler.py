from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))
sys.path.insert(0, str(ROOT / "packages" / "gate2"))

from cross_source_result_reconciler import (
    build_truth_store_from_source_texts,
    parse_mlsopenskill_csv,
    parse_openfootball_json,
    reconcile_results,
)
from canonical_backfill import build_backfill_from_truth_store


SOURCE_A = """Match Number,Round Number,Date,Location,Home Team,Away Team,Result
2,1,22/02/2025 21:45,BMO Stadium,LAFC,MIN,1 - 0
1,1,23/02/2025 00:30,Chase Stadium,MIA,NYC,2 - 2
3,1,23/02/2025 00:30,Mercedes-Benz Stadium,ATL,MTL,3 - 2
"""

SOURCE_B = """{
  "name": "Major League Soccer 2025",
  "matches": [
    {"round":"Matchday 1","date":"2025-02-22","time":"16:45","team1":"Los Angeles FC","team2":"Minnesota United FC","score":{"ft":[1,0],"ht":[0,0]}},
    {"round":"Matchday 1","date":"2025-02-22","time":"19:30","team1":"Inter Miami CF","team2":"New York City FC","score":{"ft":[2,2],"ht":[1,1]}},
    {"round":"Matchday 1","date":"2025-02-22","time":"19:30","team1":"Atlanta United FC","team2":"CF Montréal","score":{"ft":[3,2],"ht":[1,0]}}
  ]
}
"""

source_a = parse_mlsopenskill_csv(SOURCE_A)
source_b = parse_openfootball_json(SOURCE_B)
assert len(source_a) == 3
assert len(source_b) == 3

reconciliation = reconcile_results(source_a, source_b)
assert reconciliation["summary"]["cross_source_verified"] == 3
assert reconciliation["summary"]["source_a_quarantined"] == 0
assert reconciliation["summary"]["source_b_unmatched"] == 0

# UTC source date may be one day later than the canonical source date.
miami = next(row for row in reconciliation["verified_rows"] if row.home_team == "inter miami")
assert miami.match_date == "2025-02-22"
assert miami.result_crosscheck_match_date == "2025-02-23"
assert miami.result_verification_method == "CROSS_SOURCE_TEAM_SCORE_DATE_TOLERANCE_V0_1"

payload = build_truth_store_from_source_texts(SOURCE_A, SOURCE_B, dataset_id="TEST-CROSS-SOURCE")
store = payload["truth_store"]
assert store["summary"]["canonical_matches"] == 3
assert store["summary"]["cross_source_verified"] == 3
assert store["summary"]["gate2_backfill_eligible"] == 3
assert all(len(row["supporting_result_sources"]) == 2 for row in store["records"])

backfill = build_backfill_from_truth_store(store)
assert backfill["summary"]["matches_backfilled"] == 3
assert backfill["summary"]["warmup_pass"] == 0

# Same fixture and date but conflicting score must be quarantined.
bad_b = SOURCE_B.replace('"ft":[3,2]', '"ft":[9,9]')
bad = reconcile_results(parse_mlsopenskill_csv(SOURCE_A), parse_openfootball_json(bad_b))
assert bad["summary"]["cross_source_verified"] == 2
assert any(row["reason"] == "CROSS_SOURCE_SCORE_DISAGREEMENT" for row in bad["quarantine"])

# Missing result in one source cannot become verified truth.
missing_b = SOURCE_B.replace(',"score":{"ft":[2,2],"ht":[1,1]}', '')
missing = reconcile_results(parse_mlsopenskill_csv(SOURCE_A), parse_openfootball_json(missing_b))
assert missing["summary"]["cross_source_verified"] == 2
assert any(row["reason"] == "NO_CROSS_SOURCE_MATCH" for row in missing["quarantine"])

print("CROSS_SOURCE_RESULT_RECONCILER=PASS")
