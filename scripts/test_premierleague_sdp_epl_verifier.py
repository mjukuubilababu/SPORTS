from __future__ import annotations

import copy
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))

from premierleague_sdp_epl_verifier import parse_sdp_matches, reconcile_espn_sdp
import run_current_multileague_discovery as discovery

OBSERVED = "2026-08-25T00:00:00Z"
URL = "https://sdp-prem-prod.premier-league-prod.pulselive.com/api/v2/matches?competition=8&season=2026"


def expect_error(fn, fragment):
    try:
        fn()
    except ValueError as exc:
        assert fragment in str(exc), (fragment, str(exc))
    else:
        raise AssertionError(fragment)


def sdp_match(*, match_id=1001, kickoff="2026-08-28T19:00:00Z", home="Crystal Palace", away="Manchester City", period="PreMatch", hg=None, ag=None):
    return {
        "matchId": match_id,
        "competitionId": 8,
        "season": 2026,
        "kickoff": kickoff,
        "period": period,
        "homeTeam": {"id": 31, "name": home, "score": hg},
        "awayTeam": {"id": 43, "name": away, "score": ag},
    }


def espn_row(*, fixture_id="espn-1", kickoff="2026-08-28T19:00:00Z", home="Crystal Palace", away="Manchester City", state="SCHEDULED", hg=None, ag=None, sha="e" * 64):
    return SimpleNamespace(
        provider_fixture_id=fixture_id,
        competition_id="EPL",
        kickoff_utc=kickoff,
        home=home,
        away=away,
        state=state,
        home_goals=hg,
        away_goals=ag,
        source_event_sha256=sha,
    )


def main() -> int:
    scheduled = parse_sdp_matches({"data": [sdp_match()]}, observed_at=OBSERVED, source_url=URL)
    assert len(scheduled) == 1
    assert scheduled[0].state == "SCHEDULED"
    assert scheduled[0].home_key == "CRYSTAL_PALACE"
    assert scheduled[0].away_key == "MANCHESTER_CITY"

    settled_payload = {"data": [sdp_match(kickoff="2026-08-22T14:00:00Z", period="FullTime", hg=2, ag=1)]}
    settled = parse_sdp_matches(settled_payload, observed_at=OBSERVED, source_url=URL)
    assert settled[0].state == "SETTLED"
    assert (settled[0].home_goals, settled[0].away_goals, settled[0].result) == (2, 1, "H")

    # Live is deliberately excluded from current snapshot verification.
    assert parse_sdp_matches({"data": [sdp_match(period="Live")]}, observed_at=OBSERVED, source_url=URL) == ()

    # A past prematch row is ambiguous/delayed and must not be mislabeled scheduled.
    past = sdp_match(kickoff="2026-08-24T19:00:00Z", period="PreMatch")
    assert parse_sdp_matches({"data": [past]}, observed_at=OBSERVED, source_url=URL) == ()

    bad = sdp_match(home="Unknown FC")
    expect_error(lambda: parse_sdp_matches({"data": [bad]}, observed_at=OBSERVED, source_url=URL), "TEAM_ALIAS_UNKNOWN")

    bad = sdp_match(period="FullTime", hg=None, ag=1)
    expect_error(lambda: parse_sdp_matches({"data": [bad]}, observed_at=OBSERVED, source_url=URL), "HOME_SCORE_INTEGER_REQUIRED")

    bad = sdp_match(period="FullTime", hg="1.5", ag=1)
    expect_error(lambda: parse_sdp_matches({"data": [bad]}, observed_at=OBSERVED, source_url=URL), "HOME_SCORE_INTEGER_REQUIRED")

    bad = sdp_match()
    bad["competitionId"] = 10
    expect_error(lambda: parse_sdp_matches({"data": [bad]}, observed_at=OBSERVED, source_url=URL), "COMPETITION_MISMATCH")

    bad = sdp_match()
    bad["season"] = 2025
    expect_error(lambda: parse_sdp_matches({"data": [bad]}, observed_at=OBSERVED, source_url=URL), "SEASON_MISMATCH")

    good = reconcile_espn_sdp([espn_row()], scheduled)
    assert good["reconciled_n"] == 1
    assert good["strict_gate1_eligible_n"] == 1
    assert good["fuzzy_matching"] is False
    assert good["reconciled"][0]["reconciliation"] == "EXACT_CROSS_SOURCE_MATCH"

    kickoff_mismatch = reconcile_espn_sdp([espn_row(kickoff="2026-08-28T19:01:00Z")], scheduled)
    assert kickoff_mismatch["reconciled_n"] == 0
    assert kickoff_mismatch["unmatched"][0]["reason"] == "NO_EXACT_PREMIERLEAGUE_SDP_IDENTITY_MATCH"

    settled_espn = espn_row(kickoff="2026-08-22T14:00:00Z", state="SETTLED", hg=2, ag=0)
    score_mismatch = reconcile_espn_sdp([settled_espn], settled)
    assert score_mismatch["reconciled_n"] == 0
    assert score_mismatch["unmatched"][0]["reason"] == "FINAL_SCORE_MISMATCH"

    state_mismatch = reconcile_espn_sdp([espn_row(state="SETTLED", hg=0, ag=0)], scheduled)
    assert state_mismatch["reconciled_n"] == 0
    assert state_mismatch["unmatched"][0]["reason"] == "STATE_MISMATCH"

    duplicate = {"data": [copy.deepcopy(sdp_match(match_id=1001)), copy.deepcopy(sdp_match(match_id=1001))]}
    expect_error(lambda: parse_sdp_matches(duplicate, observed_at=OBSERVED, source_url=URL), "MATCH_DUPLICATE")

    # Matching rows from a partial ESPN request window must remain discovery-only.
    original_fetch_json = discovery.fetch_json
    try:
        discovery.fetch_json = lambda _url: {"data": [sdp_match()]}
        summary = {
            "request_failure_n": 1,
            "availability": "AVAILABLE_SECONDARY_DISCOVERY",
            "provider": "ESPN_SITE_SCOREBOARD",
            "source_class": "SECONDARY_DISCOVERY",
            "discovery_only": True,
            "strict_gate1_eligible": False,
            "strict_gate1_rows_n": 0,
        }
        result = discovery.verify_epl_secondary(
            summary,
            [espn_row()],
            OBSERVED,
            discovery.datetime.fromisoformat(OBSERVED.replace("Z", "+00:00")),
        )
        assert result["cross_source_verification"]["full_window_reconciled"] is False
        assert result["strict_gate1_eligible"] is False
        assert result["discovery_only"] is True
    finally:
        discovery.fetch_json = original_fetch_json

    print("PREMIERLEAGUE_SDP_EPL_VERIFIER=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
