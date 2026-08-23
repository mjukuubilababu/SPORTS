from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "packages" / "gate4" / "data" / "mls-2026-future-test-b-state-v0.1.json"
PREREG = ROOT / "packages" / "gate4" / "data" / "negbin-challenger-preregistration-v0.1.json"
HOLDOUT = ROOT / "packages" / "gate4" / "data" / "mls-2026-evaluation-holdout-a-v0.1.json"

FORBIDDEN_INTERIM_KEYS = {
    "brier", "logloss", "hit_rate", "roi", "profit", "edge", "ev",
    "calibration_error", "champion", "leader", "win_rate", "model_rank",
}


def main() -> int:
    state = json.loads(STATE.read_text(encoding="utf-8"))
    prereg = json.loads(PREREG.read_text(encoding="utf-8"))
    holdout = json.loads(HOLDOUT.read_text(encoding="utf-8"))

    assert state["state"] == "BLIND_ACCUMULATING"
    assert state["accumulator_version"] == "BLIND_FUTURE_TEST_SET_B_ACCUMULATOR_V0_1"

    challenger = state["challenger"]
    specification = prereg["challenger_specification"]
    assert challenger["model_version"] == specification["model_version"]
    assert challenger["specification_sha256"] == prereg["specification_sha256"]
    assert challenger["registered_at"] == prereg["registered_at"]

    test_set = state["test_set"]
    assert test_set["target_n"] == 100
    assert test_set["promotion_eligible_n"] == 0
    assert test_set["remaining_to_target"] == 100
    assert test_set["received_n"] == 0
    assert test_set["rejected_n"] == 0
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

    print("BLIND_FUTURE_TEST_B_STATE=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
