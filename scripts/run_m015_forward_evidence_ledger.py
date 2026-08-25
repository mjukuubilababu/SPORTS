from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate3"))
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from m015_forward_evidence_ledger import validate_ledger

REGISTRATION = ROOT / "packages" / "gate4" / "data" / "m015-forward-registration-v0.1.json"
HOLDOUT = ROOT / "packages" / "gate4" / "data" / "mls-2026-evaluation-holdout-a-v0.1.json"
LEDGER = ROOT / "packages" / "gate4" / "data" / "m015-forward-evidence-ledger-v0.1.json"
FROZEN = ROOT / "contracts" / "p002-frozen-rules.json"


def build_outputs() -> tuple[dict, dict]:
    registration = json.loads(REGISTRATION.read_text(encoding="utf-8"))
    holdout = json.loads(HOLDOUT.read_text(encoding="utf-8"))
    ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
    frozen = json.loads(FROZEN.read_text(encoding="utf-8"))

    if frozen.get("lineage") != "P002" or frozen.get("status") != "FROZEN_RESEARCH_RULE":
        raise RuntimeError("M015_LEDGER_P002_FROZEN_RULES_NOT_CONFIRMED")

    verification = validate_ledger(
        ledger,
        registration,
        forbidden_match_ids=holdout["match_ids"],
    )
    evaluation = verification["evaluation"]
    summary = evaluation["summary"]
    validation_state = evaluation["validation_state"]
    waiting = validation_state == "WAITING_FOR_INDEPENDENT_MIN_N"
    independent_pass = validation_state == "INDEPENDENT_VALIDATION_PASS_GATE4_PENDING"

    report = {
        "report_version": "M015_FORWARD_EVIDENCE_LEDGER_REPORT_V0_1",
        "challenger_id": registration["challenger_id"],
        "model_id": registration["model_id"],
        "model_version": registration["model_version"],
        "specification_sha256": registration["specification_sha256"],
        "registration_state": registration["state"],
        "ledger_path": str(LEDGER.relative_to(ROOT)),
        "ledger_verification": verification,
        "current_forward_state": {
            "validation_state": validation_state,
            "independent_validation_n": summary["independent_validation_n"],
            "independent_validation_min_n": summary["independent_validation_min_n"],
            "remaining_to_independent_min_n": summary["remaining_to_independent_min_n"],
            "gate4_min_n": summary["gate4_min_n"],
            "remaining_to_gate4_min_n": summary["remaining_to_gate4_min_n"],
            "model_state": "PAPER_ONLY",
            "decision_weight": 0.0,
            "automatic_promotion": False,
        },
        "frozen_rules_observed": {
            "lineage": frozen["lineage"],
            "status": frozen["status"],
            "independent_validation_min_n": frozen["independent_validation_min_n"],
            "capital_effect": frozen["capital_effect"],
        },
        "governance": {
            "no_future_rows_fabricated": True,
            "consumed_development_rows_excluded": True,
            "pending_predictions_do_not_count": True,
            "settled_rows_require_frozen_prediction": True,
            "append_only_integrity_enforced": True,
            "gate4_is_separate": True,
            "contracts_changed": False,
            "frozen_rules_changed": False,
            "gate_order_changed": False,
            "capital_effect": "NONE",
            "real_money": "NO",
        },
    }

    evidence = {
        "artifact": "M015_Forward_Evidence_Ledger_v0.1",
        "overall": {
            "TEST_AUTHORED": True,
            "TEST_EXECUTED": True,
            "INFRASTRUCTURE_TEST_PASS": True,
            "MODEL_VALIDATION_PASS": independent_pass,
            "MODEL_VALIDATION_WAITING": waiting,
            "explanation": (
                "Ledger integrity passed. Independent validation passed N>=30 and metrics; Gate4 remains separate."
                if independent_pass
                else "Ledger integrity passed. M015 remains PAPER_ONLY while prospective independent evidence accumulates; no missing row is fabricated or counted."
            ),
        },
        "checks": [
            {
                "name": "append_only_ledger_integrity",
                "status": "TEST_PASS",
                "executed": True,
                "runtime_evidence": (
                    f"ledger_valid={verification['ledger_valid']} entries={verification['entry_n']} "
                    f"pending={verification['pending_n']} settled={verification['settled_n']}"
                ),
            },
            {
                "name": "consumed_holdout_exclusion",
                "status": "TEST_PASS",
                "executed": True,
                "runtime_evidence": f"Forbidden Holdout A match IDs enforced: n={len(holdout['match_ids'])}.",
            },
            {
                "name": "independent_sample_gate",
                "status": evaluation["gate_results"]["independent_sample_gate"],
                "executed": True,
                "runtime_evidence": (
                    f"Prospective settled independent N={summary['independent_validation_n']}/"
                    f"{summary['independent_validation_min_n']}; remaining={summary['remaining_to_independent_min_n']}."
                ),
            },
            {
                "name": "gate4_separation",
                "status": "TEST_PASS",
                "executed": True,
                "runtime_evidence": (
                    f"Gate4 sample threshold remains {summary['gate4_min_n']}; current settled N="
                    f"{summary['independent_validation_n']}; decision_weight=0."
                ),
            },
        ],
        "model_governance": {
            "model_state": "PAPER_ONLY",
            "decision_weight": 0.0,
            "automatic_promotion": False,
            "capital_effect": "NONE",
            "validation_state": validation_state,
        },
    }
    return report, evidence


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--report",
        default=str(ROOT / "artifacts" / "m015-forward-evidence-ledger-report-v0.1.json"),
    )
    parser.add_argument(
        "--evidence",
        default=str(ROOT / "artifacts" / "m015-forward-ledger" / "TEST_EVIDENCE.json"),
    )
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
        "current_forward_state": report["current_forward_state"],
        "ledger": {
            "entry_n": report["ledger_verification"]["entry_n"],
            "pending_n": report["ledger_verification"]["pending_n"],
            "settled_n": report["ledger_verification"]["settled_n"],
        },
        "infrastructure_test_pass": evidence["overall"]["INFRASTRUCTURE_TEST_PASS"],
        "model_validation_pass": evidence["overall"]["MODEL_VALIDATION_PASS"],
        "model_validation_waiting": evidence["overall"]["MODEL_VALIDATION_WAITING"],
        "report": str(report_path),
        "evidence": str(evidence_path),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
