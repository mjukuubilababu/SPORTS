from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

from gate1_engine import normalize_team
from historical_truth_importer import HistoricalTruthInput


RECONCILER_VERSION = "FOOTIQO_FIXTUREDOWNLOAD_RESULT_MARKET_RECONCILER_V0_1"
VERIFICATION_METHOD = "CROSS_SOURCE_FOOTIQO_FIXTUREDOWNLOAD_TEAM_SCORE_DATE_V0_1"
DATE_TOLERANCE_DAYS = 1
FOOTIQO_URL = "https://footiqo.com/database/leagues/usa-mls/"
FIXTUREDOWNLOAD_URL = "https://fixturedownload.com/results/mls-2026"

FOOTIQO_ALIASES = {
    "St. Louis City": "St Louis City",
    "Charlotte": "Charlotte FC",
    "Atlanta Utd": "Atlanta United FC",
    "Vancouver Whitecaps": "Vancouver Whitecaps",
    "Minnesota United": "Minnesota United FC",
    "Houston Dynamo": "Houston Dynamo",
    "Chicago Fire": "Chicago Fire",
    "Los Angeles FC": "Los Angeles FC",
    "Inter Miami": "Inter Miami",
    "CF Montreal": "CF Montreal",
    "Los Angeles Galaxy": "Los Angeles Galaxy",
    "New York City": "New York City FC",
    "Seattle Sounders": "Seattle Sounders",
}

FIXTURE_ALIASES = {
    "St. Louis CITY SC": "St Louis City",
    "Charlotte FC": "Charlotte FC",
    "Atlanta United": "Atlanta United FC",
    "D.C. United": "DC United",
    "Red Bull New York": "New York Red Bulls",
    "Vancouver Whitecaps FC": "Vancouver Whitecaps",
    "Minnesota United FC": "Minnesota United FC",
    "Houston Dynamo FC": "Houston Dynamo",
    "Chicago Fire FC": "Chicago Fire",
    "Los Angeles Football Club": "Los Angeles FC",
    "Inter Miami CF": "Inter Miami",
    "CF Montréal": "CF Montreal",
    "LA Galaxy": "Los Angeles Galaxy",
    "New York City Football Club": "New York City FC",
    "Seattle Sounders FC": "Seattle Sounders",
}

HOME_TIMEZONES = {
    "st louis city": "America/Chicago",
    "fc cincinnati": "America/New_York",
    "dc united": "America/New_York",
    "orlando city": "America/New_York",
    "vancouver whitecaps": "America/Vancouver",
    "austin fc": "America/Chicago",
    "fc dallas": "America/Chicago",
    "houston dynamo": "America/Chicago",
    "nashville sc": "America/Chicago",
    "los angeles fc": "America/Los_Angeles",
    "portland timbers": "America/Los_Angeles",
    "san diego fc": "America/Los_Angeles",
    "san jose earthquakes": "America/Los_Angeles",
    "los angeles galaxy": "America/Los_Angeles",
    "seattle sounders": "America/Los_Angeles",
    "chicago fire": "America/Chicago",
    "new york red bulls": "America/New_York",
    "colorado rapids": "America/Denver",
    "minnesota united fc": "America/Chicago",
    "real salt lake": "America/Denver",
    "sporting kansas city": "America/Chicago",
}


@dataclass(frozen=True)
class FixtureResult:
    source_row_id: str
    source_datetime_utc: str
    source_date_utc: str
    home_team: str
    away_team: str
    home_goals: int
    away_goals: int

    @property
    def pair(self) -> Tuple[str, str]:
        return (self.home_team, self.away_team)

    @property
    def score(self) -> Tuple[int, int]:
        return (self.home_goals, self.away_goals)


@dataclass(frozen=True)
class FootiqoClosing:
    footiqo_id: str
    source_match_datetime: str
    source_date: str
    home_team: str
    away_team: str
    home_goals: int
    away_goals: int
    o25: float
    u25: float
    o35: float
    u35: float
    market_source: str
    market_provider: str
    market_source_url: str
    quote_type: str

    @property
    def pair(self) -> Tuple[str, str]:
        return (self.home_team, self.away_team)

    @property
    def score(self) -> Tuple[int, int]:
        return (self.home_goals, self.away_goals)


def _team(value: str, aliases: Dict[str, str]) -> str:
    return normalize_team(aliases.get(value.strip(), value.strip()))


def _score(value: str) -> Optional[Tuple[int, int]]:
    match = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*", value or "")
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def parse_fixture_download_csv(text: str) -> List[FixtureResult]:
    rows: List[FixtureResult] = []
    for index, raw in enumerate(csv.DictReader(io.StringIO(text)), start=1):
        score = _score(raw.get("Result", ""))
        if score is None:
            continue
        dt = datetime.strptime(raw["Date"], "%d/%m/%Y %H:%M").replace(tzinfo=timezone.utc)
        rows.append(FixtureResult(
            source_row_id=str(raw.get("Match Number") or index),
            source_datetime_utc=dt.isoformat(),
            source_date_utc=dt.date().isoformat(),
            home_team=_team(raw["Home Team"], FIXTURE_ALIASES),
            away_team=_team(raw["Away Team"], FIXTURE_ALIASES),
            home_goals=score[0],
            away_goals=score[1],
        ))
    return rows


