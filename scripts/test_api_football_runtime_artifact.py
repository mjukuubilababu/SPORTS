from __future__ import annotations

import copy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from verify_api_football_runtime_artifact import verify


def expect_error(payload, fragment):
    try:
        verify(payload)
    except ValueError as exc:
        assert fragment in str(exc), (fragment, str(exc))
    else:
        raise AssertionError(fragment)


def zero_live():
    return {
        "capability": "API_FOOTBALL_LIVE_PROVIDER_V0_1",
        "observed_at": "2026-08-24T21:30:00Z",
        "competitions_requested": ["EPL", "LA_LIGA", "SERIE_A", "BUNDESLIGA", "LIGUE_1"],
        "rows_n": 0,
        "live_in_play_n": 0,
        "snapshots": [],
        "live_model_inputs": [],
        "governance": {
            "provider_prediction_used": False,
            "bookmaker_data_used": False,
            "api_key_persisted": False,
            "silent_rate_multiplier_derivation": False,
            "real_money": "NO",
        },
    }


def live_capture():
    payload = zero_live()
    payload["rows_n"] = 1
    payload["live_in_play_n"] = 1
    payload["snapshots"] = [{
        "fixture_id": "EPL-API_FOOTBALL-12345",
        "provider": "API_FOOTBALL",
        "provider_fixture_id": 12345,
        "competition_id": "EPL",
        "state": "LIVE_IN_PLAY",
        "status_short": "1H",
        "elapsed_minute": 25,
        "home_goals": 1,
        "away_goals": 0,
        "observed_at": "2026-08-24T21:30:00Z",
        "source_url": "https://v3.football.api-sports.io/fixtures?live=39-140",
        "source_fixture_sha256": "a" * 64,
        "bookmaker_data_used": False,
        "provider_prediction_used": False,
    }]
    payload["live_model_inputs"] = [{
        "eventId": "EPL-API_FOOTBALL-12345",
        "minute": 25,
        "homeScore": 1,
        "awayScore": 0,
        "observedAt": "2026-08-24T21:30:00Z",
        "evidence": [{
            "type": "LIVE_SCORE_TIME_PROVIDER_SNAPSHOT",
            "provider": "API_FOOTBALL",
            "providerFixtureId": 12345,
            "status": "1H",
            "sourceFixtureSha256": "a" * 64,
            "verified": True,
        }],
        "rateMultiplierPolicy": "UNCHANGED_UNLESS_SEPARATE_VERIFIED_EVENT_IMPACT_MODEL_SUPPLIES_MULTIPLIERS",
    }]
    return payload


def main() -> int:
    empty = verify(zero_live())
    assert empty["authenticated_provider_response_artifact"] == "VALID"
    assert empty["live_match_captured"] is False
    assert empty["zero_live_rows_is_valid_provider_runtime"] is True
    assert empty["live_model_input_linkage"] == "EXACT_VERIFIED"

    live = verify(live_capture())
    assert live["live_match_captured"] is True
    assert live["live_in_play_n"] == 1
    assert live["live_model_input_linkage"] == "EXACT_VERIFIED"

    bad = zero_live()
    bad["api_key"] = "must-never-be-here"
    expect_error(bad, "SECRET_FIELD_FORBIDDEN")

    bad = live_capture()
    bad["snapshots"][0]["source_url"] = "https://v3.football.api-sports.io/fixtures?live=39&token=abc"
    expect_error(bad, "SOURCE_URL_CONTAINS_SECRET")

    bad = live_capture()
    bad["rows_n"] = 2
    expect_error(bad, "ROWS_COUNT_MISMATCH")

    bad = live_capture()
    bad["snapshots"][0]["provider_prediction_used"] = True
    expect_error(bad, "PROVIDER_PREDICTION_FORBIDDEN")

    bad = zero_live()
    bad["competitions_requested"] = ["UNKNOWN"]
    expect_error(bad, "COMPETITION_UNSUPPORTED")

    bad = live_capture()
    bad["live_model_inputs"][0]["minute"] = 26
    expect_error(bad, "LIVE_MODEL_INPUT_MINUTE_MISMATCH")

    bad = live_capture()
    bad["live_model_inputs"][0]["homeScore"] = 9
    expect_error(bad, "LIVE_MODEL_INPUT_HOME_SCORE_MISMATCH")

    bad = live_capture()
    bad["live_model_inputs"][0]["evidence"][0]["providerFixtureId"] = 99999
    expect_error(bad, "LIVE_MODEL_INPUT_PROVENANCE_MISMATCH")

    bad = live_capture()
    bad["snapshots"][0]["competition_id"] = "LA_LIGA"
    expect_error(bad, "CANONICAL_FIXTURE_ID_MISMATCH")

    bad = live_capture()
    bad["snapshots"][0]["observed_at"] = "2026-08-24T21:31:00Z"
    expect_error(bad, "ROW_OBSERVED_AT_MISMATCH")

    print("API_FOOTBALL_RUNTIME_ARTIFACT_VERIFIER=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
