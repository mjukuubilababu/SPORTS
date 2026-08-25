from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate3"))
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from m015_forward_validation import (
    evaluate_forward_set,
    freeze_prediction,
    settle_prediction,
    validate_registration,
    verify_frozen_prediction,
)

REGISTRATION = ROOT / "packages" / "gate4" / "data" / "m015-forward-registration-v0.1.json"


def load_registration():
    return json.loads(REGISTRATION.read_text(encoding="utf-8"))


def expect_error(fn, fragment: str) -> None:
    try:
        fn()
    except ValueError as exc:
        assert fragment in str(exc), (fragment, str(exc))
    else:
        raise AssertionError(f"Expected ValueError containing {fragment}")


def prediction(registration, match_id: str, *, outcome_leak=False, market_probability=0.60):
    row = {
        "match_id": match_id,
        "league": "MLS",
        "model_id": registration["model_id"],
        "model_version": registration["model_version"],
        "specification_sha256": registration["specification_sha256"],
        "feature_snapshot_id": f"feature-{match_id}",
        "training_state_fingerprint": f"training-{match_id}",
        "kickoff_at": "2026-08-26T20:00:00Z",
        "prediction_frozen_at": "2026-08-26T18:00:00Z",
        "market_observed_at": "2026-08-26T18:30:00Z",
        "model_probability": 0.75,
        "market_probability": market_probability,
    }
    if outcome_leak:
        row["outcome_u35"] = 1
    return row


def settled_row(registration, i: int):
    outcome = 1 if i % 3 else 0
    model_probability = 0.90 if outcome == 1 else 0.10
    market_probability = 0.62 if outcome == 1 else 0.38
    p = prediction(registration, f"MLS-FUTURE-{i:03d}", market_probability=market_probability)
    p["model_probability"] = model_probability
    frozen = freeze_prediction(registration, p)
    score = {"home": 1, "away": 1} if outcome == 1 else {"home": 3, "away": 2}
    return settle_prediction(frozen, {
        "match_id": p["match_id"],
        "settled_at": "2026-08-26T23:00:00Z",
        "result_verified": True,
        "final_score": score,
    })


def test_registration_fingerprint_is_locked():
    registration = load_registration()
    assert validate_registration(registration) is registration
    changed = json.loads(json.dumps(registration))
    changed["specification"]["prior_mean"][1] = 0.51
    expect_error(lambda: validate_registration(changed), "SPECIFICATION_FINGERPRINT_MISMATCH")


def test_prediction_freeze_blocks_hindsight_and_old_matches():
    registration = load_registration()
    expect_error(
        lambda: freeze_prediction(registration, prediction(registration, "future-leak", outcome_leak=True)),
        "OUTCOME_LEAKAGE_IN_PREDICTION",
    )
    old = prediction(registration, "future-old")
    old["kickoff_at"] = "2026-08-24T20:00:00Z"
    old["prediction_frozen_at"] = "2026-08-24T18:00:00Z"
    old["market_observed_at"] = "2026-08-24T18:30:00Z"
    expect_error(lambda: freeze_prediction(registration, old), "KICKOFF_NOT_FUTURE_TO_REGISTRATION")
    expect_error(
        lambda: freeze_prediction(
            registration,
            prediction(registration, "FROZEN-OLD-ID"),
            forbidden_match_ids=["FROZEN-OLD-ID"],
        ),
        "FROZEN_MATCH_REUSE_FORBIDDEN",
    )


def test_freeze_fingerprint_detects_tampering():
    registration = load_registration()
    frozen = freeze_prediction(registration, prediction(registration, "future-tamper"))
    assert verify_frozen_prediction(frozen) is True
    frozen["model_probability"] = 0.55
    assert verify_frozen_prediction(frozen) is False
    expect_error(
        lambda: settle_prediction(frozen, {
            "match_id": "future-tamper",
            "settled_at": "2026-08-26T23:00:00Z",
            "result_verified": True,
            "final_score": {"home": 1, "away": 1},
        }),
        "FROZEN_PREDICTION_TAMPERED",
    )


def test_settlement_must_be_post_kickoff():
    registration = load_registration()
    p = prediction(registration, "future-settle")
    frozen = freeze_prediction(registration, p)
    expect_error(
        lambda: settle_prediction(frozen, {
            "match_id": p["match_id"],
            "settled_at": "2026-08-26T19:00:00Z",
            "result_verified": True,
            "final_score": {"home": 1, "away": 1},
        }),
        "SETTLEMENT_NOT_POST_KICKOFF",
    )


def test_29_rows_wait_and_30_rows_can_pass_only_independent_gate():
    registration = load_registration()
    rows = [settled_row(registration, i) for i in range(30)]
    waiting = evaluate_forward_set(registration, rows[:29])
    assert waiting["summary"]["independent_validation_n"] == 29
    assert waiting["gate_results"]["independent_sample_gate"] == "WAITING"
    assert waiting["validation_state"] == "WAITING_FOR_INDEPENDENT_MIN_N"
    assert waiting["decision_weight"] == 0.0

    passed = evaluate_forward_set(registration, rows)
    assert passed["summary"]["independent_validation_n"] == 30
    assert passed["gate_results"]["independent_sample_gate"] == "PASS"
    assert passed["gate_results"]["independent_metrics_vs_market"] == "PASS"
    assert passed["validation_state"] == "INDEPENDENT_VALIDATION_PASS_GATE4_PENDING"
    assert passed["gate_results"]["gate4_sample_size_reached"] is False
    assert passed["model_state"] == "PAPER_ONLY"
    assert passed["decision_weight"] == 0.0
    assert passed["automatic_promotion"] is False


def main():
    test_registration_fingerprint_is_locked()
    test_prediction_freeze_blocks_hindsight_and_old_matches()
    test_freeze_fingerprint_detects_tampering()
    test_settlement_must_be_post_kickoff()
    test_29_rows_wait_and_30_rows_can_pass_only_independent_gate()
    print("M015_FORWARD_VALIDATION_PROTOCOL=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
