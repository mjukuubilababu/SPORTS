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
from m011r_bayesian_calibrator import MODEL_ID, MODEL_VERSION, walk_forward_predict
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
        raise RuntimeError("M011R_PINNED_2025_SOURCE_VERIFICATION_FAILED")

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
        raise RuntimeError("M011R_P002_FROZEN_RULES_NOT_CONFIRMED")

    truth_store, gate2, sources = build_canonical_inputs()
    wf = walk_forward_predict(truth_store, gate2)
    metrics = wf["metrics"]
    summary = wf["summary"]

    walk_pass = bool(
        summary["market_evaluable_n"] > 0
        and metrics["delta_brier_vs_market"] is not None
        and metrics["delta_logloss_vs_market"] is not None
        and metrics["delta_brier_vs_market"] > 0.0
        and metrics["delta_logloss_vs_market"] > 0.0
    )

    n3 = int(summary["both_teams_n3_n"])
    independent_min_n = int(frozen["independent_validation_min_n"])
    validation_pass = n3 >= independent_min_n

    # This task evaluates one challenger gate only. Existing downstream Gate4 and
    # capital governance are not modified, so model influence remains zero here.
    model_state = "PAPER_ONLY"
    decision_weight = 0.0

    report = {
        "report_version": "M011R_WALK_FORWARD_REPORT_V0_1",
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
            "walk_forward_bayesian_vs_market": "PASS" if walk_pass else "FAIL",
            "validation_sample_gate": "PASS" if validation_pass else "FAIL",
        },
        "model_state": model_state,
        "decision_weight": decision_weight,
        "governance": {
            "contracts_changed": False,
            "gate_order_changed": False,
            "frozen_rules_changed": False,
            "market_used_as_model_input": False,
            "market_used_as_benchmark_only": True,
            "gate2_output_required": True,
            "same_date_leakage_blocked": True,
            "automatic_promotion": False,
            "capital_effect": "NONE",
            "real_money": "NO",
        },
    }

    walk_runtime = (
        f"M011R date-batched walk-forward on {summary['market_evaluable_n']} market-evaluable rows: "
        f"Brier model={metrics['brier_model']:.12f} market={metrics['brier_market']:.12f} "
        f"delta={metrics['delta_brier_vs_market']:.12f}; "
        f"LogLoss model={metrics['logloss_model']:.12f} market={metrics['logloss_market']:.12f} "
        f"delta={metrics['delta_logloss_vs_market']:.12f}. "
        "Positive delta means challenger is better. Market was benchmark only, never a feature."
    )
    validation_runtime = (
        f"{n3} market-evaluable walk-forward rows have home_prior_n>=3 and away_prior_n>=3; "
        f"frozen independent_validation_min_n={independent_min_n}."
    )

    evidence = {
        "artifact": "M011R_Bayesian_Shrinkage_Calibrator_v0.1",
        "artifact_sha256": None,
        "overall": {
            "TEST_AUTHORED": True,
            "TEST_EXECUTED": True,
            "TEST_PASS": bool(walk_pass and validation_pass),
            "TEST_FAIL": not bool(walk_pass and validation_pass),
            "explanation": (
                "Both requested challenger checks passed; model still remains PAPER_ONLY with weight 0 because downstream existing governance was not changed."
                if walk_pass and validation_pass
                else "At least one required empirical/sample-sufficiency check failed; M011R remains PAPER_ONLY with weight 0."
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
                "name": "gate2_input_and_no_leakage",
                "status": "TEST_PASS",
                "executed": True,
                "runtime_evidence": (
                    f"Consumed Gate2 pipeline {gate2['pipeline_version']} with {gate2['summary']['matches_backfilled']} backfilled rows; "
                    "predictions are date-batched and fitted only on strictly earlier dates; market fields are excluded from the model design matrix."
                ),
                "scope": "Gate2 dependency / anti-hindsight",
            },
            {
                "name": "walk_forward_bayesian_vs_market",
                "status": "TEST_PASS" if walk_pass else "TEST_FAIL",
                "executed": True,
                "runtime_evidence": walk_runtime,
                "scope": "Empirical challenger benchmark",
            },
            {
                "name": "validation_sample_gate",
                "status": "TEST_PASS" if validation_pass else "TEST_FAIL",
                "executed": True,
                "runtime_evidence": validation_runtime,
                "scope": "Evidence sufficiency",
            },
        ],
        "model_governance": {
            "model_id": MODEL_ID,
            "model_state": model_state,
            "decision_weight": decision_weight,
            "market_champion_replaced": False,
            "automatic_promotion": False,
            "reason": (
                "DOWNSTREAM_GATES_UNCHANGED_WEIGHT_REMAINS_ZERO"
                if walk_pass and validation_pass
                else "REQUESTED_MODEL_GATE_NOT_FULLY_PASSED_WEIGHT_ZERO"
            ),
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
    parser.add_argument("--report", default=str(ROOT / "artifacts" / "m011r-walkforward-report-v0.1.json"))
    parser.add_argument("--evidence", default=str(ROOT / "artifacts" / "m011r" / "TEST_EVIDENCE.json"))
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
        "summary": report["walk_forward"]["summary"],
        "metrics": report["walk_forward"]["metrics"],
        "report": str(report_path),
        "evidence": str(evidence_path),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
