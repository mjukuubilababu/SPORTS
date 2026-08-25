from __future__ import annotations

import argparse
from hashlib import sha1
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate3"))
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

import m015_regularized_poisson_glm as m015
from m015_forward_validation import evaluate_forward_set, validate_registration

REGISTRATION_PATH = ROOT / "packages" / "gate4" / "data" / "m015-forward-registration-v0.1.json"
HOLDOUT_A_PATH = ROOT / "packages" / "gate4" / "data" / "mls-2026-evaluation-holdout-a-v0.1.json"
FROZEN_RULES_PATH = ROOT / "contracts" / "p002-frozen-rules.json"


def git_blob_sha(path: Path) -> str:
    content = path.read_bytes()
    header = f"blob {len(content)}\0".encode("utf-8")
    return sha1(header + content).hexdigest()


def load_settled_rows(path: str | None):
    if not path:
        return [], "NO_FORWARD_EVALUATION_SET_SUPPLIED"
    source = Path(path)
    payload = json.loads(source.read_text(encoding="utf-8"))
    rows = payload.get("settled_rows")
    if not isinstance(rows, list):
        raise ValueError("M015_FORWARD_SETTLED_ROWS_ARRAY_REQUIRED")
    return rows, str(source)


def build_outputs(evaluation_path: str | None = None):
    registration = json.loads(REGISTRATION_PATH.read_text(encoding="utf-8"))
    validate_registration(registration)
    holdout = json.loads(HOLDOUT_A_PATH.read_text(encoding="utf-8"))
    frozen = json.loads(FROZEN_RULES_PATH.read_text(encoding="utf-8"))

    if frozen.get("lineage") != "P002" or frozen.get("status") != "FROZEN_RESEARCH_RULE":
        raise RuntimeError("M015_FORWARD_P002_FROZEN_RULES_NOT_CONFIRMED")

    requirements = registration["forward_evidence_requirements"]
    if int(requirements["independent_validation_min_n"]) != int(frozen["independent_validation_min_n"]):
        raise RuntimeError("M015_FORWARD_INDEPENDENT_MIN_N_DRIFT")
    if int(requirements["gate4_min_n"]) != 100:
        raise RuntimeError("M015_FORWARD_GATE4_MIN_N_DRIFT")

    model_path = ROOT / registration["source_model_path"]
    actual_blob_sha = git_blob_sha(model_path)
    if actual_blob_sha != registration["source_model_git_blob_sha"]:
        raise RuntimeError("M015_FORWARD_SOURCE_MODEL_BLOB_CHANGED")

    specification = registration["specification"]
    runtime_spec = {
        "model_id": m015.MODEL_ID,
        "model_version": m015.MODEL_VERSION,
        "min_train_n": m015.MIN_TRAIN_N,
        "max_iter": m015.MAX_ITER,
        "prior_mean": list(m015.PRIOR_MEAN),
        "prior_precision": list(m015.PRIOR_PRECISION),
        "min_lambda": m015.MIN_LAMBDA,
        "max_lambda": m015.MAX_LAMBDA,
    }
    expected_runtime_spec = {
        "model_id": specification["model_id"],
        "model_version": specification["model_version"],
        "min_train_n": specification["min_train_n"],
        "max_iter": specification["max_iter"],
        "prior_mean": specification["prior_mean"],
        "prior_precision": specification["prior_precision"],
        "min_lambda": specification["min_lambda"],
        "max_lambda": specification["max_lambda"],
    }
    if runtime_spec != expected_runtime_spec:
        raise RuntimeError("M015_FORWARD_RUNTIME_SPEC_CHANGED")

    rows, evaluation_source = load_settled_rows(evaluation_path)
    result = evaluate_forward_set(
        registration,
        rows,
        forbidden_match_ids=holdout.get("match_ids", []),
    )

    n = int(result["summary"]["independent_validation_n"])
    min_n = int(result["summary"]["independent_validation_min_n"])
    if n == 0:
        empirical_status = "TEST_WAITING"
        empirical_explanation = "No prospective settled rows were supplied; forward validation is preregistered and waiting for genuinely future evidence."
    elif n < min_n:
        empirical_status = "TEST_WAITING"
        empirical_explanation = f"Prospective evidence exists but is below frozen independent minimum N: {n}/{min_n}."
    elif result["gate_results"]["independent_metrics_vs_market"] == "PASS":
        empirical_status = "TEST_PASS"
        empirical_explanation = "Independent N and both benchmark metrics passed; Gate4 remains separate and decision weight stays zero."
    else:
        empirical_status = "TEST_FAIL"
        empirical_explanation = "Independent N was reached but one or both benchmark metrics failed."

    report = {
        "report_version": "M015_FORWARD_VALIDATION_REPORT_V0_1",
        "registration": registration,
        "evaluation_source": evaluation_source,
        "source_model_blob_verified": True,
        "runtime_spec_verified_unchanged": True,
        "frozen_rules_verified": True,
        "forward_validation": result,
    }

    evidence = {
        "artifact": "M015_Prospective_Forward_Validation_v0.1",
        "overall": {
            "TEST_AUTHORED": True,
            "TEST_EXECUTED": True,
            "TEST_PASS": empirical_status == "TEST_PASS",
            "TEST_FAIL": empirical_status == "TEST_FAIL",
            "TEST_WAITING": empirical_status == "TEST_WAITING",
            "explanation": empirical_explanation,
        },
        "checks": [
            {
                "name": "registration_and_source_model_freeze",
                "status": "TEST_PASS",
                "executed": True,
                "runtime_evidence": (
                    f"Registration fingerprint valid; frozen source model Git blob {actual_blob_sha} matches manifest; runtime M015 constants unchanged."
                ),
                "scope": "No-retune / model identity integrity",
            },
            {
                "name": "frozen_p002_integrity",
                "status": "TEST_PASS",
                "executed": True,
                "runtime_evidence": (
                    f"P002 status={frozen['status']}; independent_validation_min_n={frozen['independent_validation_min_n']}; no frozen rule changed."
                ),
                "scope": "Frozen governance",
            },
            {
                "name": "prospective_independent_validation",
                "status": empirical_status,
                "executed": True,
                "runtime_evidence": (
                    f"Independent N={n}/{min_n}; validation_state={result['validation_state']}; "
                    f"consumed development rows are forbidden from independent counting."
                ),
                "scope": "Future unseen evidence only",
            },
        ],
        "model_governance": {
            "model_id": "M015",
            "model_version": registration["model_version"],
            "model_state": result["model_state"],
            "decision_weight": result["decision_weight"],
            "market_champion_replaced": result["market_champion_replaced"],
            "automatic_promotion": result["automatic_promotion"],
            "retuning_allowed": False,
            "capital_effect": "NONE",
            "real_money": "NO",
        },
        "migration_evidence": {
            "MIGRATION_AUTHORED": False,
            "MIGRATION_APPLIED": False,
            "MIGRATION_VERIFIED": False,
            "reason": "Forward-validation governance only; no database migration.",
        },
    }
    return report, evidence


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evaluation-set", default=None)
    parser.add_argument("--report", default=str(ROOT / "artifacts" / "m015-forward-validation-report-v0.1.json"))
    parser.add_argument("--evidence", default=str(ROOT / "artifacts" / "m015-forward" / "TEST_EVIDENCE.json"))
    args = parser.parse_args()

    report, evidence = build_outputs(args.evaluation_set)
    report_path = Path(args.report)
    evidence_path = Path(args.evidence)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    evidence_path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")

    print(json.dumps({
        "registration_state": report["registration"]["state"],
        "source_model_blob_verified": report["source_model_blob_verified"],
        "runtime_spec_verified_unchanged": report["runtime_spec_verified_unchanged"],
        "summary": report["forward_validation"]["summary"],
        "gate_results": report["forward_validation"]["gate_results"],
        "validation_state": report["forward_validation"]["validation_state"],
        "model_state": report["forward_validation"]["model_state"],
        "decision_weight": report["forward_validation"]["decision_weight"],
        "test_waiting": evidence["overall"]["TEST_WAITING"],
        "report": str(report_path),
        "evidence": str(evidence_path),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
