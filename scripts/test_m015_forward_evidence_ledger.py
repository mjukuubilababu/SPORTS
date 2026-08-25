from __future__ import annotations

import json
import sys
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate3"))
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from m015_forward_evidence_ledger import (
    append_frozen_prediction,
    append_settlement,
    empty_ledger,
    validate_ledger,
)
from m015_forward_validation import freeze_prediction, settle_prediction

REGISTRATION = ROOT / "packages" / "gate4" / "data" / "m015-forward-registration-v0.1.json"
HOLDOUT = ROOT / "packages" / "gate4" / "data" / "mls-2026-evaluation-holdout-a-v0.1.json"


def expect_error(fn, fragment: str) -> None:
    try:
        fn()
    except ValueError as exc:
        assert fragment in str(exc), (fragment, str(exc))
    else:
        raise AssertionError(f"Expected ValueError containing {fragment}")


def prediction(registration: dict, match_id: str = "MLS-2026-FORWARD-LEDGER-001") -> dict:
    return freeze_prediction(
        registration,
        {
            "match_id": match_id,
            "league": "MLS",
            "model_id": "M015",
            "model_version": registration["model_version"],
            "specification_sha256": registration["specification_sha256"],
            "feature_snapshot_id": f"FEATURE-{match_id}",
            "training_state_fingerprint": "training-state-sha256-test",
            "kickoff_at": "2026-09-01T23:30:00Z",
            "prediction_frozen_at": "2026-09-01T21:00:00Z",
            "market_observed_at": "2026-09-01T21:05:00Z",
            "model_probability": 0.61,
            "market_probability": 0.58,
        },
    )


def main() -> int:
    registration = json.loads(REGISTRATION.read_text(encoding="utf-8"))
    holdout = json.loads(HOLDOUT.read_text(encoding="utf-8"))
    forbidden = holdout["match_ids"]

    ledger = empty_ledger(registration)
    empty_report = validate_ledger(ledger, registration, forbidden_match_ids=forbidden)
    assert empty_report["entry_n"] == 0
    assert empty_report["pending_n"] == 0
    assert empty_report["settled_n"] == 0
    assert empty_report["evaluation"]["summary"]["independent_validation_n"] == 0
    assert empty_report["evaluation"]["validation_state"] == "WAITING_FOR_INDEPENDENT_MIN_N"

    frozen = prediction(registration)
    ledger1 = append_frozen_prediction(
        ledger, registration, frozen, forbidden_match_ids=forbidden
    )
    report1 = validate_ledger(ledger1, registration, forbidden_match_ids=forbidden)
    assert report1["entry_n"] == 1
    assert report1["pending_n"] == 1
    assert report1["settled_n"] == 0
    assert report1["evaluation"]["summary"]["independent_validation_n"] == 0

    expect_error(
        lambda: append_frozen_prediction(
            ledger1, registration, frozen, forbidden_match_ids=forbidden
        ),
        "PREDICTION_OVERWRITE_FORBIDDEN",
    )

    orphan = settle_prediction(
        prediction(registration, "MLS-2026-FORWARD-LEDGER-ORPHAN"),
        {
            "match_id": "MLS-2026-FORWARD-LEDGER-ORPHAN",
            "result_verified": True,
            "final_score": {"home": 1, "away": 1},
            "settled_at": "2026-09-02T02:00:00Z",
        },
    )
    expect_error(
        lambda: append_settlement(ledger1, registration, orphan),
        "SETTLEMENT_WITHOUT_FROZEN_PREDICTION",
    )

    settled = settle_prediction(
        frozen,
        {
            "match_id": frozen["match_id"],
            "result_verified": True,
            "final_score": {"home": 2, "away": 1},
            "settled_at": "2026-09-02T02:00:00Z",
        },
    )
    ledger2 = append_settlement(ledger1, registration, settled)
    report2 = validate_ledger(ledger2, registration, forbidden_match_ids=forbidden)
    assert report2["pending_n"] == 0
    assert report2["settled_n"] == 1
    assert report2["evaluation"]["summary"]["independent_validation_n"] == 1
    assert report2["evaluation"]["summary"]["remaining_to_independent_min_n"] == 29
    assert report2["evaluation"]["gate_results"]["independent_sample_gate"] == "WAITING"

    expect_error(
        lambda: append_settlement(ledger2, registration, settled),
        "SETTLEMENT_OVERWRITE_FORBIDDEN",
    )

    tampered = deepcopy(ledger2)
    tampered["entries"][0]["model_probability"] = 0.99
    expect_error(
        lambda: validate_ledger(tampered, registration, forbidden_match_ids=forbidden),
        "ENTRY_TAMPERED",
    )

    bad_summary = deepcopy(ledger2)
    bad_summary["summary"]["settled_independent_n"] = 2
    expect_error(
        lambda: validate_ledger(bad_summary, registration, forbidden_match_ids=forbidden),
        "SUMMARY_MISMATCH",
    )

    forbidden_frozen = prediction(registration, forbidden[0])
    expect_error(
        lambda: append_frozen_prediction(
            ledger, registration, forbidden_frozen, forbidden_match_ids=forbidden
        ),
        "CONSUMED_HOLDOUT_OVERLAP",
    )

    print("M015_FORWARD_EVIDENCE_LEDGER_TEST=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
