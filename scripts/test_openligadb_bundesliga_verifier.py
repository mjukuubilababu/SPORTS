from __future__ import annotations

import copy
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))

from openligadb_bundesliga_verifier import parse_openligadb, reconcile_espn_openligadb

OBSERVED = "2026-08-25T00:00:00Z"


def expect_error(fn, fragment):
    try:
        fn()
    except ValueError as exc:
        assert fragment in str(exc), (fragment, str(exc))
    else:
        raise AssertionError(fragment)


def open_match(*, match_id=1, kickoff="2026-08-28T18:30:00Z", home="FC Bayern München", away="FC Schalke 04", finished=False, results=None):
    return {
        "matchID": match_id,
        "matchDateTimeUTC": kickoff,
        "leagueShortcut": "bl1",
        "leagueSeason": "2026",
        "team1": {"teamId": 40, "teamName": home},
        "team2": {"teamId": 9, "teamName": away},
        "matchIsFinished": finished,
        "matchResults": [] if results is None else results,
    }


def espn_row(*, fixture_id="espn-1", kickoff="2026-08-28T18:30:00Z", home="Bayern Munich", away="Schalke 04", state="SCHEDULED", hg=None, ag=None, sha="e" * 64):
    return SimpleNamespace(
        provider_fixture_id=fixture_id,
        competition_id="BUNDESLIGA",
        kickoff_utc=kickoff,
        home=home,
        away=away,
        state=state,
        home_goals=hg,
        away_goals=ag,
        source_event_sha256=sha,
    )


def main() -> int:
    scheduled = parse_openligadb([open_match()], observed_at=OBSERVED)
    assert len(scheduled) == 1
    assert scheduled[0].state == "SCHEDULED"
    assert scheduled[0].home_key == "BAYERN_MUNICH"
    assert scheduled[0].away_key == "SCHALKE_04"

    finished = open_match(
        finished=True,
        results=[
            {"resultOrder": 1, "pointsTeam1": 1, "pointsTeam2": 0, "resultName": "Halbzeit"},
            {"resultOrder": 2, "pointsTeam1": 2, "pointsTeam2": 1, "resultName": "Endergebnis"},
        ],
    )
    settled = parse_openligadb([finished], observed_at=OBSERVED)
    assert settled[0].state == "SETTLED"
    assert (settled[0].home_goals, settled[0].away_goals, settled[0].result) == (2, 1, "H")

    # Past but unfinished is ambiguous/live/delayed and must never be mislabeled scheduled.
    past = open_match(kickoff="2026-08-24T18:30:00Z", finished=False)
    assert parse_openligadb([past], observed_at=OBSERVED) == ()

    bad = open_match(home="Unknown FC")
    expect_error(lambda: parse_openligadb([bad], observed_at=OBSERVED), "TEAM_ALIAS_UNKNOWN")

    bad = open_match(finished=True, results=[])
    expect_error(lambda: parse_openligadb([bad], observed_at=OBSERVED), "FINAL_RESULT_REQUIRED")

    good_recon = reconcile_espn_openligadb([espn_row()], scheduled)
    assert good_recon["reconciled_n"] == 1
    assert good_recon["strict_gate1_eligible_n"] == 1
    assert good_recon["fuzzy_matching"] is False
    assert good_recon["reconciled"][0]["reconciliation"] == "EXACT_CROSS_SOURCE_MATCH"

    kickoff_mismatch = reconcile_espn_openligadb(
        [espn_row(kickoff="2026-08-28T18:31:00Z")],
        scheduled,
    )
    assert kickoff_mismatch["reconciled_n"] == 0
    assert kickoff_mismatch["unmatched"][0]["reason"] == "NO_EXACT_OPENLIGADB_IDENTITY_MATCH"

    espn_settled = espn_row(state="SETTLED", hg=2, ag=0)
    score_mismatch = reconcile_espn_openligadb([espn_settled], settled)
    assert score_mismatch["reconciled_n"] == 0
    assert score_mismatch["unmatched"][0]["reason"] == "FINAL_SCORE_MISMATCH"

    state_mismatch = reconcile_espn_openligadb([espn_row(state="SETTLED", hg=0, ag=0)], scheduled)
    assert state_mismatch["reconciled_n"] == 0
    assert state_mismatch["unmatched"][0]["reason"] == "STATE_MISMATCH"

    duplicate = [copy.deepcopy(open_match(match_id=1)), copy.deepcopy(open_match(match_id=1))]
    expect_error(lambda: parse_openligadb(duplicate, observed_at=OBSERVED), "MATCH_DUPLICATE")

    print("OPENLIGADB_BUNDESLIGA_VERIFIER=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
