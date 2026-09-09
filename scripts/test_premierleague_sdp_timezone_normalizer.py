from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))

from premierleague_sdp_timezone_normalizer import normalize_sdp_kickoffs


def expect_error(fn, fragment):
    try:
        fn()
    except ValueError as exc:
        assert fragment in str(exc), (fragment, str(exc))
    else:
        raise AssertionError(fragment)


def main() -> int:
    payload = {
        "data": [{
            "matchId": 1,
            "kickoff": "2026-08-28T20:00:00",
            "kickoffTimezone": "Europe/London",
        }]
    }
    normalized = normalize_sdp_kickoffs(payload)
    assert normalized["data"][0]["kickoff"] == "2026-08-28T19:00:00Z"
    assert payload["data"][0]["kickoff"] == "2026-08-28T20:00:00"

    winter = normalize_sdp_kickoffs({"data": [{
        "matchId": 2,
        "kickoff": "2026-12-05T15:00:00",
        "kickoffTimezone": "Europe/London",
    }]})
    assert winter["data"][0]["kickoff"] == "2026-12-05T15:00:00Z"

    aware = normalize_sdp_kickoffs({"data": [{
        "matchId": 3,
        "kickoff": "2026-08-28T19:00:00Z",
        "kickoffTimezone": "Europe/London",
    }]})
    assert aware["data"][0]["kickoff"] == "2026-08-28T19:00:00Z"

    millis = normalize_sdp_kickoffs({"data": [{
        "matchId": 4,
        "kickoff": {"millis": 1787943600000},
        "kickoffTimezone": "Europe/London",
    }]})
    assert millis["data"][0]["kickoff"]["millis"] == 1787943600000

    expect_error(
        lambda: normalize_sdp_kickoffs({"data": [{"matchId": 5, "kickoff": "2026-08-28T20:00:00"}]}),
        "TIMEZONE_FIELD_REQUIRED",
    )
    expect_error(
        lambda: normalize_sdp_kickoffs({"data": [{
            "matchId": 6,
            "kickoff": "2026-08-28T20:00:00",
            "kickoffTimezone": "NOT/A_ZONE",
        }]}),
        "TIMEZONE_UNSUPPORTED",
    )

    print("PREMIERLEAGUE_SDP_TIMEZONE_NORMALIZER=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
