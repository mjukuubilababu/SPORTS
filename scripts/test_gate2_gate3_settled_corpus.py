from __future__ import annotations

import copy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))
sys.path.insert(0, str(ROOT / "packages" / "gate2"))
sys.path.insert(0, str(ROOT / "packages" / "gate3"))

from historical_truth_importer import HistoricalTruthInput, import_historical_rows
from canonical_backfill import build_backfill_from_truth_store
from canonical_settlement_adapter import build_settled_corpus, evaluate_settled_corpus


def truth(date, home, away, hg, ag):
    return HistoricalTruthInput(
        match_date=date,
        season=2025,
        league="MLS",
        home_team=home,
        away_team=away,
        home_goals=hg,
        away_goals=ag,
        result_source="Official Test Source",
        result_source_url="https://example.test/result",
        result_verified=True,
        o25=1.46,
        u25=2.75,
        o35=2.21,
        u35=1.73,
        market_source="Footiqo",
        market_provider="1xBet",
        market_source_url="https://footiqo.com/database/leagues/usa-mls/",
        market_source_match_date=date,
        quote_type="CLOSING",
    )


rows = [
    truth("2025-01-01", "A", "X", 1, 0),
    truth("2025-01-02", "Y", "B", 0, 2),
    truth("2025-01-08", "A", "Y", 2, 1),
    truth("2025-01-09", "X", "B", 1, 1),
    truth("2025-01-15", "A", "X", 1, 2),
    truth("2025-01-16", "Y", "B", 2, 3),
    truth("2025-01-23", "A", "B", 4, 4),
]
store = import_historical_rows(rows, dataset_id="GATE2-GATE3-TEST")
backfill = build_backfill_from_truth_store(store)

assert all(feature.get("match_id") for feature in backfill["features"])
assert all("final_score" not in feature for feature in backfill["features"])
assert backfill["summary"]["model_probability_available"] == 1
assert backfill["summary"]["market_probability_available"] == 7

corpus = build_settled_corpus(store, backfill)
assert corpus["summary"]["research_eligible"] == 1
assert corpus["summary"]["strict_pattern_qualified"] == 0
assert corpus["summary"]["clv_available"] == 0

settled = next(row for row in corpus["rows"] if row["research_eligible"])
assert settled["outcome_u35"] == 0
assert settled["reference_price_semantics"] == "CLOSING_REFERENCE_NOT_EXECUTION_ENTRY"
assert settled["clv_available"] is False
assert "STRICT_GATE2_MODEL_GATE_NOT_PASS" in settled["reasons"]

report = evaluate_settled_corpus(corpus, bootstrap_reps=100, seed=11)
assert report["research_model_market_report"]["n"] == 1
assert report["research_model_market_report"]["clv_n"] == 0
assert report["research_report_promotion_allowed"] is False
assert report["strict_p002_validation_report"]["n"] == 0
assert report["strict_p002_promotion_readiness"]["pass"] is False

# Adapter honors existing strict states when all upstream gates are explicitly PASS.
strict_backfill = copy.deepcopy(backfill)
strict_feature = next(feature for feature in strict_backfill["features"] if feature["model_u35_prob"] is not None)
strict_feature["final_model_gate"] = "PASS"
strict_feature["lineup_gate"] = "PASS"
strict_corpus = build_settled_corpus(store, strict_backfill)
assert strict_corpus["summary"]["strict_pattern_qualified"] == 1
strict_report = evaluate_settled_corpus(strict_corpus, bootstrap_reps=100, seed=11)
assert strict_report["strict_p002_validation_report"]["n"] == 1
assert strict_report["strict_p002_promotion_readiness"]["pass"] is False  # N<30 and CLV unavailable.

print("GATE2_GATE3_SETTLED_CORPUS=PASS")
