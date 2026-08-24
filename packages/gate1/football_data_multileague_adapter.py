from __future__ import annotations

import csv
import hashlib
import io
import re
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Dict, Iterable, List, Optional

from global_competition_registry import Competition, competition_for_code


ADAPTER_VERSION = "FOOTBALL_DATA_MULTILEAGUE_ADAPTER_V0_1"
QUALIFICATION_SCOPE = "RESEARCH_BACKFILL_ONLY"


def _clean(value: object) -> str:
    return str(value or "").strip()


def _float(row: Dict[str, str], *keys: str) -> Optional[float]:
    for key in keys:
        value = _clean(row.get(key))
        if not value:
            continue
        try:
            parsed = float(value)
        except ValueError:
            continue
        if parsed > 1.0:
            return parsed
    return None


def _int(row: Dict[str, str], key: str) -> Optional[int]:
    value = _clean(row.get(key))
    if value == "":
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def _date(value: str) -> str:
    value = _clean(value)
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            pass
    raise ValueError(f"UNSUPPORTED_MATCH_DATE_{value}")


def _slug(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9]+", "-", value.strip()).strip("-")
    return value[:48] or "UNKNOWN"


def _match_id(competition_id: str, season: str, date: str, home: str, away: str) -> str:
    identity = f"{competition_id}|{season}|{date}|{home}|{away}"
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:12]
    return f"{competition_id}-{season.replace('/', '')}-{date}-{_slug(home)}-{_slug(away)}-{digest}"


@dataclass(frozen=True)
class GlobalHistoricalMatch:
    match_id: str
    competition_id: str
    country: str
    season: str
    date: str
    home: str
    away: str
    home_goals: int
    away_goals: int
    result: str
    half_time_home_goals: Optional[int]
    half_time_away_goals: Optional[int]
    home_shots: Optional[int]
    away_shots: Optional[int]
    home_shots_on_target: Optional[int]
    away_shots_on_target: Optional[int]
    closing_home_odds: Optional[float]
    closing_draw_odds: Optional[float]
    closing_away_odds: Optional[float]
    closing_over25_odds: Optional[float]
    closing_under25_odds: Optional[float]
    source: str
    source_url: str
    source_class: str
    source_division_code: str
    source_row_sha256: str
    source_row_verified: bool
    market_semantics: str
    qualification_scope: str
    strict_gate1_eligible: bool
    bookmaker_odds_used_as_model_input: bool


def parse_football_data_csv(text: str, *, competition: Competition, source_url: Optional[str] = None) -> List[GlobalHistoricalMatch]:
    if not text or not text.strip():
        raise ValueError("FOOTBALL_DATA_CSV_EMPTY")
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    if not reader.fieldnames:
        raise ValueError("FOOTBALL_DATA_HEADERS_MISSING")
    required = {"Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG"}
    if not required.issubset(set(reader.fieldnames)):
        missing = sorted(required - set(reader.fieldnames))
        raise ValueError("FOOTBALL_DATA_REQUIRED_COLUMNS_MISSING:" + ",".join(missing))

    out: List[GlobalHistoricalMatch] = []
    seen = set()
    for raw in reader:
        home = _clean(raw.get("HomeTeam"))
        away = _clean(raw.get("AwayTeam"))
        if not home or not away:
            continue
        hg = _int(raw, "FTHG")
        ag = _int(raw, "FTAG")
        if hg is None or ag is None:
            continue
        date = _date(raw.get("Date", ""))
        division = _clean(raw.get("Div")) or competition.football_data_code
        if division != competition.football_data_code:
            raise ValueError(f"COMPETITION_CODE_MISMATCH_{division}_{competition.football_data_code}")
        result = "H" if hg > ag else "A" if ag > hg else "D"
        source_row = "|".join(_clean(raw.get(k)) for k in reader.fieldnames)
        source_hash = hashlib.sha256(source_row.encode("utf-8")).hexdigest()
        match_id = _match_id(competition.competition_id, competition.research_season, date, home, away)
        if match_id in seen:
            raise ValueError(f"DUPLICATE_CANONICAL_MATCH_{match_id}")
        seen.add(match_id)

        closing_1x2 = (
            _float(raw, "B365CH", "AvgCH", "MaxCH"),
            _float(raw, "B365CD", "AvgCD", "MaxCD"),
            _float(raw, "B365CA", "AvgCA", "MaxCA"),
        )
        over25 = _float(raw, "B365C>2.5", "AvgC>2.5", "MaxC>2.5")
        under25 = _float(raw, "B365C<2.5", "AvgC<2.5", "MaxC<2.5")
        has_close = any(x is not None for x in (*closing_1x2, over25, under25))
        market_semantics = "SOURCE_CLOSING_COLUMNS" if has_close else "NO_CLOSING_MARKET_CAPTURED"

        out.append(GlobalHistoricalMatch(
            match_id=match_id,
            competition_id=competition.competition_id,
            country=competition.country,
            season=competition.research_season,
            date=date,
            home=home,
            away=away,
            home_goals=hg,
            away_goals=ag,
            result=result,
            half_time_home_goals=_int(raw, "HTHG"),
            half_time_away_goals=_int(raw, "HTAG"),
            home_shots=_int(raw, "HS"),
            away_shots=_int(raw, "AS"),
            home_shots_on_target=_int(raw, "HST"),
            away_shots_on_target=_int(raw, "AST"),
            closing_home_odds=closing_1x2[0],
            closing_draw_odds=closing_1x2[1],
            closing_away_odds=closing_1x2[2],
            closing_over25_odds=over25,
            closing_under25_odds=under25,
            source=competition.source,
            source_url=source_url or competition.research_url,
            source_class=competition.source_class,
            source_division_code=division,
            source_row_sha256=source_hash,
            source_row_verified=True,
            market_semantics=market_semantics,
            qualification_scope=QUALIFICATION_SCOPE,
            strict_gate1_eligible=False,
            bookmaker_odds_used_as_model_input=False,
        ))
    if not out:
        raise ValueError("FOOTBALL_DATA_NO_SETTLED_MATCHES")
    return out


