from __future__ import annotations

import hashlib
import json
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Iterable, List, Optional, Sequence


VERSION = "API_FOOTBALL_LIVE_PROVIDER_V0_1"
BASE_URL = "https://v3.football.api-sports.io/fixtures"


@dataclass(frozen=True)
class ApiFootballCompetition:
    competition_id: str
    country: str
    name: str
    provider_league_id: int


COMPETITIONS: Sequence[ApiFootballCompetition] = (
    ApiFootballCompetition("EPL", "ENG", "Premier League", 39),
    ApiFootballCompetition("LA_LIGA", "ESP", "La Liga", 140),
    ApiFootballCompetition("SERIE_A", "ITA", "Serie A", 135),
    ApiFootballCompetition("BUNDESLIGA", "DEU", "Bundesliga", 78),
    ApiFootballCompetition("LIGUE_1", "FRA", "Ligue 1", 61),
)
BY_PROVIDER_ID = {row.provider_league_id: row for row in COMPETITIONS}
BY_COMPETITION_ID = {row.competition_id: row for row in COMPETITIONS}

LIVE_STATUS = {"1H", "HT", "2H", "ET", "BT", "P", "LIVE"}
SETTLED_STATUS = {"FT", "AET", "PEN"}
SCHEDULED_STATUS = {"NS", "TBD"}
NON_PLAYING_STATUS = {
    "PST": "POSTPONED",
    "CANC": "CANCELLED",
    "SUSP": "SUSPENDED",
    "INT": "INTERRUPTED",
    "ABD": "ABANDONED",
}


@dataclass(frozen=True)
class LiveFixtureSnapshot:
    fixture_id: str
    provider_fixture_id: int
    competition_id: str
    provider_league_id: int
    season: int
    round: Optional[str]
    kickoff_utc: str
    home_team_id: int
    home_team: str
    away_team_id: int
    away_team: str
    state: str
    status_short: str
    status_long: str
    elapsed_minute: Optional[int]
    extra_minute: Optional[int]
    home_goals: Optional[int]
    away_goals: Optional[int]
    observed_at: str
    provider: str
    source_url: str
    source_fixture_sha256: str
    live_in_play_supported: bool
    bookmaker_data_used: bool
    provider_prediction_used: bool


def _utc(value: str, *, field: str) -> str:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field}_INVALID") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field}_TIMEZONE_REQUIRED")
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _integer(value: object, *, allow_none: bool = True) -> Optional[int]:
    if value is None and allow_none:
        return None
    if isinstance(value, bool):
        raise ValueError("INTEGER_VALUE_INVALID")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        if allow_none:
            return None
        raise ValueError("INTEGER_VALUE_REQUIRED") from exc
    return parsed


def _state(status_short: str) -> str:
    code = str(status_short or "").strip().upper()
    if code in LIVE_STATUS:
        return "LIVE_IN_PLAY"
    if code in SETTLED_STATUS:
        return "SETTLED"
    if code in SCHEDULED_STATUS:
        return "SCHEDULED"
    if code in NON_PLAYING_STATUS:
        return NON_PLAYING_STATUS[code]
    raise ValueError(f"API_FOOTBALL_STATUS_UNSUPPORTED_{code or 'EMPTY'}")


def competition_by_id(competition_id: str) -> ApiFootballCompetition:
    try:
        return BY_COMPETITION_ID[competition_id]
    except KeyError as exc:
        raise ValueError(f"API_FOOTBALL_COMPETITION_UNKNOWN_{competition_id}") from exc


def build_live_url(competition_ids: Iterable[str]) -> str:
    rows = [competition_by_id(item) for item in competition_ids]
    if not rows:
        raise ValueError("API_FOOTBALL_COMPETITION_SET_EMPTY")
    league_ids = "-".join(str(row.provider_league_id) for row in rows)
    return f"{BASE_URL}?{urllib.parse.urlencode({'live': league_ids})}"


