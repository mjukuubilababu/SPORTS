from __future__ import annotations

from typing import Dict, List

from gate2_engine import Match, build_features, feature_row_to_dict


SUPPORTED_STORE_VERSION = "CANONICAL_HISTORICAL_TRUTH_STORE_V0_1"


def matches_from_truth_store(store: Dict) -> List[Match]:
    if store.get("store_version") != SUPPORTED_STORE_VERSION:
        raise ValueError("UNSUPPORTED_TRUTH_STORE_VERSION")
    if store.get("data_nature") != "REAL_HISTORICAL_TRUTH":
        raise ValueError("TRUTH_STORE_DATA_NATURE_INVALID")

    matches: List[Match] = []
    for record in store.get("records", []):
        if record.get("gate2_backfill_eligible") is not True:
            continue
        score = record.get("final_score") or {}
        market = record.get("market") or {}
        matches.append(Match(
            date=record["canonical_match_date"],
            season=int(record["season"]),
            league=record["league"],
            home=record["home_team"],
            away=record["away_team"],
            hg=int(score["home"]),
            ag=int(score["away"]),
            o25=market.get("o25"),
            o35=market.get("o35"),
            u35=market.get("u35"),
            quote_verified=bool(record.get("gate1_validation_n_eligible")),
            lineup_state="UNKNOWN",
            attacking_upgrade=False,
        ))

    return sorted(matches, key=lambda m: (m.date, m.home, m.away))


def build_backfill_from_truth_store(store: Dict) -> Dict:
    matches = matches_from_truth_store(store)
    feature_rows = build_features(matches)
    return {
        "pipeline_version": "GATE1_TO_GATE2_CANONICAL_BACKFILL_V0_1",
        "source_dataset_id": store.get("dataset_id"),
        "source_store_version": store.get("store_version"),
        "data_nature": "REAL_HISTORICAL_BACKFILL",
        "summary": {
            "truth_records_received": len(store.get("records", [])),
            "matches_backfilled": len(matches),
            "warmup_pass": sum(1 for row in feature_rows if row.warmup_pass),
            "warmup_pending": sum(1 for row in feature_rows if not row.warmup_pass),
            "model_probability_available": sum(1 for row in feature_rows if row.model_u35_prob is not None),
            "market_probability_available": sum(1 for row in feature_rows if row.market_u35_prob is not None),
            "final_model_pass": sum(1 for row in feature_rows if row.final_model_gate == "PASS"),
        },
        "features": [feature_row_to_dict(row) for row in feature_rows],
        "governance": {
            "gate1_truth_store_is_only_input": True,
            "current_match_appended_after_feature_computation": True,
            "no_template_row_injection": True,
            "insufficient_history_remains_pending": True,
        },
    }
