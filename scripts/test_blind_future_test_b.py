from __future__ import annotations

import sys
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from blind_test_set import (
    FORBIDDEN_INTERIM_METRICS,
    blind_public_status,
    build_accumulator,
    freeze_test_set_b,
)

REGISTERED_AT = "2026-08-23T13:40:00Z"
MODEL_VERSION = "P002_NEGBIN_CHALLENGER_V0_1"
SPEC_HASH = "650d6cdd6eccc31ec0756cd1bfe80b51032e079ba90c00ad950b86db85508c00"
HOLDOUT_ID = "MLS-2026-2026-02-21-312aed77f2bd"


def z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def candidate(index: int, *, match_id: str | None = None) -> dict:
    kickoff = datetime(2026, 8, 24, 12, 0, tzinfo=timezone.utc) + timedelta(hours=index * 3)
    return {
        "match_id": match_id or f"MLS-2026-FUTURE-{index:03d}",
        "competition": "MLS",
        "kickoff_at": z(kickoff),
        "prediction": {
            "snapshot_id": f"PRED-{index:03d}",
            "snapshot_sha256": f"{index + 1:064x}"[-64:],
            "frozen_at": z(kickoff - timedelta(hours=2)),
            "poisson_model_version": "P002_POISSON_BASELINE_V0_1",
            "poisson_probability_u35": 0.61,
            "negbin_model_version": MODEL_VERSION,
            "negbin_specification_sha256": SPEC_HASH,
            "negbin_probability_u35": 0.63,
            "uses_market_odds": False,
        },
        "market": {
            "snapshot_id": f"MKT-{index:03d}",
            "snapshot_sha256": f"{index + 1000:064x}"[-64:],
            "provider": "TEST_BOOK",
            "source": "TEST_VERIFIED_CLOSING_SOURCE",
            "source_url": f"https://example.test/market/{index}",
            "observed_at": z(kickoff - timedelta(minutes=5)),
            "fair_probability_u35": 0.60,
            "source_verified": True,
            "closing_semantics_verified": True,
        },
        "regime": {
            "snapshot_id": f"REG-{index:03d}",
            "snapshot_sha256": f"{index + 2000:064x}"[-64:],
            "label": "EARLY_SEASON_STABLE_CONTEXT",
            "source": "TEST_REGIME_CLASSIFIER",
            "source_url": f"https://example.test/regime/{index}",
            "observed_at": z(kickoff - timedelta(hours=3)),
            "verified": True,
            "uses_outcome": False,
            "uses_market_odds": False,
        },
        "settlement": {
            "source": "TEST_VERIFIED_RESULT_SOURCE",
            "source_url": f"https://example.test/result/{index}",
            "verified": True,
            "settled_at": z(kickoff + timedelta(hours=2)),
            "home_goals": index % 4,
            "away_goals": (index + 1) % 3,
        },
    }


def accumulator(rows: list[dict], *, target_n: int = 100) -> dict:
    return build_accumulator(
        rows,
        registered_at=REGISTERED_AT,
        challenger_model_version=MODEL_VERSION,
        challenger_specification_sha256=SPEC_HASH,
        forbidden_match_ids=[HOLDOUT_ID],
        target_n=target_n,
    )


def expect_error(fn, fragment: str) -> None:
    try:
        fn()
    except ValueError as exc:
        assert fragment in str(exc), (fragment, str(exc))
    else:
        raise AssertionError(f"Expected ValueError containing {fragment}")


