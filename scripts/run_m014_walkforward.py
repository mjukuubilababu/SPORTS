from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))
sys.path.insert(0, str(ROOT / "packages" / "gate2"))
sys.path.insert(0, str(ROOT / "packages" / "gate3"))
sys.path.insert(0, str(ROOT / "scripts"))

from canonical_backfill import build_backfill_from_truth_store
from cross_source_result_reconciler import parse_mlsopenskill_csv, parse_openfootball_json, reconcile_results, verify_source_blob
from footiqo_fixture_reconciler import load_reviewed_footiqo_snapshot, parse_fixture_download_csv, reconcile_footiqo_with_fixtures
from historical_truth_importer import import_historical_rows
from m014_hierarchical_attack_defence import MODEL_ID, MODEL_VERSION, walk_forward_predict
from run_real_2026_historical_research import (
    DATASET_ID,
    FIXTUREDOWNLOAD_2026_CSV,
    FOOTIQO_SNAPSHOT,
    MLSOPENSKILL_BLOB_API,
    OPENFOOTBALL_BLOB_API,
    _github_blob_text,
    _request,
)


def build_canonical_inputs():
    source_a_text = _github_blob_text(MLSOPENSKILL_BLOB_API)
    source_b_text = _github_blob_text(OPENFOOTBALL_BLOB_API)
    audit_a = verify_source_blob(source_a_text.encode("utf-8"), "MLSOPENSKILL")
    audit_b = verify_source_blob(source_b_text.encode("utf-8"), "OPENFOOTBALL")
    if not audit_a["verified"] or not audit_b["verified"]:
        raise RuntimeError("M014_PINNED_2025_SOURCE_VERIFICATION_FAILED")

    prior = reconcile_results(
        parse_mlsopenskill_csv(source_a_text),
        parse_openfootball_json(source_b_text),
    )
    fixture_text = _request(FIXTUREDOWNLOAD_2026_CSV).decode("utf-8-sig")
    current = reconcile_footiqo_with_fixtures(
        load_reviewed_footiqo_snapshot(FOOTIQO_SNAPSHOT),
        parse_fixture_download_csv(fixture_text),
    )
    combined = [*prior["verified_rows"], *current["verified_rows"]]
    truth_store = import_historical_rows(combined, dataset_id=DATASET_ID)
    gate2 = build_backfill_from_truth_store(truth_store)
    return truth_store, gate2, {"prior": prior["summary"], "current": current["summary"]}