def parse_footiqo_snapshot(text: str) -> List[FootiqoClosing]:
    rows: List[FootiqoClosing] = []
    for raw in csv.DictReader(io.StringIO(text)):
        source_dt = datetime.strptime(raw["source_match_datetime"], "%d-%m-%y %H:%M")
        rows.append(FootiqoClosing(
            footiqo_id=raw["footiqo_id"],
            source_match_datetime=raw["source_match_datetime"],
            source_date=source_dt.date().isoformat(),
            home_team=_team(raw["home_team"], FOOTIQO_ALIASES),
            away_team=_team(raw["away_team"], FOOTIQO_ALIASES),
            home_goals=int(raw["home_goals"]),
            away_goals=int(raw["away_goals"]),
            o25=float(raw["o25"]),
            u25=float(raw["u25"]),
            o35=float(raw["o35"]),
            u35=float(raw["u35"]),
            market_source=raw["market_source"],
            market_provider=raw["market_provider"],
            market_source_url=raw["market_source_url"],
            quote_type=raw["quote_type"],
        ))
    return rows


def venue_local_date(fixture: FixtureResult) -> str:
    zone_name = HOME_TIMEZONES.get(fixture.home_team)
    if not zone_name:
        raise ValueError(f"HOME_TIMEZONE_NOT_REGISTERED:{fixture.home_team}")
    dt = datetime.fromisoformat(fixture.source_datetime_utc)
    return dt.astimezone(ZoneInfo(zone_name)).date().isoformat()


def _date_distance_days(a: str, b: str) -> int:
    return abs((datetime.fromisoformat(a).date() - datetime.fromisoformat(b).date()).days)


def reconcile_footiqo_with_fixtures(
    footiqo_rows: Iterable[FootiqoClosing],
    fixture_rows: Iterable[FixtureResult],
) -> Dict:
    footiqo = list(footiqo_rows)
    fixtures = list(fixture_rows)
    fixture_by_pair: Dict[Tuple[str, str], List[FixtureResult]] = {}
    for row in fixtures:
        fixture_by_pair.setdefault(row.pair, []).append(row)

    verified: List[HistoricalTruthInput] = []
    audit_rows: List[Dict] = []
    quarantine: List[Dict] = []
    consumed = set()

    for market in footiqo:
        candidates = [
            row for row in fixture_by_pair.get(market.pair, [])
            if _date_distance_days(market.source_date, row.source_date_utc) <= DATE_TOLERANCE_DAYS
        ]
        if not candidates:
            quarantine.append({
                "footiqo_id": market.footiqo_id,
                "reason": "NO_FIXTUREDOWNLOAD_MATCH",
                "pair": market.pair,
                "source_date": market.source_date,
            })
            continue

        candidates.sort(key=lambda row: (
            _date_distance_days(market.source_date, row.source_date_utc),
            row.source_datetime_utc,
            row.source_row_id,
        ))
        score_matches = [row for row in candidates if row.score == market.score]
        if not score_matches:
            quarantine.append({
                "footiqo_id": market.footiqo_id,
                "reason": "CROSS_SOURCE_SCORE_DISAGREEMENT",
                "footiqo_score": market.score,
                "fixture_candidates": [row.__dict__ for row in candidates],
            })
            continue

        fixture = score_matches[0]
        fixture_key = (fixture.source_row_id, fixture.source_datetime_utc, fixture.pair)
        if fixture_key in consumed:
            quarantine.append({
                "footiqo_id": market.footiqo_id,
                "reason": "FIXTUREDOWNLOAD_MATCH_ALREADY_CONSUMED",
                "fixture": fixture.__dict__,
            })
            continue
        consumed.add(fixture_key)

        canonical_date = venue_local_date(fixture)
        verified.append(HistoricalTruthInput(
            match_date=canonical_date,
            season=2026,
            league="MLS",
            home_team=fixture.home_team,
            away_team=fixture.away_team,
            home_goals=fixture.home_goals,
            away_goals=fixture.away_goals,
            result_source="FixtureDownload",
            result_source_url=FIXTUREDOWNLOAD_URL,
            result_verified=True,
            result_source_match_date=fixture.source_date_utc,
            result_crosscheck_source="Footiqo",
            result_crosscheck_source_url=FOOTIQO_URL,
            result_crosscheck_match_date=market.source_date,
            result_verification_method=VERIFICATION_METHOD,
            o25=market.o25,
            u25=market.u25,
            o35=market.o35,
            u35=market.u35,
            market_source=market.market_source,
            market_provider=market.market_provider,
            market_source_url=market.market_source_url,
            market_source_match_date=market.source_date,
            quote_type=market.quote_type,
            market_observed_at="",
        ))
        audit_rows.append({
            "footiqo_id": market.footiqo_id,
            "fixture_row_id": fixture.source_row_id,
            "canonical_venue_local_date": canonical_date,
            "footiqo_source_date": market.source_date,
            "fixture_source_date_utc": fixture.source_date_utc,
            "home_team": fixture.home_team,
            "away_team": fixture.away_team,
            "score": {"home": fixture.home_goals, "away": fixture.away_goals},
        })

    return {
        "reconciler_version": RECONCILER_VERSION,
        "verification_method": VERIFICATION_METHOD,
        "summary": {
            "footiqo_rows_received": len(footiqo),
            "fixture_scored_rows_received": len(fixtures),
            "cross_source_verified": len(verified),
            "quarantined": len(quarantine),
        },
        "verified_rows": verified,
        "audit_rows": audit_rows,
        "quarantine": quarantine,
        "governance": {
            "market_source_independent_from_result_source": True,
            "exact_score_crosscheck_required": True,
            "same_normalized_team_pair_required": True,
            "date_tolerance_days": DATE_TOLERANCE_DAYS,
            "canonical_date_is_venue_local_from_fixture_utc": True,
            "odds_are_never_inferred_from_result": True,
        },
    }


def load_reviewed_footiqo_snapshot(path: Path) -> List[FootiqoClosing]:
    return parse_footiqo_snapshot(path.read_text(encoding="utf-8"))
