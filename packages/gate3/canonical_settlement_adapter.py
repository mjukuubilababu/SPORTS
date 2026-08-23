from __future__ import annotations

from dataclasses import asdict, replace
from math import isfinite
from typing import Dict, List

from gate3_engine import SettledPrediction, evaluate, promotion_readiness, report_to_dict


ADAPTER_VERSION = "GATE2_TO_GATE3_SETTLED_CORPUS_ADAPTER_V0_1"


def _finite_probability(value) -> bool:
    return isinstance(value, (int, float)) and isfinite(value) and 0.0 <= float(value) <= 1.0


def build_settled_corpus(truth_store: Dict, gate2_backfill: Dict) -> Dict:
    if truth_store.get("store_version") != "CANONICAL_HISTORICAL_TRUTH_STORE_V0_1":
        raise ValueError("UNSUPPORTED_TRUTH_STORE_VERSION")
    if gate2_backfill.get("pipeline_version") != "GATE1_TO_GATE2_CANONICAL_BACKFILL_V0_1":
        raise ValueError("UNSUPPORTED_GATE2_BACKFILL_VERSION")
    if gate2_backfill.get("source_dataset_id") != truth_store.get("dataset_id"):
        raise ValueError("DATASET_ID_MISMATCH")

    truth_by_id = {record["match_id"]: record for record in truth_store.get("records", [])}
    research_predictions: List[SettledPrediction] = []
    strict_predictions: List[SettledPrediction] = []
    rows: List[Dict] = []
    quarantine: List[Dict] = []

    for feature in gate2_backfill.get("features", []):
        match_id = feature.get("match_id")
        record = truth_by_id.get(match_id)
        if record is None:
            quarantine.append({"match_id": match_id, "reason": "SETTLEMENT_TRUTH_RECORD_MISSING"})
            continue

        market = record.get("market") or {}
        result = record.get("result") or {}
        score = record.get("final_score") or {}

        model_ready = _finite_probability(feature.get("model_u35_prob"))
        market_ready = (
            _finite_probability(feature.get("market_u35_prob"))
            and isinstance(market.get("u35"), (int, float))
            and market.get("u35") > 1
            and isinstance(market.get("o35"), (int, float))
            and market.get("o35") > 1
            and market.get("status") == "ACCEPTED"
        )
        result_ready = (
            result.get("verified") is True
            and isinstance(score.get("home"), int) and score["home"] >= 0
            and isinstance(score.get("away"), int) and score["away"] >= 0
        )

        research_eligible = model_ready and market_ready and result_ready
        strict_qualified = bool(
            research_eligible
            and record.get("gate1_validation_n_eligible") is True
            and feature.get("final_model_gate") == "PASS"
        )

        reasons = []
        if not model_ready:
            reasons.append("MODEL_PROBABILITY_NOT_READY")
        if not market_ready:
            reasons.append("MARKET_PROBABILITY_NOT_READY")
        if not result_ready:
            reasons.append("SETTLEMENT_RESULT_NOT_VERIFIED")
        if research_eligible and record.get("gate1_validation_n_eligible") is not True:
            reasons.append("P002_GATE1_VALIDATION_N_NOT_ELIGIBLE")
        if research_eligible and feature.get("final_model_gate") != "PASS":
            reasons.append("STRICT_GATE2_MODEL_GATE_NOT_PASS")

        output_row = {
            "match_id": match_id,
            "date": feature.get("date"),
            "season": feature.get("season"),
            "league": feature.get("league"),
            "home": feature.get("home"),
            "away": feature.get("away"),
            "model_prob": feature.get("model_u35_prob"),
            "market_prob": feature.get("market_u35_prob"),
            "outcome_u35": (1 if score.get("home", 0) + score.get("away", 0) <= 3 else 0) if result_ready else None,
            "reference_odds": market.get("u35"),
            "reference_price_semantics": "CLOSING_REFERENCE_NOT_EXECUTION_ENTRY",
            "distinct_entry_price_available": False,
            "clv_available": False,
            "research_eligible": research_eligible,
            "strict_pattern_qualified": strict_qualified,
            "gate1_validation_n_eligible": record.get("gate1_validation_n_eligible") is True,
            "gate2_final_model_gate": feature.get("final_model_gate"),
            "lineup_gate": feature.get("lineup_gate"),
            "reasons": reasons,
        }
        rows.append(output_row)

        if not research_eligible:
            continue

        prediction = SettledPrediction(
            match_id=match_id,
            model_prob=float(feature["model_u35_prob"]),
            market_prob=float(feature["market_u35_prob"]),
            outcome=output_row["outcome_u35"],
            entry_odds=float(market["u35"]),
            closing_odds=None,
            stake=1.0,
            qualified=strict_qualified,
            pattern_id="P002",
        )
        research_predictions.append(prediction)
        strict_predictions.append(prediction)

    return {
        "adapter_version": ADAPTER_VERSION,
        "source_dataset_id": truth_store.get("dataset_id"),
        "rows": rows,
        "research_predictions": research_predictions,
        "strict_predictions": strict_predictions,
        "quarantine": quarantine,
        "summary": {
            "feature_rows_received": len(gate2_backfill.get("features", [])),
            "research_eligible": len(research_predictions),
            "strict_pattern_qualified": sum(1 for row in research_predictions if row.qualified),
            "blocked_or_pending": sum(1 for row in rows if not row["research_eligible"]),
            "clv_available": 0,
            "quarantined": len(quarantine),
        },
        "governance": {
            "settlement_join_uses_match_id": True,
            "feature_snapshot_does_not_contain_outcome": True,
            "research_eligibility_not_pattern_qualification": True,
            "closing_reference_price_not_execution_entry": True,
            "clv_not_fabricated": True,
            "strict_qualification_uses_existing_gate1_and_gate2_states": True,
        },
    }


def evaluate_settled_corpus(corpus: Dict, *, bootstrap_reps: int = 5000, seed: int = 42) -> Dict:
    research_rows = corpus.get("research_predictions", [])
    strict_rows = corpus.get("strict_predictions", [])

    # Research benchmarking intentionally includes model/market/result-ready rows,
    # but these copies cannot be used for promotion readiness.
    research_copies = [replace(row, qualified=True) for row in research_rows]
    research_report = evaluate(research_copies, bootstrap_reps=bootstrap_reps, seed=seed)
    strict_report = evaluate(strict_rows, bootstrap_reps=bootstrap_reps, seed=seed)
    strict_promotion = promotion_readiness(strict_report)

    return {
        "adapter_version": corpus.get("adapter_version"),
        "source_dataset_id": corpus.get("source_dataset_id"),
        "summary": corpus.get("summary"),
        "research_model_market_report": report_to_dict(research_report),
        "research_report_promotion_allowed": False,
        "strict_p002_validation_report": report_to_dict(strict_report),
        "strict_p002_promotion_readiness": strict_promotion,
        "rows": corpus.get("rows"),
        "quarantine": corpus.get("quarantine"),
        "governance": {
            **corpus.get("governance", {}),
            "gate3_default_qualified_only_semantics_unchanged": True,
            "promotion_readiness_runs_on_strict_report_only": True,
            "research_report_cannot_unlock_pattern_or_capital": True,
        },
        "capital_effect": "NONE",
        "real_money": "NO",
    }
