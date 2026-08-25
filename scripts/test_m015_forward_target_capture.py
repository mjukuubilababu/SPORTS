from __future__ import annotations

from copy import deepcopy
from datetime import date, timedelta
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))
sys.path.insert(0, str(ROOT / "packages" / "gate2"))
sys.path.insert(0, str(ROOT / "packages" / "gate3"))
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from canonical_backfill import build_backfill_from_truth_store
from future_test_b_capture import ScheduledFixture, fixture_match_id
from m015_forward_evidence_ledger import append_settlement, empty_ledger, validate_ledger
from m015_forward_target_capture import (
    freeze_candidate_with_market,
    prepare_target_candidate,
    verify_candidate,
)
from m015_forward_validation import settle_prediction

REGISTRATION_PATH = ROOT / "packages" / "gate4" / "data" / "m015-forward-registration-v0.1.json"


def expect_error(fn, fragment: str) -> None:
    try:
        fn()
    except ValueError as exc:
        assert fragment in str(exc), (fragment, str(exc))
    else:
        raise AssertionError(f"Expected ValueError containing {fragment}")


def build_synthetic_base(registration: dict) -> tuple[dict, dict, dict]:
    teams = ["atlanta united", "chicago fire", "columbus crew", "inter miami"]
    start = date(2026, 3, 1)
    records = []
    for i in range(80):
        d = (start + timedelta(days=i)).isoformat()
        home = teams[i % 4]
        away = teams[(i + 1) % 4]
        hg = 1 + (i % 3)
        ag = (i + 1) % 2
        records.append({
            "match_id": f"SYNTH-M015-{i:03d}",
            "canonical_match_date": d,
            "season": 2026,
            "league": "MLS",
            "home_team": home,
            "away_team": away,
            "final_score": {"home": hg, "away": ag},
            "result": {"verified": True},
            "market": {"status": "NOT_AVAILABLE"},
            "gate2_backfill_eligible": True,
            "gate1_validation_n_eligible": False,
        })
    store = {
        "store_version": "CANONICAL_HISTORICAL_TRUTH_STORE_V0_1",
        "dataset_id": "SYNTH-M015-REGISTERED-BASE-V0.1",
        "data_nature": "REAL_HISTORICAL_TRUTH",
        "records": records,
    }
    gate2 = build_backfill_from_truth_store(store)
    reg = deepcopy(registration)
    reg["training_snapshot"]["dataset_id"] = store["dataset_id"]
    reg["training_snapshot"]["latest_match_date"] = records[-1]["canonical_match_date"]
    reg["training_snapshot"]["gate2_feature_rows"] = len(gate2["features"])
    return reg, store, gate2


def fixture(*, row_id: str, kickoff: str, home: str = "atlanta united", away: str = "chicago fire") -> ScheduledFixture:
    return ScheduledFixture(
        source_row_id=row_id,
        round_number=1,
        kickoff_at_utc=kickoff,
        venue="Synthetic Ground",
        home_team=home,
        away_team=away,
        result="",
    )


def market(observed_at: str, *, o35: float = 1.90, u35: float = 1.90) -> dict:
    return {
        "provider": "SYNTHETIC_TEST_PROVIDER",
        "source_type": "UNIT_TEST_FIXTURE",
        "is_verified": True,
        "is_primary": True,
        "observed_at": observed_at,
        "o35": o35,
        "u35": u35,
        "provider_event_id": "SYNTH-EVENT-001",
    }


