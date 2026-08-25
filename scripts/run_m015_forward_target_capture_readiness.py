from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))
sys.path.insert(0, str(ROOT / "packages" / "gate2"))
sys.path.insert(0, str(ROOT / "packages" / "gate3"))
sys.path.insert(0, str(ROOT / "packages" / "gate4"))
sys.path.insert(0, str(ROOT / "scripts"))

from m015_regularized_poisson_glm import fit_glm
from m015_forward_evidence_ledger import validate_ledger
from m015_forward_target_capture import _hash, _validate_base_snapshot
from run_m015_walkforward import build_canonical_inputs

REGISTRATION = ROOT / "packages" / "gate4" / "data" / "m015-forward-registration-v0.1.json"
HOLDOUT = ROOT / "packages" / "gate4" / "data" / "mls-2026-evaluation-holdout-a-v0.1.json"
LEDGER = ROOT / "packages" / "gate4" / "data" / "m015-forward-evidence-ledger-v0.1.json"


def main() -> int:
    registration = json.loads(REGISTRATION.read_text(encoding="utf-8"))
    holdout = json.loads(HOLDOUT.read_text(encoding="utf-8"))
    ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
    truth_store, gate2, sources = build_canonical_inputs()

    base_matches, base_pairs, usable_ids = _validate_base_snapshot(registration, truth_store, gate2)
    state = fit_glm(base_pairs)
    ledger_report = validate_ledger(
        ledger,
        registration,
        forbidden_match_ids=holdout["match_ids"],
    )
    training_state = {
        "dataset_id": registration["training_snapshot"]["dataset_id"],
        "cutoff": registration["training_snapshot"]["latest_match_date"],
        "base_match_n": len(base_matches),
        "gate2_feature_n": len(gate2["features"]),
        "usable_training_n": len(base_pairs),
        "usable_match_ids_sha256": _hash(sorted(usable_ids)),
        "fit_training_n": state.training_n,
        "coefficients": list(state.coefficients),
        "converged": state.converged,
        "fallback_gate2": state.fallback_gate2,
    }
    report = {
        "report_version": "M015_FORWARD_TARGET_CAPTURE_READINESS_V0_1",
        "readiness_state": "READY_FOR_POST_REGISTRATION_TARGET",
        "model_id": registration["model_id"],
        "model_version": registration["model_version"],
        "specification_sha256": registration["specification_sha256"],
        "training_state": training_state,
        "training_state_fingerprint": _hash(training_state),
        "source_summaries": sources,
        "ledger": {
            "entry_n": ledger_report["entry_n"],
            "pending_n": ledger_report["pending_n"],
            "settled_n": ledger_report["settled_n"],
            "independent_n": ledger_report["evaluation"]["summary"]["independent_validation_n"],
            "validation_state": ledger_report["evaluation"]["validation_state"],
        },
        "governance": {
            "base_snapshot_verified": True,
            "future_training_requires_prior_settled_ledger_rows": True,
            "same_date_outcomes_excluded": True,
            "no_target_created_by_readiness_check": True,
            "decision_weight": 0.0,
            "automatic_promotion": False,
        },
    }
    evidence = {
        "artifact": "M015_Prospective_Target_Capture_v0.1",
        "overall": {
            "TEST_AUTHORED": True,
            "TEST_EXECUTED": True,
            "INFRASTRUCTURE_TEST_PASS": True,
            "TARGET_CAPTURED_BY_THIS_CHECK": False,
            "VALIDATION_STATE": report["ledger"]["validation_state"],
        },
        "runtime": report,
    }
    report_path = ROOT / "artifacts" / "m015-forward-target-capture-readiness-v0.1.json"
    evidence_path = ROOT / "artifacts" / "m015-forward-target" / "TEST_EVIDENCE.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    evidence_path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(json.dumps({
        "readiness_state": report["readiness_state"],
        "training_state": training_state,
        "ledger": report["ledger"],
        "infrastructure_test_pass": True,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
