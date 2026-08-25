from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate3"))

from m011r_bayesian_calibrator import MODEL_ID, MODEL_VERSION
from m011r_significance_test import (
    DEFAULT_BOOTSTRAP_REPS,
    DEFAULT_CONFIDENCE,
    DEFAULT_SEED,
    paired_bootstrap_significance,
)


def build_outputs(m011r_report: dict, frozen_rules: dict, *, reps: int, seed: int, confidence: float):
    if m011r_report.get("report_version") != "M011R_WALK_FORWARD_REPORT_V0_1":
        raise RuntimeError("M011R_SIGNIFICANCE_REQUIRES_WALK_FORWARD_REPORT_V0_1")
    if m011r_report.get("model_id") != MODEL_ID or m011r_report.get("model_version") != MODEL_VERSION:
        raise RuntimeError("M011R_SIGNIFICANCE_MODEL_IDENTITY_MISMATCH")
    if frozen_rules.get("lineage") != "P002" or frozen_rules.get("status") != "FROZEN_RESEARCH_RULE":
        raise RuntimeError("M011R_SIGNIFICANCE_P002_FROZEN_RULES_NOT_CONFIRMED")

    walk_forward = m011r_report.get("walk_forward") or {}
    result = paired_bootstrap_significance(
        walk_forward,
        reps=reps,
        seed=seed,
        confidence=confidence,
    )

    reported_metrics = walk_forward.get("metrics") or {}
    brier_delta = result["delta_brier_vs_market"]["observed_delta"]
    logloss_delta = result["delta_logloss_vs_market"]["observed_delta"]
    if abs(brier_delta - float(reported_metrics["delta_brier_vs_market"])) > 1e-12:
        raise RuntimeError("M011R_SIGNIFICANCE_BRIER_POINT_ESTIMATE_MISMATCH")
    if abs(logloss_delta - float(reported_metrics["delta_logloss_vs_market"])) > 1e-12:
        raise RuntimeError("M011R_SIGNIFICANCE_LOGLOSS_POINT_ESTIMATE_MISMATCH")

    report = {
        "report_version": "M011R_SIGNIFICANCE_REPORT_V0_1",
        "source_report_version": m011r_report["report_version"],
        "model_id": MODEL_ID,
        "model_version": MODEL_VERSION,
        "dataset_id": m011r_report.get("dataset_id"),
        "analysis": result,
        "frozen_rules_observed": {
            "lineage": frozen_rules["lineage"],
            "status": frozen_rules["status"],
            "independent_validation_min_n": frozen_rules["independent_validation_min_n"],
            "capital_effect": frozen_rules["capital_effect"],
        },
        "interpretation": {
            "development_only": True,
            "independent_validation_claimed": False,
            "new_market_evaluable_rows_added": 0,
            "promotion_decision": "NO_CHANGE",
            "model_state": "PAPER_ONLY",
            "decision_weight": 0.0,
            "capital_effect": "NONE",
            "real_money": "NO",
        },
    }

    both_ci_exclude_zero_positive = bool(
        result["delta_brier_vs_market"]["ci_lower"] > 0.0
        and result["delta_logloss_vs_market"]["ci_lower"] > 0.0
    )
    evidence = {
        "artifact": "M011R_Paired_Bootstrap_Significance_v0.1",
        "overall": {
            "TEST_AUTHORED": True,
            "TEST_EXECUTED": True,
            "INFRASTRUCTURE_TEST_PASS": True,
            "DEVELOPMENT_CI_BOTH_POSITIVE": both_ci_exclude_zero_positive,
            "MODEL_VALIDATION_PASS": False,
            "explanation": (
                "Paired bootstrap analysis executed on consumed development rows only. CI behavior is descriptive development evidence and cannot satisfy independent validation or promotion gates."
            ),
        },
        "checks": [
            {
                "name": "m011r_identity_frozen",
                "status": "TEST_PASS",
                "executed": True,
                "runtime_evidence": f"model_id={MODEL_ID}; model_version={MODEL_VERSION}; source report identity matched.",
            },
            {
                "name": "p002_integrity",
                "status": "TEST_PASS",
                "executed": True,
                "runtime_evidence": f"P002 status={frozen_rules['status']}; no frozen value was modified.",
            },
            {
                "name": "paired_bootstrap_development_only",
                "status": "TEST_PASS",
                "executed": True,
                "runtime_evidence": (
                    f"N={result['market_evaluable_n']}; reps={result['bootstrap_reps']}; seed={result['seed']}; "
                    f"Brier delta={brier_delta:.12f} 95% CI=[{result['delta_brier_vs_market']['ci_lower']:.12f}, {result['delta_brier_vs_market']['ci_upper']:.12f}]; "
                    f"LogLoss delta={logloss_delta:.12f} 95% CI=[{result['delta_logloss_vs_market']['ci_lower']:.12f}, {result['delta_logloss_vs_market']['ci_upper']:.12f}]."
                ),
            },
        ],
        "governance": result["governance"],
    }
    return report, evidence


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--m011r-report", default=str(ROOT / "artifacts" / "m011r-walkforward-report-v0.1.json"))
    parser.add_argument("--frozen-rules", default=str(ROOT / "contracts" / "p002-frozen-rules.json"))
    parser.add_argument("--report", default=str(ROOT / "artifacts" / "m011r-significance-report-v0.1.json"))
    parser.add_argument("--evidence", default=str(ROOT / "artifacts" / "m011r-significance" / "TEST_EVIDENCE.json"))
    parser.add_argument("--bootstrap-reps", type=int, default=DEFAULT_BOOTSTRAP_REPS)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--confidence", type=float, default=DEFAULT_CONFIDENCE)
    args = parser.parse_args()

    m011r_report = json.loads(Path(args.m011r_report).read_text(encoding="utf-8"))
    frozen_rules = json.loads(Path(args.frozen_rules).read_text(encoding="utf-8"))
    report, evidence = build_outputs(
        m011r_report,
        frozen_rules,
        reps=args.bootstrap_reps,
        seed=args.seed,
        confidence=args.confidence,
    )

    report_path = Path(args.report)
    evidence_path = Path(args.evidence)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    evidence_path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")

    print(json.dumps({
        "model_id": MODEL_ID,
        "evaluation_classification": report["analysis"]["evaluation_classification"],
        "market_evaluable_n": report["analysis"]["market_evaluable_n"],
        "delta_brier_vs_market": report["analysis"]["delta_brier_vs_market"],
        "delta_logloss_vs_market": report["analysis"]["delta_logloss_vs_market"],
        "model_state": report["interpretation"]["model_state"],
        "decision_weight": report["interpretation"]["decision_weight"],
        "report": str(report_path),
        "evidence": str(evidence_path),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
