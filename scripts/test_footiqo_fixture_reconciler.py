from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))

from footiqo_fixture_reconciler import (
    load_reviewed_footiqo_snapshot,
    parse_fixture_download_csv,
    reconcile_footiqo_with_fixtures,
    venue_local_date,
)


snapshot_path = ROOT / "packages" / "gate1" / "data" / "footiqo-mls-2026-public-closing-snapshot-v0.1.csv"
markets = load_reviewed_footiqo_snapshot(snapshot_path)
assert len(markets) == 25
assert markets[0].footiqo_id == "97190"
assert markets[0].home_team == "st louis city"
assert markets[1].away_team == "atlanta united fc"

fixture_csv = """Match Number,Round Number,Date,Location,Home Team,Away Team,Result
1,1,21/02/2026 19:30,Energizer Park,St. Louis CITY SC,Charlotte FC,1 - 1
2,1,21/02/2026 21:45,TQL Stadium,FC Cincinnati,Atlanta United,2 - 0
3,1,22/02/2026 00:30,Audi Field,D.C. United,Philadelphia Union,1 - 0
"""
fixtures = parse_fixture_download_csv(fixture_csv)
assert len(fixtures) == 3
assert fixtures[0].home_team == "st louis city"
assert fixtures[1].away_team == "atlanta united fc"
assert fixtures[2].home_team == "dc united"

# FixtureDownload is UTC. D.C. 00:30 UTC on Feb 22 is Feb 21 venue-local.
assert venue_local_date(fixtures[2]) == "2026-02-21"

reconciled = reconcile_footiqo_with_fixtures(markets[:3], fixtures)
assert reconciled["summary"]["cross_source_verified"] == 3
assert reconciled["summary"]["quarantined"] == 0
inputs = reconciled["verified_rows"]
assert inputs[0].market_source == "Footiqo"
assert inputs[0].market_provider == "1xBet"
assert inputs[0].result_source == "FixtureDownload"
assert inputs[2].match_date == "2026-02-21"
assert inputs[2].result_source_match_date == "2026-02-22"
assert inputs[2].market_source_match_date == "2026-02-22"

# A score mismatch must fail closed.
bad_fixture_csv = """Match Number,Round Number,Date,Location,Home Team,Away Team,Result
1,1,21/02/2026 19:30,Energizer Park,St. Louis CITY SC,Charlotte FC,9 - 9
"""
bad = reconcile_footiqo_with_fixtures(markets[:1], parse_fixture_download_csv(bad_fixture_csv))
assert bad["summary"]["cross_source_verified"] == 0
assert bad["summary"]["quarantined"] == 1
assert bad["quarantine"][0]["reason"] == "CROSS_SOURCE_SCORE_DISAGREEMENT"

print("FOOTIQO_FIXTURE_RECONCILER=PASS")