def parse_by_division_code(text: str, *, source_url: Optional[str] = None) -> List[GlobalHistoricalMatch]:
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    if not reader.fieldnames or "Div" not in reader.fieldnames:
        raise ValueError("FOOTBALL_DATA_DIV_COLUMN_REQUIRED")
    rows = list(reader)
    codes = {_clean(row.get("Div")) for row in rows if _clean(row.get("Div"))}
    if len(codes) != 1:
        raise ValueError("FOOTBALL_DATA_SINGLE_DIVISION_REQUIRED")
    competition = competition_for_code(next(iter(codes)))
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=reader.fieldnames, lineterminator="\n")
    writer.writeheader(); writer.writerows(rows)
    return parse_football_data_csv(buf.getvalue(), competition=competition, source_url=source_url)


def to_gate2_matches(records: Iterable[GlobalHistoricalMatch]):
    from pathlib import Path
    import sys
    gate2_dir = Path(__file__).resolve().parents[1] / "gate2"
    if str(gate2_dir) not in sys.path:
        sys.path.insert(0, str(gate2_dir))
    from gate2_engine import Match

    rows = []
    for record in records:
        rows.append(Match(
            date=record.date,
            season=int(record.season.split("/")[0]),
            league=record.competition_id,
            home=record.home,
            away=record.away,
            hg=record.home_goals,
            ag=record.away_goals,
            o25=record.closing_over25_odds,
            o35=None,
            u35=None,
            quote_verified=False,
            lineup_state="UNKNOWN",
            attacking_upgrade=False,
        ))
    return rows


def build_gate2_features_by_competition(records: Iterable[GlobalHistoricalMatch]) -> Dict[str, list]:
    from pathlib import Path
    import sys
    gate2_dir = Path(__file__).resolve().parents[1] / "gate2"
    if str(gate2_dir) not in sys.path:
        sys.path.insert(0, str(gate2_dir))
    from gate2_engine import build_features, feature_row_to_dict

    grouped: Dict[str, List[GlobalHistoricalMatch]] = {}
    for record in records:
        grouped.setdefault(record.competition_id, []).append(record)
    output: Dict[str, list] = {}
    for competition_id, competition_rows in sorted(grouped.items()):
        features = build_features(to_gate2_matches(competition_rows))
        output[competition_id] = [feature_row_to_dict(row) for row in features]
    return output


def record_to_dict(record: GlobalHistoricalMatch) -> dict:
    return asdict(record)
