from __future__ import annotations

import hashlib
import json
import re
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Iterable, List, Optional, Sequence


VERSION = "API_FOOTBALL_LIVE_PROVIDER_V0_1"
EVENT_OBSERVATION_VERSION = "API_FOOTBALL_GAME_EVENT_OBSERVATION_V0_1"
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


@dataclass(frozen=True)
class ApiFootballGameEventObservation:
    observation_version: str
    event_observation_id: str
    fixture_id: str
    provider_fixture_id: int
    competition_id: str
    provider_event_index: int
    elapsed_minute: Optional[int]
    extra_minute: Optional[int]
    provider_team_id: Optional[int]
    provider_team_name: Optional[str]
    side: str
    event_type: str
    event_detail: str
    raw_type: str
    raw_detail: str
    player_id: Optional[int]
    player_name: Optional[str]
    assist_player_id: Optional[int]
    assist_player_name: Optional[str]
    comments: Optional[str]
    goal_effect: str
    card_effect: str
    observed_at: str
    provider: str
    source_url: str
    source_fixture_sha256: str
    source_event_sha256: str
    provider_observation_verified: bool
    timeline_eligible: bool
    reasons: tuple[str, ...]
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


def _canonical_token(value: object) -> str:
    token = re.sub(r"[^A-Za-z0-9]+", "_", str(value or "").strip()).strip("_").upper()
    return token or "UNKNOWN"


def _canonical_event_type(value: object) -> str:
    token = _canonical_token(value)
    if token == "GOAL":
        return "GOAL"
    if token == "CARD":
        return "CARD"
    if token in {"SUBST", "SUBSTITUTION"}:
        return "SUBSTITUTION"
    if token == "VAR":
        return "VAR"
    return "OTHER"


def _goal_effect(event_type: str, detail: str) -> str:
    if event_type != "GOAL":
        return "NOT_APPLICABLE"
    if detail in {"NORMAL_GOAL", "OWN_GOAL", "PENALTY"}:
        return "SCORE"
    if detail == "MISSED_PENALTY":
        return "NO_SCORE"
    return "UNKNOWN"


def _card_effect(event_type: str, detail: str) -> str:
    if event_type != "CARD":
        return "NOT_APPLICABLE"
    if detail in {"RED_CARD", "YELLOW_RED_CARD"}:
        return "DISMISSAL"
    if detail == "YELLOW_CARD":
        return "CAUTION"
    return "UNKNOWN"


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


