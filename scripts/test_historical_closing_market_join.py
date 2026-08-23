from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))
sys.path.insert(0, str(ROOT / "packages" / "gate2"))

from historical_truth_importer import HistoricalTruthInput, import_historical_rows
from historical_market_join import join_historical_markets, parse_footiqo_odds_csv
from canonical_backfill import build_backfill_from_truth_store


truth_rows = [
    HistoricalTruthInput("2026-02-21", 2026, "MLS", "St. Louis City", "Charlotte", 1, 1, "Official A", "https://example.test/a", True),
    HistoricalTruthInput("2026-02-21", 2026, "MLS", "Vancouver Whitecaps", "Real Salt Lake", 1, 0, "Official B", "https://example.test/b", True),
    HistoricalTruthInput("2026-02-21", 2026, "MLS", "DC United", "Philadelphia Union", 1, 0, "Official C", "https://example.test/c", True),
]
store = import_historical_rows(truth_rows, dataset_id="JOIN-TEST")

FOOTIQO = """id,matchDate,Country,League,Season,homeTeam,awayTeam,O25,U25,O35,U35
97190,21-02-26 20:30,USA,MLS,2026,St. Louis City,Charlotte,1.75,2.10,2.82,1.45
97195,22-02-26 01:30,USA,MLS,2026,Vancouver Whitecaps,Real Salt Lake,1.46,2.75,2.21,1.73
97193,22-02-26 01:30,USA,MLS,2026,DC United,Philadelphia Union,2.32,1.67,4.05,1.25
"""
observations = parse_footiqo_odds_csv(FOOTIQO, source_url="https://footiqo.com/database/leagues/usa-mls/")
assert len(observations) == 3

joined = join_historical_markets(store, observations)
summary = joined["market_join"]["summary"]
assert summary["records_joined_to_closing_market"] == 3
assert summary["target_line_o35_u35_ready"] == 3
assert summary["gate1_validation_n_eligible"] == 1
assert summary["market_conflicts_quarantined"] == 0

vancouver = next(x for x in joined["records"] if x["home_team"] == "vancouver whitecaps")
assert vancouver["market"]["provider"] == "1xBet"
assert vancouver["market"]["quote_type"] == "CLOSING"
assert vancouver["market"]["source_match_date"] == "2026-02-22"
assert vancouver["gate1_validation_n_eligible"] is True

st_louis = next(x for x in joined["records"] if x["home_team"] == "st louis city")
assert st_louis["market"]["market_join_eligible"] is True
assert st_louis["gate1_validation_n_eligible"] is False

backfill = build_backfill_from_truth_store(joined)
assert backfill["summary"]["matches_backfilled"] == 3
assert backfill["summary"]["market_probability_available"] == 3
assert backfill["summary"]["model_probability_available"] == 0

# Two different closing observations at the same closest date must fail closed.
conflicting_text = FOOTIQO + "97195b,22-02-26 01:30,USA,MLS,2026,Vancouver Whitecaps,Real Salt Lake,1.50,2.60,2.30,1.65\n"
conflicted = join_historical_markets(store, parse_footiqo_odds_csv(conflicting_text, source_url="https://footiqo.com/database/leagues/usa-mls/"))
assert conflicted["market_join"]["summary"]["market_conflicts_quarantined"] == 1
conflicted_vancouver = next(x for x in conflicted["records"] if x["home_team"] == "vancouver whitecaps")
assert conflicted_vancouver["market"]["status"] == "MISSING"

print("HISTORICAL_CLOSING_MARKET_JOIN=PASS")
