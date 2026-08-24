from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))

from football_data_multileague_adapter import build_gate2_features_by_competition, parse_football_data_csv
from global_competition_registry import get_competition, registry_manifest


def csv_for(code: str, prefix: str) -> str:
    rows = ["Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HTHG,HTAG,HS,AS,HST,AST,B365CH,B365CD,B365CA,B365C>2.5,B365C<2.5"]
    fixtures = [
        ("01/08/2025", f"{prefix} Alpha", f"{prefix} Beta", 2, 0),
        ("08/08/2025", f"{prefix} Gamma", f"{prefix} Alpha", 1, 1),
        ("15/08/2025", f"{prefix} Beta", f"{prefix} Gamma", 0, 1),
        ("22/08/2025", f"{prefix} Alpha", f"{prefix} Gamma", 3, 1),
        ("29/08/2025", f"{prefix} Beta", f"{prefix} Alpha", 1, 2),
        ("05/09/2025", f"{prefix} Gamma", f"{prefix} Beta", 2, 2),
        ("12/09/2025", f"{prefix} Alpha", f"{prefix} Beta", 1, 0),
        ("19/09/2025", f"{prefix} Gamma", f"{prefix} Alpha", 0, 2),
    ]
    for date, home, away, hg, ag in fixtures:
        result = "H" if hg > ag else "A" if ag > hg else "D"
        rows.append(f"{code},{date},{home},{away},{hg},{ag},{result},1,0,12,9,5,3,1.80,3.60,4.50,1.95,1.87")
    return "\n".join(rows) + "\n"


def expect_error(fn, fragment: str) -> None:
    try:
        fn()
    except ValueError as exc:
        assert fragment in str(exc), (fragment, str(exc))
    else:
        raise AssertionError(fragment)


def main() -> int:
    registry = registry_manifest()
    assert registry["competition_count"] == 5
    assert {x["competition_id"] for x in registry["competitions"]} == {"EPL", "LA_LIGA", "SERIE_A", "BUNDESLIGA", "LIGUE_1"}

    epl = parse_football_data_csv(csv_for("E0", "ENG"), competition=get_competition("EPL"))
    laliga = parse_football_data_csv(csv_for("SP1", "ESP"), competition=get_competition("LA_LIGA"))
    assert len(epl) == 8 and len(laliga) == 8
    first = epl[0]
    assert first.competition_id == "EPL"
    assert first.date == "2025-08-01"
    assert first.result == "H"
    assert first.closing_home_odds == 1.8
    assert first.closing_over25_odds == 1.95
    assert first.market_semantics == "SOURCE_CLOSING_COLUMNS"
    assert first.source_row_verified is True
    assert first.qualification_scope == "RESEARCH_BACKFILL_ONLY"
    assert first.strict_gate1_eligible is False
    assert first.bookmaker_odds_used_as_model_input is False
    assert len(first.source_row_sha256) == 64
    assert sum(1 for row in [*epl, *laliga] if row.strict_gate1_eligible) == 0

    features = build_gate2_features_by_competition([*epl, *laliga])
    assert set(features) == {"EPL", "LA_LIGA"}
    assert len(features["EPL"]) == 8 and len(features["LA_LIGA"]) == 8
    # Each competition warms only from its own history. No cross-league history is shared.
    assert features["EPL"][0]["home_prior_n"] == 0
    assert features["LA_LIGA"][0]["home_prior_n"] == 0
    assert any(row["warmup_pass"] for row in features["EPL"][4:])
    # O2.5 may be retained as observed research metadata, but no O3.5/U3.5 pair is invented.
    assert all(row["market_u35_prob"] is None for row in features["EPL"])

    wrong = csv_for("SP1", "ESP")
    expect_error(lambda: parse_football_data_csv(wrong, competition=get_competition("EPL")), "COMPETITION_CODE_MISMATCH")
    expect_error(lambda: parse_football_data_csv("Date,HomeTeam\n", competition=get_competition("EPL")), "REQUIRED_COLUMNS_MISSING")

    print("GLOBAL_MULTILEAGUE_ADAPTER=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
