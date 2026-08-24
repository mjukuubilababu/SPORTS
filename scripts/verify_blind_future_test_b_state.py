from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from blind_test_set import blind_public_status, build_accumulator

STATE = ROOT / "packages" / "gate4" / "data" / "mls-2026-future-test-b-state-v0.1.json"
PREREG = ROOT / "packages" / "gate4" / "data" / "negbin-challenger-preregistration-v0.1.json"
HOLDOUT = ROOT / "packages" / "gate4" / "data" / "mls-2026-evaluation-holdout-a-v0.1.json"
CANDIDATE_GLOB = "mls-2026-test-b-candidate-*.json"

FORBIDDEN_INTERIM_KEYS = {
    "brier", "logloss", "hit_rate", "roi", "profit", "edge", "ev",
    "calibration_error", "champion", "leader", "win_rate", "model_rank",
}


def _candidate_rows() -> list[dict]:
    rows: list[dict] = []
    for path in sorted((ROOT / "packages" / "gate4" / "data").glob(CANDIDATE_GLOB)):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or not isinstance(payload.get("records"), list):
            raise AssertionError(f"INVALID_TEST_B_CANDIDATE_FILE:{path}")
        rows.extend(payload["records"])
    return rows


def main() -> int:
    state = json.loads(STATE.read_text(encoding="utf-8"))
    prereg = json.loads(PREREG.read_text(encoding="utf-8"))
    holdout = json.loads(HOLDOUT.read_text(encoding="utf-8"))

    assert state["accumulator_version"] == "BLIND_FUTURE_TEST_SET_B_ACCUMULATOR_V0_1"

    challenger = state["challenger"]
    specification = prereg["challenger_specification"]
    assert challenger["model_version"] == specification["model_version"]
    assert challenger["specification_sha256"] == prereg["specification_sha256"]
    assert challenger["registered_at"] == prereg["registered_at"]

    accumulator = build_accumulator(
        _candidate_rows(),
        registered_at=challenger["registered_at"],
        challenger_model_version=challenger["model_version"],
        challenger_specification_sha256=challenger["specification_sha256"],
        forbidden_match_ids=holdout["match_ids"],
        target_n=state["test_set"]["target_n"],
    )
    public = blind_public_status(accumulator)
    test_set = state["test_set"]

    assert state["state"] == public["state"]
    assert test_set["target_n"] == 100 == public["target_n"]
    assert test_set["promotion_eligible_n"] == public["promotion_eligible_n"]
    assert test_set["remaining_to_target"] == public["remaining_to_target"]
    assert test_set["received_n"] == public["received_n"]
    assert test_set["rejected_n"] == public["rejected_n"]
    assert test_set["interim_metrics_exposed"] is False
    assert test_set["evaluation_performed"] is False
    assert test_set["performance_claim"] == "NONE_BLIND_ACCUMULATION"
    assert not (set(test_set) & FORBIDDEN_INTERIM_KEYS)

    assert state["holdout_a"]["freeze_id"] == holdout["freeze_id"]
    assert state["holdout_a"]["reuse_forbidden"] is True
    assert state["holdout_a"]["match_level_overlap_forbidden"] is True

    assert state["freeze_policy"]["first_100_chronological_promotion_eligible_matches"] == "TEST_B"
    assert state["freeze_policy"]["rows_after_first_100"] == "NEXT_COHORT"
    assert state["freeze_policy"]["freeze_only_after_all_100_are_settled"] is True
    assert state["freeze_policy"]["evaluation_release"] == "SEPARATE_FUTURE_STEP_AFTER_FREEZE"

    governance = state["governance"]
    assert governance["no_interim_brier_logloss_roi_ev_edge_or_ranking"] is True
    assert governance["existing_gate4_thresholds_changed"] is False
    assert governance["p002_frozen_rules_changed"] is False
    assert governance["capital_effect"] == "NONE"
    assert governance["real_money"] == "NO"

    print(json.dumps({
        "status": "BLIND_FUTURE_TEST_B_STATE=PASS",
        "candidate_files": len(list((ROOT / "packages" / "gate4" / "data").glob(CANDIDATE_GLOB))),
        "received_n": public["received_n"],
        "promotion_eligible_n": public["promotion_eligible_n"],
        "remaining_to_target": public["remaining_to_target"],
        "rejected_n": public["rejected_n"],
        "interim_metrics_exposed": public["interim_metrics_exposed"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