def parse_fixture_events(item: dict, *, snapshot: LiveFixtureSnapshot) -> List[ApiFootballGameEventObservation]:
    events = item.get("events")
    if events is None:
        return []
    if not isinstance(events, list):
        raise ValueError("API_FOOTBALL_EVENTS_ARRAY_REQUIRED")

    rows: List[ApiFootballGameEventObservation] = []
    for index, raw_event in enumerate(events):
        if not isinstance(raw_event, dict):
            raise ValueError("API_FOOTBALL_EVENT_OBJECT_REQUIRED")
        time = raw_event.get("time") or {}
        team = raw_event.get("team") or {}
        player = raw_event.get("player") or {}
        assist = raw_event.get("assist") or {}

        elapsed = _integer(time.get("elapsed"))
        extra = _integer(time.get("extra"))
        team_id = _integer(team.get("id"))
        team_name = str(team.get("name") or "").strip() or None
        player_id = _integer(player.get("id"))
        player_name = str(player.get("name") or "").strip() or None
        assist_id = _integer(assist.get("id"))
        assist_name = str(assist.get("name") or "").strip() or None
        comments = str(raw_event.get("comments") or "").strip() or None
        raw_type = str(raw_event.get("type") or "").strip()
        raw_detail = str(raw_event.get("detail") or "").strip()
        event_type = _canonical_event_type(raw_type)
        event_detail = _canonical_token(raw_detail)

        reasons: List[str] = []
        if team_id == snapshot.home_team_id:
            side = "HOME"
        elif team_id == snapshot.away_team_id:
            side = "AWAY"
        elif team_id is None:
            side = "UNKNOWN"
            reasons.append("EVENT_TEAM_ID_MISSING")
        else:
            side = "UNKNOWN"
            reasons.append("EVENT_TEAM_ID_MISMATCH")

        if elapsed is None:
            reasons.append("EVENT_ELAPSED_MISSING")
        elif not (0 <= elapsed <= 130):
            reasons.append("EVENT_ELAPSED_OUT_OF_RANGE")
        if extra is not None and not (0 <= extra <= 30):
            reasons.append("EVENT_EXTRA_MINUTE_OUT_OF_RANGE")
        if event_type == "OTHER":
            reasons.append("EVENT_TYPE_UNMAPPED")

        goal_effect = _goal_effect(event_type, event_detail)
        card_effect = _card_effect(event_type, event_detail)
        if goal_effect == "UNKNOWN":
            reasons.append("GOAL_EFFECT_UNKNOWN")

        raw = json.dumps(raw_event, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        event_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        timeline_eligible = not any(
            reason in {
                "EVENT_TEAM_ID_MISSING",
                "EVENT_TEAM_ID_MISMATCH",
                "EVENT_ELAPSED_MISSING",
                "EVENT_ELAPSED_OUT_OF_RANGE",
                "EVENT_EXTRA_MINUTE_OUT_OF_RANGE",
                "EVENT_TYPE_UNMAPPED",
                "GOAL_EFFECT_UNKNOWN",
            }
            for reason in reasons
        )
        rows.append(
            ApiFootballGameEventObservation(
                observation_version=EVENT_OBSERVATION_VERSION,
                event_observation_id=f"API_FOOTBALL-EVENT-{snapshot.provider_fixture_id}-{index}-{event_hash[:16]}",
                fixture_id=snapshot.fixture_id,
                provider_fixture_id=snapshot.provider_fixture_id,
                competition_id=snapshot.competition_id,
                provider_event_index=index,
                elapsed_minute=elapsed,
                extra_minute=extra,
                provider_team_id=team_id,
                provider_team_name=team_name,
                side=side,
                event_type=event_type,
                event_detail=event_detail,
                raw_type=raw_type,
                raw_detail=raw_detail,
                player_id=player_id,
                player_name=player_name,
                assist_player_id=assist_id,
                assist_player_name=assist_name,
                comments=comments,
                goal_effect=goal_effect,
                card_effect=card_effect,
                observed_at=snapshot.observed_at,
                provider="API_FOOTBALL",
                source_url=snapshot.source_url,
                source_fixture_sha256=snapshot.source_fixture_sha256,
                source_event_sha256=event_hash,
                provider_observation_verified=True,
                timeline_eligible=timeline_eligible,
                reasons=tuple(sorted(set(reasons))),
                bookmaker_data_used=False,
                provider_prediction_used=False,
            )
        )
    return rows


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


def parse_response_with_events(
    payload: dict,
    *,
    observed_at: str,
    source_url: str = BASE_URL,
) -> tuple[List[LiveFixtureSnapshot], List[ApiFootballGameEventObservation]]:
    snapshots = parse_response(payload, observed_at=observed_at, source_url=source_url)
    response = payload.get("response") or []
    by_fixture = {row.provider_fixture_id: row for row in snapshots}
    events: List[ApiFootballGameEventObservation] = []
    for item in response:
        fixture = item.get("fixture") or {}
        provider_fixture_id = _integer(fixture.get("id"), allow_none=False)
        snapshot = by_fixture[provider_fixture_id]
        events.extend(parse_fixture_events(item, snapshot=snapshot))
    event_ids = [row.event_observation_id for row in events]
    if len(event_ids) != len(set(event_ids)):
        raise ValueError("API_FOOTBALL_DUPLICATE_EVENT_OBSERVATION_ID")
    return snapshots, events


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


def _fetch_payload(*, api_key: str, competition_ids: Iterable[str], timeout: int = 20) -> tuple[dict, str, str]:
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
    return json.loads(body), observed_at, url


def fetch_live(*, api_key: str, competition_ids: Iterable[str], timeout: int = 20) -> tuple[List[LiveFixtureSnapshot], str]:
    payload, observed_at, url = _fetch_payload(api_key=api_key, competition_ids=competition_ids, timeout=timeout)
    return parse_response(payload, observed_at=observed_at, source_url=url), observed_at


def fetch_live_with_events(
    *,
    api_key: str,
    competition_ids: Iterable[str],
    timeout: int = 20,
) -> tuple[List[LiveFixtureSnapshot], List[ApiFootballGameEventObservation], str]:
    payload, observed_at, url = _fetch_payload(api_key=api_key, competition_ids=competition_ids, timeout=timeout)
    snapshots, events = parse_response_with_events(payload, observed_at=observed_at, source_url=url)
    return snapshots, events, observed_at


def snapshot_to_dict(snapshot: LiveFixtureSnapshot) -> dict:
    return asdict(snapshot)


def event_to_dict(event: ApiFootballGameEventObservation) -> dict:
    row = asdict(event)
    row["reasons"] = list(event.reasons)
    return row


def provider_manifest() -> dict:
    return {
        "version": VERSION,
        "event_observation_version": EVENT_OBSERVATION_VERSION,
        "provider": "API_FOOTBALL",
        "base_url": BASE_URL,
        "competitions": [asdict(row) for row in COMPETITIONS],
        "governance": {
            "documented_provider_api_only": True,
            "api_key_from_environment_only": True,
            "live_score_and_time_are_truth_inputs": True,
            "game_events_retained_from_same_authenticated_fixture_response": True,
            "unmapped_events_retained_not_dropped": True,
            "event_effects_do_not_silently_change_model_rates": True,
            "bookmaker_data_used": False,
            "provider_prediction_used": False,
            "silent_rate_multiplier_derivation": False,
            "real_money": "NO",
        },
    }
