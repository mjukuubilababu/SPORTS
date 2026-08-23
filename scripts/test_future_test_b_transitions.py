from __future__ import annotations

import sys
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate2"))
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from future_test_b_transition import attach_verified_closing_market, attach_verified_settlement, to_blind_candidate


def prematch() -> dict:
    return {
        "state": "PREMATCH_FROZEN",
        "match_id": "MLS-2026-2026-08-23-test",
        "competition": "MLS",
        "kickoff_at": "2026-08-23T20:30:00Z",
        "prediction": {
            "snapshot_id": "PRED-1",
            "snapshot_sha256": "1" * 64,
            "frozen_at": "2026-08-23T16:00:00Z",
            "poisson_model_version": "P002_GATE2_POISSON_U35_V0_1",
            "poisson_probability_u35": 0.61,
            "negbin_model_version": "P002_NEGBIN_CHALLENGER_V0_1",
            "negbin_specification_sha256": "2" * 64,
            "negbin_probability_u35": 0.63,
            "uses_market_odds": False,
        },
        "regime": {
            "snapshot_id": "REG-1",
            "snapshot_sha256": "3" * 64,
            "label": "MLS_2026_REGULAR_SEASON",
            "source": "MLS_OFFICIAL_2026_REGULAR_SEASON_SCHEDULE",
            "source_url": "https://example.test/schedule",
            "observed_at": "2026-08-23T16:00:00Z",
            "verified": True,
            "uses_outcome": False,
            "uses_market_odds": False,
        },
        "market": None,
        "settlement": None,
        "test_b_eligible": False,
        "record_sha256": "4" * 64,
    }


def expect_error(fn, fragment: str) -> None:
    try:
        fn()
    except ValueError as exc:
        assert fragment in str(exc), (fragment, str(exc))
    else:
        raise AssertionError(fragment)


def main() -> int:
    base = prematch()
    priced = attach_verified_closing_market(
        base,
        provider="1xBet",
        source="Footiqo",
        source_url="https://example.test/market",
        observed_at="2026-08-23T20:25:00Z",
        over35_odds=2.20,
        under35_odds=1.70,
        source_verified=True,
        closing_semantics_verified=True,
    )
    assert base["market"] is None
    assert priced["state"] == "CLOSING_MARKET_CAPTURED"
    assert priced["test_b_eligible"] is False
    assert 0 < priced["market"]["fair_probability_u35"] < 1
    assert len(priced["market"]["snapshot_sha256"]) == 64
    assert priced["parent_record_sha256"] == base["record_sha256"]

    settled = attach_verified_settlement(
        priced,
        source="FixtureDownload",
        source_url="https://example.test/result",
        verified=True,
        settled_at="2026-08-23T22:30:00Z",
        home_goals=2,
        away_goals=1,
    )
    assert settled["state"] == "SETTLED_ELIGIBLE"
    assert settled["test_b_eligible"] is True
    assert settled["parent_record_sha256"] == priced["record_sha256"]
    candidate = to_blind_candidate(settled)
    assert candidate["match_id"] == base["match_id"]
    assert candidate["prediction"]["uses_market_odds"] is False
    assert candidate["settlement"]["verified"] is True

    expect_error(lambda: attach_verified_closing_market(
        deepcopy(base), provider="book", source="src", source_url="u",
        observed_at="2026-08-23T20:31:00Z", over35_odds=2.2, under35_odds=1.7,
        source_verified=True, closing_semantics_verified=True,
    ), "CLOSING_MARKET_NOT_PRE_KICKOFF")
    expect_error(lambda: attach_verified_closing_market(
        deepcopy(base), provider="book", source="src", source_url="u",
        observed_at="2026-08-23T20:25:00Z", over35_odds=2.2, under35_odds=1.7,
        source_verified=True, closing_semantics_verified=False,
    ), "CLOSING_MARKET_SEMANTICS_NOT_VERIFIED")
    expect_error(lambda: attach_verified_settlement(
        priced, source="FixtureDownload", source_url="u", verified=True,
        settled_at="2026-08-23T20:29:00Z", home_goals=1, away_goals=0,
    ), "SETTLEMENT_NOT_POST_KICKOFF")
    expect_error(lambda: to_blind_candidate(priced), "BLIND_CANDIDATE_REQUIRES_SETTLED_ELIGIBLE_STATE")

    print("FUTURE_TEST_B_TRANSITIONS=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
