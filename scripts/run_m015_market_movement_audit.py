from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from m015_market_movement_audit import validate_market_path

CANDIDATE = ROOT / "packages" / "gate4" / "data" / "m015-first-real-forward-target-candidate-v0.1.json"
SNAPSHOT = ROOT / "packages" / "gate4" / "data" / "m015-first-real-forward-target-market-snapshot-v0.1.json"
LEDGER = ROOT / "packages" / "gate4" / "data" / "m015-forward-evidence-ledger-v0.1.json"
PATH = ROOT / "packages" / "gate4" / "data" / "m015-seattle-chicago-market-movement-v0.1.json"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    candidate, snapshot, ledger, path = load(CANDIDATE), load(SNAPSHOT), load(LEDGER), load(PATH)
    report = validate_market_path(path=path, candidate=candidate, frozen_snapshot=snapshot, forward_ledger=ledger)
    entries = [e for e in ledger.get("entries", []) if e.get("match_id") == candidate.get("match_id")]
    if len(entries) != 1:
        raise RuntimeError("M015_MOVEMENT_EXPECTED_ONE_LIFECYCLE_ROW")
    lifecycle_state = entries[0].get("state")
    if lifecycle_state == "SIGNAL_FROZEN":
        if ledger.get("summary", {}).get("frozen_pending_settlement") != 1 or ledger.get("summary", {}).get("settled_independent_n") != 0:
            raise RuntimeError("M015_MOVEMENT_FROZEN_LEDGER_SUMMARY_INVALID")
        settlement_pending = True
    elif lifecycle_state == "SETTLED":
        if ledger.get("summary", {}).get("frozen_pending_settlement") != 0 or ledger.get("summary", {}).get("settled_independent_n") != 1:
            raise RuntimeError("M015_MOVEMENT_SETTLED_LEDGER_SUMMARY_INVALID")
        if entries[0].get("result_verified") is not True:
            raise RuntimeError("M015_MOVEMENT_SETTLED_RESULT_NOT_VERIFIED")
        settlement_pending = False
    else:
        raise RuntimeError("M015_MOVEMENT_LEDGER_LIFECYCLE_STATE_INVALID")

    output = {
        "report_version": "M015_MARKET_MOVEMENT_AUDIT_REPORT_V0_1",
        "classification": "POST_FREEZE_PREKICKOFF_RESEARCH_CONTEXT_ONLY",
        "audit": report,
        "latest_observation": path["observations"][-1] if path.get("observations") else None,
        "current_forward_lifecycle_state": lifecycle_state,
        "governance": {
            "pr65_evaluation_benchmark_remains_authoritative": True,
            "movement_observation_does_not_replace_benchmark": True,
            "movement_observation_does_not_modify_forward_ledger": True,
            "movement_observation_does_not_increment_independent_n": True,
            "movement_observation_does_not_rewrite_model_probability": True,
            "settlement_pending": settlement_pending,
            "decision_weight": 0.0,
            "automatic_promotion": False,
        },
    }
    evidence = {
        "artifact": "M015_Market_Movement_Audit_v0.1",
        "overall": {
            "TEST_EXECUTED": True,
            "AUDIT_VALID": report["audit_valid"],
            "OBSERVATION_N": report["observation_n"],
            "EVALUATION_BENCHMARK_LOCKED": report["evaluation_benchmark_locked"],
            "FORWARD_LEDGER_MODIFIED_BY_MOVEMENT": report["forward_ledger_modified"],
            "INDEPENDENT_N_INCREMENTED_BY_MOVEMENT": report["independent_n_incremented"],
            "CURRENT_FORWARD_LIFECYCLE_STATE": lifecycle_state,
        },
        "runtime": output,
    }

    report_path = ROOT / "artifacts" / "m015-market-movement-audit-v0.1.json"
    evidence_path = ROOT / "artifacts" / "m015-market-movement" / "TEST_EVIDENCE.json"
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(output, indent=2), encoding="utf-8")
    evidence_path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(json.dumps({
        "classification": output["classification"],
        "audit": report,
        "ledger_pending": ledger["summary"]["frozen_pending_settlement"],
        "independent_n": ledger["summary"]["settled_independent_n"],
        "lifecycle_state": lifecycle_state,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
