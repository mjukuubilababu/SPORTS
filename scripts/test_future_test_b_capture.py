from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))
sys.path.insert(0, str(ROOT / "packages" / "gate2"))
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from gate2_engine import Match
from future_test_b_capture import (
    capture_batch, capture_prematch_snapshot, fixture_match_id,
    parse_fixture_schedule_csv, settled_fixture_matches,
)

REGISTERED = "2026-08-23T13:40:00Z"
CAPTURED = "2026-08-23T16:00:00Z"
SPEC = "650d6cdd6eccc31ec0756cd1bfe80b51032e079ba90c00ad950b86db85508c00"
MODEL = "P002_NEGBIN_CHALLENGER_V0_1"
R = 5.643923860544114

CSV = """Round Number,Match Number,Date,Location,Home Team,Away Team,Result
1,1,01/08/2026 20:00,Stadium,New England Revolution,Atlanta United,2 - 1
2,2,08/08/2026 20:00,Stadium,New York City Football Club,Sporting Kansas City,1 - 0
3,3,12/08/2026 20:00,Stadium,Atlanta United,New England Revolution,0 - 1
4,4,15/08/2026 20:00,Stadium,Sporting Kansas City,New York City Football Club,1 - 2
5,5,18/08/2026 20:00,Stadium,New England Revolution,New York City Football Club,3 - 1
6,6,19/08/2026 20:00,Stadium,New York City Football Club,Atlanta United,1 - 1
7,7,23/08/2026 20:30,Gillette Stadium,New England Revolution,New York City Football Club,-
8,8,23/08/2026 23:00,Mercedes-Benz Stadium,Atlanta United,Sporting Kansas City,-
"""


def prior_history() -> list[Match]:
    teams = ["new england revolution", "new york city fc", "atlanta united", "sporting kansas city"]
    rows: list[Match] = []
    for i in range(6):
        for j, team in enumerate(teams):
            opp = teams[(j + 1) % len(teams)]
            if team == opp:
                continue
            rows.append(Match(
                date=f"2025-0{3 + (i // 3)}-{10 + i:02d}", season=2025, league="MLS",
                home=team, away=opp, hg=(i + j) % 3, ag=(i + j + 1) % 2,
            ))
    return rows


def expect_error(fn, fragment: str) -> None:
    try:
        fn()
    except ValueError as exc:
        assert fragment in str(exc), (fragment, str(exc))
    else:
        raise AssertionError(f"Expected ValueError containing {fragment}")


def main() -> int:
    fixtures = parse_fixture_schedule_csv(CSV)
    assert len(fixtures) == 8
    settled = settled_fixture_matches(fixtures, captured_at=CAPTURED)
    assert len(settled) == 6
    future = fixtures[-2:]
    assert all(not f.is_settled for f in future)

    history = [*prior_history(), *settled]
    first = capture_prematch_snapshot(
        fixture=future[0], history=history, captured_at=CAPTURED,
        registered_at=REGISTERED, challenger_model_version=MODEL,
        challenger_specification_sha256=SPEC, dispersion_r=R,
        fixture_source_sha256="a" * 64,
    )
    assert first["state"] == "PREMATCH_FROZEN"
    assert first["test_b_eligible"] is False
    assert first["market"] is None and first["settlement"] is None
    assert first["prediction"]["uses_market_odds"] is False
    assert 0 < first["prediction"]["poisson_probability_u35"] < 1
    assert 0 < first["prediction"]["negbin_probability_u35"] < 1
    assert len(first["prediction"]["snapshot_sha256"]) == 64
    assert len(first["regime"]["snapshot_sha256"]) == 64
    assert len(first["record_sha256"]) == 64

    ids = [fixture_match_id(f) for f in future]
    batch = capture_batch(
        fixtures=fixtures, target_match_ids=ids, history=history,
        captured_at=CAPTURED, registered_at=REGISTERED,
        challenger_model_version=MODEL, challenger_specification_sha256=SPEC,
        dispersion_r=R, fixture_source_sha256="b" * 64,
    )
    assert batch["summary"] == {"prematch_frozen": 2, "test_b_eligible": 0}
    assert batch["performance_metrics_exposed"] is False
    assert len({r["match_id"] for r in batch["records"]}) == 2
    assert all(r["next_required_state"] == "CLOSING_MARKET_CAPTURED" for r in batch["records"])

    expect_error(
        lambda: capture_prematch_snapshot(
            fixture=future[0], history=history, captured_at="2026-08-23T21:00:00Z",
            registered_at=REGISTERED, challenger_model_version=MODEL,
            challenger_specification_sha256=SPEC, dispersion_r=R,
            fixture_source_sha256="c" * 64,
        ),
        "PREMATCH_CAPTURE_NOT_BEFORE_KICKOFF",
    )
    # A historical settled fixture must fail closed. The current check order rejects
    # it at the pre-kickoff boundary before reaching the redundant settled-result guard.
    expect_error(
        lambda: capture_prematch_snapshot(
            fixture=fixtures[0], history=history, captured_at=CAPTURED,
            registered_at=REGISTERED, challenger_model_version=MODEL,
            challenger_specification_sha256=SPEC, dispersion_r=R,
            fixture_source_sha256="d" * 64,
        ),
        "PREMATCH_CAPTURE_NOT_BEFORE_KICKOFF",
    )

    print("FUTURE_TEST_B_PREMATCH_CAPTURE=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