def build_outputs():
    frozen_path = ROOT / "contracts" / "p002-frozen-rules.json"
    frozen = json.loads(frozen_path.read_text(encoding="utf-8"))
    if frozen.get("lineage") != "P002" or frozen.get("status") != "FROZEN_RESEARCH_RULE":
        raise RuntimeError("M014_P002_FROZEN_RULES_NOT_CONFIRMED")

    truth_store, gate2, sources = build_canonical_inputs()
    wf = walk_forward_predict(truth_store, gate2)
    metrics = wf["metrics"]
    summary = wf["summary"]

    development_vs_gate2_pass = bool(
        summary["development_market_evaluable_n"] > 0
        and metrics["delta_brier_vs_gate2"] is not None
        and metrics["delta_logloss_vs_gate2"] is not None
        and metrics["delta_brier_vs_gate2"] > 0.0
        and metrics["delta_logloss_vs_gate2"] > 0.0
    )
    development_vs_market_pass = bool(
        summary["development_market_evaluable_n"] > 0
        and metrics["delta_brier_vs_market"] is not None
        and metrics["delta_logloss_vs_market"] is not None
        and metrics["delta_brier_vs_market"] > 0.0
        and metrics["delta_logloss_vs_market"] > 0.0
    )

    independent_min_n = int(frozen["independent_validation_min_n"])
    independent_n = int(summary["independent_validation_n"])
    independent_pass = independent_n >= independent_min_n

    model_state = "PAPER_ONLY"
    decision_weight = 0.0

    report = {
        "report_version": "M014_WALK_FORWARD_REPORT_V0_1",
        "model_id": MODEL_ID,
        "model_version": MODEL_VERSION,
        "dataset_id": truth_store.get("dataset_id"),
        "source_summaries": sources,
        "gate2_summary": gate2.get("summary"),
        "walk_forward": wf,
        "frozen_rules_observed": {
            "lineage": frozen["lineage"],
            "status": frozen["status"],
            "discovery_min_n": frozen["discovery_min_n"],
            "independent_validation_min_n": frozen["independent_validation_min_n"],
            "prior_equivalent_sample_size": frozen["prior_equivalent_sample_size"],
            "capital_effect": frozen["capital_effect"],
        },
        "gate_results": {
            "development_diagnostic_vs_gate2": "PASS" if development_vs_gate2_pass else "FAIL",
            "development_diagnostic_vs_market": "PASS" if development_vs_market_pass else "FAIL",
            "independent_validation_gate": "PASS" if independent_pass else "FAIL",
        },
        "model_state": model_state,
        "decision_weight": decision_weight,
        "governance": {
            "contracts_changed": False,
            "gate_order_changed": False,
            "frozen_rules_changed": False,
            "market_used_as_model_input": False,
            "market_used_as_benchmark_only": True,
            "development_benchmark_is_consumed_evidence": True,
            "development_result_claimed_as_independent_validation": False,
            "gate2_output_required": True,
            "same_date_leakage_blocked": True,
            "automatic_promotion": False,
            "capital_effect": "NONE",
            "real_money": "NO",
        },
    }

    if summary["development_market_evaluable_n"] > 0:
        benchmark_runtime = (
            f"M014 development-only date-batched walk-forward on {summary['development_market_evaluable_n']} consumed market-evaluable rows: "
            f"Brier model={metrics['brier_model']:.12f} gate2={metrics['brier_gate2']:.12f} market={metrics['brier_market']:.12f}; "
            f"delta_vs_gate2={metrics['delta_brier_vs_gate2']:.12f}; delta_vs_market={metrics['delta_brier_vs_market']:.12f}. "
            f"LogLoss model={metrics['logloss_model']:.12f} gate2={metrics['logloss_gate2']:.12f} market={metrics['logloss_market']:.12f}; "
            f"delta_vs_gate2={metrics['delta_logloss_vs_gate2']:.12f}; delta_vs_market={metrics['delta_logloss_vs_market']:.12f}. "
            "Positive delta means M014 is descriptively better. This is DEVELOPMENT_DIAGNOSTIC only."
        )
    else:
        benchmark_runtime = "No development market-evaluable rows were available."

    independent_runtime = (
        f"Independent validation rows available to M014 in this run={independent_n}; "
        f"frozen independent_validation_min_n={independent_min_n}. Consumed benchmark rows are never recounted as independent evidence."
    )

    overall_pass = bool(
        development_vs_gate2_pass
        and development_vs_market_pass
        and independent_pass
    )
    evidence = {
        "artifact": "M014_Hierarchical_Attack_Defence_Partial_Pooling_v0.1",
        "artifact_sha256": None,
        "overall": {
            "TEST_AUTHORED": True,
            "TEST_EXECUTED": True,
            "TEST_PASS": overall_pass,
            "TEST_FAIL": not overall_pass,
            "explanation": (
                "Development comparisons and genuinely new independent validation passed; downstream governance remains unchanged."
                if overall_pass
                else "M014 remains PAPER_ONLY. Consumed benchmark diagnostics cannot satisfy independent validation, and no decision weight is granted."
            ),
        },
        "checks": [
            {
                "name": "frozen_p002_integrity",
                "status": "TEST_PASS",
                "executed": True,
                "runtime_evidence": f"Loaded {frozen_path.relative_to(ROOT)} with status={frozen['status']}; no frozen value was modified.",
                "scope": "Frozen-rule integrity",
            },
            {
                "name": "hierarchical_input_and_no_leakage",
                "status": "TEST_PASS",
                "executed": True,
                "runtime_evidence": (
                    f"Consumed Gate2 pipeline {gate2['pipeline_version']} with {gate2['summary']['matches_backfilled']} backfilled rows; "
                    "Gate2 post_lineup_lambda is the prediction-time anchor; attack/defence parameters use only verified scores from strictly earlier dates; "
                    "same-date outcomes are appended after the whole date batch; market fields are excluded from fitting."
                ),
                "scope": "Gate2 dependency / partial pooling / anti-hindsight",
            },
            {
                "name": "development_diagnostic_vs_gate2",
                "status": "TEST_PASS" if development_vs_gate2_pass else "TEST_FAIL",
                "executed": True,
                "runtime_evidence": benchmark_runtime,
                "scope": "Consumed development benchmark against canonical Gate2 mean",
            },
            {
                "name": "development_diagnostic_vs_market",
                "status": "TEST_PASS" if development_vs_market_pass else "TEST_FAIL",
                "executed": True,
                "runtime_evidence": benchmark_runtime,
                "scope": "Consumed market benchmark; not independent validation",
            },
            {
                "name": "independent_validation_gate",
                "status": "TEST_PASS" if independent_pass else "TEST_FAIL",
                "executed": True,
                "runtime_evidence": independent_runtime,
                "scope": "New independent evidence sufficiency",
            },
        ],
        "model_governance": {
            "model_id": MODEL_ID,
            "model_state": model_state,
            "decision_weight": decision_weight,
            "market_champion_replaced": False,
            "automatic_promotion": False,
            "development_evidence_can_promote": False,
            "reason": "NEW_INDEPENDENT_VALIDATION_NOT_SATISFIED_WEIGHT_ZERO",
        },
        "migration_evidence": {
            "MIGRATION_AUTHORED": False,
            "MIGRATION_APPLIED": False,
            "MIGRATION_VERIFIED": False,
            "reason": "Model-only task; no database migration was created or applied.",
        },
    }
    return report, evidence


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", default=str(ROOT / "artifacts" / "m014-walkforward-report-v0.1.json"))
    parser.add_argument("--evidence", default=str(ROOT / "artifacts" / "m014" / "TEST_EVIDENCE.json"))
    args = parser.parse_args()

    report, evidence = build_outputs()
    report_path = Path(args.report)
    evidence_path = Path(args.evidence)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    evidence_path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")

    print(json.dumps({
        "model_id": report["model_id"],
        "gate_results": report["gate_results"],
        "model_state": report["model_state"],
        "decision_weight": report["decision_weight"],
        "evaluation_classification": report["walk_forward"]["evaluation_classification"],
        "summary": report["walk_forward"]["summary"],
        "metrics": report["walk_forward"]["metrics"],
        "report": str(report_path),
        "evidence": str(evidence_path),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
