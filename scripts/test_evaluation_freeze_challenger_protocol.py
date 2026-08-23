from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from evaluation_freeze import (
    evaluation_permission,
    freeze_reference,
    register_challenger,
    verify_registration_unchanged,
)

REFERENCE = ROOT / "packages" / "gate3" / "data" / "real-2026-historical-research-reference-v0.1.json"
FREEZE_FILE = ROOT / "packages" / "gate4" / "data" / "mls-2026-evaluation-holdout-a-v0.1.json"
REFERENCE_BLOB_SHA = "5434c308af3bc40f78c0fcb8ad328a4ae897f832"


def expect_error(fn, fragment: str) -> None:
    try:
        fn()
    except ValueError as exc:
        assert fragment in str(exc), (fragment, str(exc))
    else:
        raise AssertionError(f"Expected ValueError containing {fragment}")


def main() -> int:
    reference = json.loads(REFERENCE.read_text(encoding="utf-8"))
    frozen_file = json.loads(FREEZE_FILE.read_text(encoding="utf-8"))
    match_ids = frozen_file["match_ids"]

    freeze = freeze_reference(
        reference,
        freeze_id=frozen_file["freeze_id"],
        source_reference_git_blob_sha=REFERENCE_BLOB_SHA,
        match_ids=match_ids,
        frozen_at=frozen_file["frozen_at"],
    )
    assert freeze.research_n == 25
    assert len(freeze.match_ids) == 25
    assert freeze.fingerprint_sha256 == frozen_file["fingerprint_sha256"]
    assert freeze.tuning_reuse_allowed is False
    assert freeze.promotion_reuse_allowed is False

    bad_reference = json.loads(json.dumps(reference))
    bad_reference["workflow"]["conclusion"] = "failure"
    expect_error(
        lambda: freeze_reference(
            bad_reference,
            freeze_id="BAD",
            source_reference_git_blob_sha=REFERENCE_BLOB_SHA,
            match_ids=match_ids,
            frozen_at="2026-08-23T13:23:00Z",
        ),
        "REFERENCE_WORKFLOW_NOT_SUCCESS",
    )

    expect_error(
        lambda: freeze_reference(
            reference,
            freeze_id="COUNT-MISMATCH",
            source_reference_git_blob_sha=REFERENCE_BLOB_SHA,
            match_ids=match_ids[:-1],
            frozen_at="2026-08-23T13:23:00Z",
        ),
        "HOLDOUT_MATCH_ID_COUNT_MISMATCH",
    )

    spec = {
        "challenger_id": "P002-POISSON-CHALLENGER-B-V0.1",
        "model_version": "P002_POISSON_CHALLENGER_B_V0_1",
        "objective": "Improve out-of-sample U3.5 calibration without using Holdout A",
        "hyperparameters": {"example_locked_parameter": 1.0},
    }

    expect_error(
        lambda: register_challenger(
            spec,
            registered_at="2026-08-23T13:30:00Z",
            training_data_ids=[freeze.dataset_id],
            training_match_ids=[],
            training_cutoff="2026-02-20T23:59:59Z",
            frozen_evaluations=[freeze],
        ),
        "FROZEN_EVALUATION_REUSED_FOR_TUNING",
    )

    expect_error(
        lambda: register_challenger(
            spec,
            registered_at="2026-08-23T13:30:00Z",
            training_data_ids=["MLS-2025-TRAINING-CORPUS-V0.1"],
            training_match_ids=[match_ids[0]],
            training_cutoff="2026-02-20T23:59:59Z",
            frozen_evaluations=[freeze],
        ),
        "FROZEN_MATCH_REUSED_FOR_TUNING",
    )

    registration = register_challenger(
        spec,
        registered_at="2026-08-23T13:30:00Z",
        training_data_ids=["MLS-2025-TRAINING-CORPUS-V0.1"],
        training_match_ids=["MLS-2025-TRAIN-001", "MLS-2025-TRAIN-002"],
        training_cutoff="2026-02-20T23:59:59Z",
        frozen_evaluations=[freeze],
    )
    assert verify_registration_unchanged(registration, spec) is True
    changed_spec = json.loads(json.dumps(spec))
    changed_spec["hyperparameters"]["example_locked_parameter"] = 1.1
    assert verify_registration_unchanged(registration, changed_spec) is False

    reused_set = evaluation_permission(
        registration,
        {
            "evaluation_set_id": freeze.freeze_id,
            "dataset_id": freeze.dataset_id,
            "captured_after": "2026-08-24T00:00:00Z",
            "match_ids": list(freeze.match_ids),
        },
        frozen_evaluations=[freeze],
    )
    assert reused_set["allowed"] is False
    assert "FROZEN_EVALUATION_SET_REUSE_FORBIDDEN" in reused_set["reasons"]
    assert "MATCH_LEVEL_HOLDOUT_OVERLAP" in reused_set["reasons"]

    overlap = evaluation_permission(
        registration,
        {
            "evaluation_set_id": "MLS-2026-TEST-B-BAD-OVERLAP",
            "dataset_id": "MLS-2026-FUTURE-B-BAD-OVERLAP",
            "captured_after": "2026-08-24T00:00:00Z",
            "match_ids": [freeze.match_ids[-1], "MLS-2026-FUTURE-001"],
        },
        frozen_evaluations=[freeze],
    )
    assert overlap["allowed"] is False
    assert "MATCH_LEVEL_HOLDOUT_OVERLAP" in overlap["reasons"]

    pre_registration = evaluation_permission(
        registration,
        {
            "evaluation_set_id": "MLS-2026-TEST-B-TOO-EARLY",
            "dataset_id": "MLS-2026-FUTURE-B-TOO-EARLY",
            "captured_after": "2026-08-23T13:29:59Z",
            "match_ids": ["MLS-2026-FUTURE-002"],
        },
        frozen_evaluations=[freeze],
    )
    assert pre_registration["allowed"] is False
    assert "EVALUATION_DATA_NOT_FUTURE_TO_PREREGISTRATION" in pre_registration["reasons"]

    missing_ids = evaluation_permission(
        registration,
        {
            "evaluation_set_id": "MLS-2026-TEST-B-NO-IDS",
            "dataset_id": "MLS-2026-FUTURE-B-NO-IDS",
            "captured_after": "2026-08-24T00:00:00Z",
            "match_ids": [],
        },
        frozen_evaluations=[freeze],
    )
    assert missing_ids["allowed"] is False
    assert "EVALUATION_MATCH_IDS_REQUIRED" in missing_ids["reasons"]

    future_b = evaluation_permission(
        registration,
        {
            "evaluation_set_id": "MLS-2026-FUTURE-TEST-B-V0.1",
            "dataset_id": "MLS-2026-FUTURE-CLOSING-ODDS-B-V0.1",
            "captured_after": "2026-08-24T00:00:00Z",
            "match_ids": ["MLS-2026-FUTURE-101", "MLS-2026-FUTURE-102"],
        },
        frozen_evaluations=[freeze],
    )
    assert future_b["allowed"] is True
    assert future_b["promotion_allowed_if_metrics_pass"] is True
    assert future_b["reasons"] == []

    print("EVALUATION_FREEZE_CHALLENGER_PROTOCOL=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
