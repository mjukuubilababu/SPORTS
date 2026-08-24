from __future__ import annotations

import csv
import hashlib
import io
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Iterable, List, Optional


VERSION = "CURRENT_MULTILEAGUE_FIXTURES_RESULTS_V0_1"


@dataclass(frozen=True)
class CurrentCompetitionSource:
    competition_id: str
    country: str
    division_code: str
    season: str
    source_url: str


SOURCES = (
    CurrentCompetitionSource("EPL", "ENG", "E0", "2026/27", "https://www.football-data.co.uk/mmz4281/2627/E0.csv"),
    CurrentCompetitionSource("LA_LIGA", "ESP", "SP1", "2026/27", "https://www.football-data.co.uk/mmz4281/2627/SP1.csv"),
    CurrentCompetitionSource("SERIE_A", "ITA", "I1", "2026/27", "https://www.football-data.co.uk/mmz4281/2627/I1.csv"),
    CurrentCompetitionSource("BUNDESLIGA", "DEU", "D1", "2026/27", "https://www.football-data.co.uk/mmz4281/2627/D1.csv"),
    CurrentCompetitionSource("LIGUE_1", "FRA", "F1", "2026/27", "https://www.football-data.co.uk/mmz4281/2627/F1.csv"),
)


@dataclass(frozen=True)
class FixtureSnapshot:
    fixture_id: str
    competition_id: str
    season: str
    source_division_code: str
    date: str
    time: Optional[str]
    home: str
    away: str
    state: str
    home_goals: Optional[int]
    away_goals: Optional[int]
    result: Optional[str]
    observed_at: str
    source: str
    source_url: str
    source_row_sha256: str
    live_in_play_supported: bool
    bookmaker_data_used: bool


def _clean(value: object) -> str:
    return str(value or "").strip()


def _parse_date(value: str) -> str:
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(_clean(value), fmt).date().isoformat()
        except ValueError:
            pass
    raise ValueError(f"UNSUPPORTED_FIXTURE_DATE_{value}")


def _int(value: object) -> Optional[int]:
    value = _clean(value)
    if not value:
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def _fixture_id(source: CurrentCompetitionSource, date: str, home: str, away: str) -> str:
    raw = f"{source.competition_id}|{source.season}|{date}|{home}|{away}"
    return f"{source.competition_id}-{hashlib.sha256(raw.encode()).hexdigest()[:16]}"


def parse_current_snapshot(text: str, *, source: CurrentCompetitionSource, observed_at: str) -> List[FixtureSnapshot]:
    if not text or not text.strip():
        raise ValueError("CURRENT_FIXTURE_CSV_EMPTY")
    try:
        observed = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("OBSERVED_AT_INVALID") from exc
    if observed.tzinfo is None:
        raise ValueError("OBSERVED_AT_TIMEZONE_REQUIRED")

    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    if not reader.fieldnames:
        raise ValueError("CURRENT_FIXTURE_HEADERS_MISSING")
    required = {"Date", "HomeTeam", "AwayTeam"}
    if not required.issubset(set(reader.fieldnames)):
        raise ValueError("CURRENT_FIXTURE_REQUIRED_COLUMNS_MISSING")

    rows: List[FixtureSnapshot] = []
    seen = set()
    for raw in reader:
        home = _clean(raw.get("HomeTeam"))
        away = _clean(raw.get("AwayTeam"))
        date_raw = _clean(raw.get("Date"))
        if not home or not away or not date_raw:
            continue
        div = _clean(raw.get("Div")) or source.division_code
        if div != source.division_code:
            raise ValueError(f"CURRENT_FIXTURE_DIVISION_MISMATCH_{div}_{source.division_code}")
        date = _parse_date(date_raw)
        fixture_id = _fixture_id(source, date, home, away)
        if fixture_id in seen:
            raise ValueError(f"CURRENT_FIXTURE_DUPLICATE_{fixture_id}")
        seen.add(fixture_id)
        hg, ag = _int(raw.get("FTHG")), _int(raw.get("FTAG"))
        if (hg is None) != (ag is None):
            raise ValueError(f"CURRENT_FIXTURE_PARTIAL_FINAL_SCORE_{fixture_id}")
        if hg is None:
            state, result = "SCHEDULED", None
        else:
            state = "SETTLED"
            result = "H" if hg > ag else "A" if ag > hg else "D"
        source_row = "|".join(_clean(raw.get(k)) for k in reader.fieldnames)
        rows.append(FixtureSnapshot(
            fixture_id=fixture_id,
            competition_id=source.competition_id,
            season=source.season,
            source_division_code=div,
            date=date,
            time=_clean(raw.get("Time")) or None,
            home=home,
            away=away,
            state=state,
            home_goals=hg,
            away_goals=ag,
            result=result,
            observed_at=observed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            source="Football-Data.co.uk",
            source_url=source.source_url,
            source_row_sha256=hashlib.sha256(source_row.encode()).hexdigest(),
            live_in_play_supported=False,
            bookmaker_data_used=False,
        ))
    if not rows:
        raise ValueError("CURRENT_FIXTURE_NO_ROWS")
    return rows


def source_manifest() -> dict:
    return {
        "version": VERSION,
        "sources": [asdict(row) for row in SOURCES],
        "semantics": {
            "scheduled_supported": True,
            "settled_supported": True,
            "live_in_play_supported": False,
            "current_snapshot_is_not_live_score_feed": True,
            "bookmaker_data_used": False,
        },
    }


def source_by_competition(competition_id: str) -> CurrentCompetitionSource:
    for row in SOURCES:
        if row.competition_id == competition_id:
            return row
    raise ValueError(f"CURRENT_COMPETITION_UNKNOWN_{competition_id}")


def snapshot_to_dict(row: FixtureSnapshot) -> dict:
    return asdict(row)