def main() -> int:
    one = accumulator([candidate(1)])
    public = blind_public_status(one)
    assert public["state"] == "BLIND_ACCUMULATING"
    assert public["promotion_eligible_n"] == 1
    assert public["remaining_to_target"] == 99
    assert public["interim_metrics_exposed"] is False
    assert public["evaluation_performed"] is False
    assert public["performance_claim"] == "NONE_BLIND_ACCUMULATION"
    assert not (set(public) & FORBIDDEN_INTERIM_METRICS)
    assert "_accepted_records" not in public
    expect_error(
        lambda: freeze_test_set_b(one, freeze_id="TEST-B", frozen_at="2026-09-30T00:00:00Z"),
        "TEST_B_TARGET_NOT_REACHED",
    )

    expect_error(
        lambda: accumulator([], target_n=99),
        "TEST_B_TARGET_BELOW_GATE4_MINIMUM",
    )

    holdout = accumulator([candidate(2, match_id=HOLDOUT_ID)])
    holdout_status = blind_public_status(holdout)
    assert holdout_status["promotion_eligible_n"] == 0
    assert holdout_status["rejection_reason_counts"]["FROZEN_HOLDOUT_MATCH_REUSE_FORBIDDEN"] == 1

    bad_hash = candidate(3)
    bad_hash["prediction"]["negbin_specification_sha256"] = "0" * 64
    result = accumulator([bad_hash])
    assert result["status"]["rejection_reason_counts"]["CHALLENGER_SPECIFICATION_HASH_MISMATCH"] == 1

    no_snapshot = candidate(4)
    no_snapshot["prediction"]["snapshot_sha256"] = ""
    result = accumulator([no_snapshot])
    assert result["status"]["rejection_reason_counts"]["IMMUTABLE_PREDICTION_SNAPSHOT_ID_AND_SHA256_REQUIRED"] == 1

    post_kickoff_market = candidate(5)
    post_kickoff_market["market"]["observed_at"] = post_kickoff_market["settlement"]["settled_at"]
    result = accumulator([post_kickoff_market])
    assert result["status"]["rejection_reason_counts"]["MARKET_OBSERVATION_NOT_PRE_KICKOFF"] == 1

    outcome_regime = candidate(6)
    outcome_regime["regime"]["uses_outcome"] = True
    result = accumulator([outcome_regime])
    assert result["status"]["rejection_reason_counts"]["REGIME_DERIVED_FROM_OUTCOME_FORBIDDEN"] == 1

    unverified_settlement = candidate(7)
    unverified_settlement["settlement"]["verified"] = False
    result = accumulator([unverified_settlement])
    assert result["status"]["rejection_reason_counts"]["SETTLEMENT_NOT_VERIFIED"] == 1

    duplicate = candidate(8)
    result = accumulator([duplicate, deepcopy(duplicate)])
    assert result["status"]["promotion_eligible_n"] == 1
    assert result["status"]["rejection_reason_counts"]["DUPLICATE_MATCH_ID"] == 1

    rows = [candidate(i) for i in range(102)]
    ready = accumulator(rows)
    ready_public = blind_public_status(ready)
    assert ready_public["state"] == "READY_TO_FREEZE"
    assert ready_public["promotion_eligible_n"] == 102
    assert ready_public["remaining_to_target"] == 0
    assert ready_public["interim_metrics_exposed"] is False
    assert not (set(ready_public) & FORBIDDEN_INTERIM_METRICS)

    latest_selected_settlement = datetime.fromisoformat(
        ready["_accepted_records"][99]["settled_at"].replace("Z", "+00:00")
    )
    expect_error(
        lambda: freeze_test_set_b(
            ready,
            freeze_id="MLS-2026-FUTURE-TEST-B-V0.1",
            frozen_at=z(latest_selected_settlement),
        ),
        "TEST_B_FREEZE_MUST_FOLLOW_ALL_SELECTED_SETTLEMENTS",
    )

    freeze = freeze_test_set_b(
        ready,
        freeze_id="MLS-2026-FUTURE-TEST-B-V0.1",
        frozen_at=z(latest_selected_settlement + timedelta(seconds=1)),
    )
    assert freeze.target_n == 100
    assert len(freeze.match_ids) == 100
    assert len(freeze.record_hashes) == 100
    assert freeze.match_ids == tuple(f"MLS-2026-FUTURE-{i:03d}" for i in range(100))
    assert "MLS-2026-FUTURE-100" not in freeze.match_ids
    assert "MLS-2026-FUTURE-101" not in freeze.match_ids
    assert freeze.interim_metrics_exposed is False
    assert freeze.evaluation_performed is False
    assert freeze.state == "FROZEN_READY_FOR_SEPARATE_ONE_TIME_EVALUATION"
    assert len(freeze.cohort_fingerprint_sha256) == 64

    print("BLIND_FUTURE_TEST_B=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