def parse_fixture(item: dict, *, observed_at: str, source_url: str = BASE_URL) -> LiveFixtureSnapshot:
    if not isinstance(item, dict):
        raise ValueError("API_FOOTBALL_FIXTURE_OBJECT_REQUIRED")
    fixture = item.get("fixture") or {}
    league = item.get("league") or {}
    teams = item.get("teams") or {}
    goals = item.get("goals") or {}
    status = fixture.get("status") or {}

    provider_fixture_id = _integer(fixture.get("id"), allow_none=False)
    provider_league_id = _integer(league.get("id"), allow_none=False)
    if provider_league_id not in BY_PROVIDER_ID:
        raise ValueError(f"API_FOOTBALL_UNREGISTERED_LEAGUE_{provider_league_id}")
    competition = BY_PROVIDER_ID[provider_league_id]

    season = _integer(league.get("season"), allow_none=False)
    home = teams.get("home") or {}
    away = teams.get("away") or {}
    home_id = _integer(home.get("id"), allow_none=False)
    away_id = _integer(away.get("id"), allow_none=False)
    home_name = str(home.get("name") or "").strip()
    away_name = str(away.get("name") or "").strip()
    if not home_name or not away_name:
        raise ValueError("API_FOOTBALL_TEAM_NAME_REQUIRED")
    if home_id == away_id:
        raise ValueError("API_FOOTBALL_TEAM_ID_COLLISION")

    observed = _utc(observed_at, field="OBSERVED_AT")
    kickoff = _utc(fixture.get("date"), field="KICKOFF")
    status_short = str(status.get("short") or "").strip().upper()
    state = _state(status_short)
    elapsed = _integer(status.get("elapsed"))
    extra = _integer(status.get("extra"))
    home_goals = _integer(goals.get("home"))
    away_goals = _integer(goals.get("away"))

    if (home_goals is None) != (away_goals is None):
        raise ValueError("API_FOOTBALL_PARTIAL_SCORE")
    if state in {"LIVE_IN_PLAY", "SETTLED"} and (home_goals is None or away_goals is None):
        raise ValueError("API_FOOTBALL_ACTIVE_SCORE_REQUIRED")
    if state == "LIVE_IN_PLAY" and elapsed is None:
        raise ValueError("API_FOOTBALL_LIVE_ELAPSED_REQUIRED")
    if elapsed is not None and not (0 <= elapsed <= 130):
        raise ValueError("API_FOOTBALL_ELAPSED_OUT_OF_RANGE")

    raw = json.dumps(item, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return LiveFixtureSnapshot(
        fixture_id=f"{competition.competition_id}-API_FOOTBALL-{provider_fixture_id}",
        provider_fixture_id=provider_fixture_id,
        competition_id=competition.competition_id,
        provider_league_id=provider_league_id,
        season=season,
        round=str(league.get("round") or "").strip() or None,
        kickoff_utc=kickoff,
        home_team_id=home_id,
        home_team=home_name,
        away_team_id=away_id,
        away_team=away_name,
        state=state,
        status_short=status_short,
        status_long=str(status.get("long") or "").strip(),
        elapsed_minute=elapsed,
        extra_minute=extra,
        home_goals=home_goals,
        away_goals=away_goals,
        observed_at=observed,
        provider="API_FOOTBALL",
        source_url=source_url,
        source_fixture_sha256=hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        live_in_play_supported=True,
        bookmaker_data_used=False,
        provider_prediction_used=False,
    )


def parse_response(payload: dict, *, observed_at: str, source_url: str = BASE_URL) -> List[LiveFixtureSnapshot]:
    if not isinstance(payload, dict):
        raise ValueError("API_FOOTBALL_RESPONSE_OBJECT_REQUIRED")
    errors = payload.get("errors")
    if errors not in (None, [], {}):
        raise ValueError("API_FOOTBALL_RESPONSE_ERRORS_PRESENT")
    response = payload.get("response")
    if not isinstance(response, list):
        raise ValueError("API_FOOTBALL_RESPONSE_ARRAY_REQUIRED")
    rows = [parse_fixture(item, observed_at=observed_at, source_url=source_url) for item in response]
    ids = [row.provider_fixture_id for row in rows]
    if len(ids) != len(set(ids)):
        raise ValueError("API_FOOTBALL_DUPLICATE_FIXTURE_ID")
    return rows


def live_model_input(snapshot: LiveFixtureSnapshot) -> dict:
    if snapshot.state != "LIVE_IN_PLAY":
        raise ValueError("LIVE_MODEL_INPUT_REQUIRES_LIVE_IN_PLAY")
    if snapshot.elapsed_minute is None or snapshot.home_goals is None or snapshot.away_goals is None:
        raise ValueError("LIVE_MODEL_INPUT_INCOMPLETE")
    return {
        "eventId": snapshot.fixture_id,
        "minute": snapshot.elapsed_minute,
        "homeScore": snapshot.home_goals,
        "awayScore": snapshot.away_goals,
        "observedAt": snapshot.observed_at,
        "evidence": [
            {
                "type": "LIVE_SCORE_TIME_PROVIDER_SNAPSHOT",
                "provider": snapshot.provider,
                "providerFixtureId": snapshot.provider_fixture_id,
                "status": snapshot.status_short,
                "sourceFixtureSha256": snapshot.source_fixture_sha256,
                "verified": True,
            }
        ],
        "rateMultiplierPolicy": "UNCHANGED_UNLESS_SEPARATE_VERIFIED_EVENT_IMPACT_MODEL_SUPPLIES_MULTIPLIERS",
    }


def fetch_live(*, api_key: str, competition_ids: Iterable[str], timeout: int = 20) -> tuple[List[LiveFixtureSnapshot], str]:
    key = str(api_key or "").strip()
    if not key:
        raise ValueError("APISPORTS_KEY_REQUIRED")
    url = build_live_url(competition_ids)
    request = urllib.request.Request(
        url,
        headers={
            "x-apisports-key": key,
            "Accept": "application/json",
            "User-Agent": "SPORTS-Decision-Intelligence/0.1",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8")
    observed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    payload = json.loads(body)
    return parse_response(payload, observed_at=observed_at, source_url=url), observed_at


def snapshot_to_dict(snapshot: LiveFixtureSnapshot) -> dict:
    return asdict(snapshot)


def provider_manifest() -> dict:
    return {
        "version": VERSION,
        "provider": "API_FOOTBALL",
        "base_url": BASE_URL,
        "competitions": [asdict(row) for row in COMPETITIONS],
        "governance": {
            "documented_provider_api_only": True,
            "api_key_from_environment_only": True,
            "live_score_and_time_are_truth_inputs": True,
            "bookmaker_data_used": False,
            "provider_prediction_used": False,
            "silent_rate_multiplier_derivation": False,
            "real_money": "NO",
        },
    }