def main() -> int:
    registration = json.loads(REGISTRATION_PATH.read_text(encoding="utf-8"))
    registration, truth_store, gate2 = build_synthetic_base(registration)
    ledger = empty_ledger(registration)
    forbidden = ["MLS-2026-CONSUMED-TEST-ID"]

    first_fixture = fixture(row_id="FWD-001", kickoff="2026-09-01T23:30:00Z")
    first = prepare_target_candidate(
        registration=registration,
        ledger=ledger,
        truth_store=truth_store,
        gate2_backfill=gate2,
        fixture=first_fixture,
        prepared_at="2026-09-01T20:00:00Z",
        forbidden_match_ids=forbidden,
    )
    assert verify_candidate(first) is True
    assert first["state"] == "MODEL_READY_MARKET_PENDING"
    assert first["market_probability"] is None
    assert first["market_snapshot"] is None
    assert first["governance"]["market_used_as_model_input"] is False
    assert first["training_state"]["training_n"] >= 30
    assert first["model_feature_snapshot"]["post_lineup_lambda"] > 0
    original_model_probability = first["model_probability"]

    frozen_a = freeze_candidate_with_market(
        registration=registration,
        ledger=ledger,
        candidate=first,
        market_snapshot=market("2026-09-01T20:05:00Z", o35=1.80, u35=2.00),
        forbidden_match_ids=forbidden,
    )
    frozen_b = freeze_candidate_with_market(
        registration=registration,
        ledger=ledger,
        candidate=first,
        market_snapshot=market("2026-09-01T20:06:00Z", o35=2.10, u35=1.75),
        forbidden_match_ids=forbidden,
    )
    assert frozen_a["frozen_prediction"]["model_probability"] == original_model_probability
    assert frozen_b["frozen_prediction"]["model_probability"] == original_model_probability
    assert frozen_a["frozen_prediction"]["market_probability"] != frozen_b["frozen_prediction"]["market_probability"]
    assert frozen_a["summary"]["ledger_pending_n"] == 1
    assert frozen_a["summary"]["ledger_settled_independent_n"] == 0
    assert frozen_a["governance"]["independent_n_incremented"] is False

    ledger1 = frozen_a["ledger"]
    report1 = validate_ledger(ledger1, registration, forbidden_match_ids=forbidden)
    assert report1["pending_n"] == 1
    assert report1["settled_n"] == 0
    assert report1["evaluation"]["summary"]["independent_validation_n"] == 0

    expect_error(
        lambda: prepare_target_candidate(
            registration=registration,
            ledger=ledger1,
            truth_store=truth_store,
            gate2_backfill=gate2,
            fixture=first_fixture,
            prepared_at="2026-09-01T20:10:00Z",
            forbidden_match_ids=forbidden,
        ),
        "ALREADY_PRESENT_IN_LEDGER",
    )

    tampered = deepcopy(first)
    tampered["model_probability"] = 0.99
    expect_error(
        lambda: freeze_candidate_with_market(
            registration=registration,
            ledger=ledger,
            candidate=tampered,
            market_snapshot=market("2026-09-01T20:05:00Z"),
            forbidden_match_ids=forbidden,
        ),
        "CANDIDATE_TAMPERED",
    )

    expect_error(
        lambda: freeze_candidate_with_market(
            registration=registration,
            ledger=ledger,
            candidate=first,
            market_snapshot=market("2026-09-02T00:00:00Z"),
            forbidden_match_ids=forbidden,
        ),
        "MARKET_NOT_PRE_KICKOFF",
    )

    settled = settle_prediction(
        frozen_a["frozen_prediction"],
        {
            "match_id": first["match_id"],
            "result_verified": True,
            "final_score": {"home": 2, "away": 1},
            "settled_at": "2026-09-02T02:30:00Z",
        },
    )
    ledger2 = append_settlement(ledger1, registration, settled)
    report2 = validate_ledger(ledger2, registration, forbidden_match_ids=forbidden)
    assert report2["settled_n"] == 1
    assert report2["evaluation"]["summary"]["independent_validation_n"] == 1

    later_fixture = fixture(
        row_id="FWD-002",
        kickoff="2026-09-08T23:30:00Z",
        home="columbus crew",
        away="inter miami",
    )
    later = prepare_target_candidate(
        registration=registration,
        ledger=ledger2,
        truth_store=truth_store,
        gate2_backfill=gate2,
        fixture=later_fixture,
        prepared_at="2026-09-08T20:00:00Z",
        forbidden_match_ids=forbidden,
    )
    assert first["match_id"] in later["training_state"]["forward_training_match_ids"]
    assert later["training_state"]["training_n"] == first["training_state"]["training_n"] + 1

    # Same-date outcomes remain excluded by the preregistered date-batched semantics.
    same_date_fixture = fixture(
        row_id="FWD-003",
        kickoff="2026-09-02T01:30:00Z",
        home="atlanta united",
        away="chicago fire",
    )
    same_date = prepare_target_candidate(
        registration=registration,
        ledger=ledger2,
        truth_store=truth_store,
        gate2_backfill=gate2,
        fixture=same_date_fixture,
        prepared_at="2026-09-02T00:30:00Z",
        forbidden_match_ids=forbidden,
    )
    assert first["match_id"] not in same_date["training_state"]["forward_training_match_ids"]
    assert same_date["training_state"]["training_n"] == first["training_state"]["training_n"]

    consumed_fixture = fixture(row_id="FWD-004", kickoff="2026-09-10T23:30:00Z")
    consumed_id = fixture_match_id(consumed_fixture)
    expect_error(
        lambda: prepare_target_candidate(
            registration=registration,
            ledger=ledger2,
            truth_store=truth_store,
            gate2_backfill=gate2,
            fixture=consumed_fixture,
            prepared_at="2026-09-10T20:00:00Z",
            forbidden_match_ids=[*forbidden, consumed_id],
        ),
        "CONSUMED_HOLDOUT_OVERLAP",
    )

    bad_gate2 = deepcopy(gate2)
    bad_gate2["features"] = bad_gate2["features"][:-1]
    expect_error(
        lambda: prepare_target_candidate(
            registration=registration,
            ledger=ledger,
            truth_store=truth_store,
            gate2_backfill=bad_gate2,
            fixture=first_fixture,
            prepared_at="2026-09-01T20:00:00Z",
            forbidden_match_ids=forbidden,
        ),
        "REGISTERED_GATE2_FEATURE_COUNT_MISMATCH",
    )

    print("M015_FORWARD_TARGET_CAPTURE_TEST=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
