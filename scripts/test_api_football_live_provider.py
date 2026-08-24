from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))

from api_football_live_provider import (
    build_live_url,
    live_model_input,
    parse_response,
    provider_manifest,
)


def expect_error(fn, fragment):
    try:
        fn()
    except ValueError as exc:
        assert fragment in str(exc), (fragment, str(exc))
    else:
        raise AssertionError(fragment)


def fixture(*, fixture_id=1001, league_id=39, status="1H", elapsed=27, home_goals=1, away_goals=0):
    return {
        "fixture": {
            "id": fixture_id,
            "date": "2026-08-24T19:00:00+00:00",
            "status": {"long": "First Half", "short": status, "elapsed": elapsed, "extra": None},
        },
        "league": {"id": league_id, "season": 2026, "round": "Regular Season - 1"},
        "teams": {
            "home": {"id": 10, "name": "Alpha FC"},
            "away": {"id": 20, "name": "Beta FC"},
        },
        "goals": {"home": home_goals, "away": away_goals},
    }


def main() -> int:
    manifest = provider_manifest()
    assert manifest["provider"] == "API_FOOTBALL"
    assert len(manifest["competitions"]) == 5
    assert manifest["governance"]["bookmaker_data_used"] is False
    assert manifest["governance"]["provider_prediction_used"] is False
    assert manifest["governance"]["silent_rate_multiplier_derivation"] is False

    url = build_live_url(["EPL", "LA_LIGA"])
    assert "live=39-140" in url
    expect_error(lambda: build_live_url([]), "COMPETITION_SET_EMPTY")
    expect_error(lambda: build_live_url(["UNKNOWN"]), "COMPETITION_UNKNOWN")

    observed_at = "2026-08-24T19:27:10Z"
    rows = parse_response({"errors": [], "response": [fixture()]}, observed_at=observed_at, source_url=url)
    assert len(rows) == 1
    row = rows[0]
    assert row.fixture_id == "EPL-API_FOOTBALL-1001"
    assert row.state == "LIVE_IN_PLAY"
    assert row.elapsed_minute == 27
    assert row.home_goals == 1 and row.away_goals == 0
    assert row.observed_at == observed_at
    assert row.live_in_play_supported is True
    assert row.bookmaker_data_used is False
    assert row.provider_prediction_used is False
    assert len(row.source_fixture_sha256) == 64

    model_input = live_model_input(row)
    assert model_input["minute"] == 27
    assert model_input["homeScore"] == 1
    assert model_input["awayScore"] == 0
    assert model_input["observedAt"] == observed_at
    assert model_input["evidence"][0]["verified"] is True
    assert "UNCHANGED_UNLESS_SEPARATE_VERIFIED" in model_input["rateMultiplierPolicy"]

    settled = parse_response(
        {"errors": [], "response": [fixture(status="FT", elapsed=90, home_goals=2, away_goals=1)]},
        observed_at=observed_at,
    )[0]
    assert settled.state == "SETTLED"
    expect_error(lambda: live_model_input(settled), "REQUIRES_LIVE_IN_PLAY")

    scheduled = parse_response(
        {"errors": [], "response": [fixture(status="NS", elapsed=None, home_goals=None, away_goals=None)]},
        observed_at=observed_at,
    )[0]
    assert scheduled.state == "SCHEDULED"

    postponed = parse_response(
        {"errors": [], "response": [fixture(status="PST", elapsed=None, home_goals=None, away_goals=None)]},
        observed_at=observed_at,
    )[0]
    assert postponed.state == "POSTPONED"

    expect_error(
        lambda: parse_response({"errors": {"token": "invalid"}, "response": []}, observed_at=observed_at),
        "RESPONSE_ERRORS_PRESENT",
    )
    expect_error(
        lambda: parse_response({"errors": [], "response": [fixture(league_id=999999)]}, observed_at=observed_at),
        "UNREGISTERED_LEAGUE",
    )
    expect_error(
        lambda: parse_response(
            {"errors": [], "response": [fixture(status="1H", elapsed=None, home_goals=1, away_goals=0)]},
            observed_at=observed_at,
        ),
        "LIVE_ELAPSED_REQUIRED",
    )
    expect_error(
        lambda: parse_response(
            {"errors": [], "response": [fixture(status="1H", elapsed=27, home_goals=1, away_goals=None)]},
            observed_at=observed_at,
        ),
        "PARTIAL_SCORE",
    )
    expect_error(
        lambda: parse_response(
            {"errors": [], "response": [fixture(fixture_id=1001), fixture(fixture_id=1001)]},
            observed_at=observed_at,
        ),
        "DUPLICATE_FIXTURE_ID",
    )

    print("API_FOOTBALL_LIVE_PROVIDER=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
