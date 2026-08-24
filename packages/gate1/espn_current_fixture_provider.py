from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Optional


VERSION = "ESPN_CURRENT_FIXTURE_DISCOVERY_V0_1"
BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer"


@dataclass(frozen=True)
class ESPNCompetitionSource:
    competition_id: str
    league_slug: str
    season: str = "2026/27"
    source_class: str = "PUBLIC_UNOFFICIAL_SCOREBOARD"


SOURCES = (
    ESPNCompetitionSource("EPL", "eng.1"),
    ESPNCompetitionSource("LA_LIGA", "esp.1"),
    ESPNCompetitionSource("SERIE_A", "ita.1"),
    ESPNCompetitionSource("BUNDESLIGA", "ger.1"),
    ESPNCompetitionSource("LIGUE_1", "fra.1"),
)

BY_COMPETITION = {row.competition_id: row for row in SOURCES}


@dataclass(frozen=True)
class ESPNCurrentFixture:
    fixture_id: str
    provider_fixture_id: str
    competition_id: str
    season: str
    kickoff_utc: str
    date: str
    home_team_id: str
    home: str
    away_team_id: str
    away: str
    state: str
    home_goals: Optional[int]
    away_goals: Optional[int]
    result: Optional[str]
    observed_at: str
    source: str
    source_class: str
    source_url: str
    source_event_sha256: str
    discovery_only: bool
    strict_gate1_eligible: bool
    live_in_play_supported: bool
    bookmaker_data_used: bool
    provider_prediction_used: bool


@dataclass(frozen=True)
class ESPNParseResult:
    rows: tuple[ESPNCurrentFixture, ...]
    live_events_skipped_n: int


def source_by_competition(competition_id: str) -> ESPNCompetitionSource:
    try:
        return BY_COMPETITION[competition_id]
    except KeyError as exc:
        raise ValueError(f"ESPN_CURRENT_COMPETITION_UNKNOWN_{competition_id}") from exc


def source_url(source: ESPNCompetitionSource, date_yyyymmdd: str) -> str:
    if len(date_yyyymmdd) != 8 or not date_yyyymmdd.isdigit():
        raise ValueError("ESPN_CURRENT_DATE_QUERY_INVALID")
    return f"{BASE_URL}/{source.league_slug}/scoreboard?dates={date_yyyymmdd}&limit=100"


def _timestamp(value: object, name: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{name}_INVALID") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{name}_TIMEZONE_REQUIRED")
    return parsed.astimezone(timezone.utc)


def _score(value: object) -> Optional[int]:
    if isinstance(value, dict):
        value = value.get("value", value.get("displayValue"))
    if value is None or str(value).strip() == "":
        return None
    try:
        score = int(float(str(value)))
    except ValueError:
        return None
    return score if score >= 0 else None


def _competitor(competition: dict[str, Any], home_away: str) -> dict[str, Any]:
    matches = [row for row in competition.get("competitors", []) if row.get("homeAway") == home_away]
    if len(matches) != 1:
        raise ValueError(f"ESPN_CURRENT_{home_away.upper()}_COMPETITOR_REQUIRED")
    row = matches[0]
    team = row.get("team") or {}
    team_id = str(row.get("id") or team.get("id") or "").strip()
    name = str(team.get("displayName") or team.get("name") or row.get("displayName") or "").strip()
    if not team_id or not name:
        raise ValueError(f"ESPN_CURRENT_{home_away.upper()}_TEAM_IDENTITY_REQUIRED")
    return {"id": team_id, "name": name, "score": _score(row.get("score"))}


def parse_scoreboard(payload: dict[str, Any], *, source: ESPNCompetitionSource, observed_at: str, request_url: str) -> ESPNParseResult:
    if not isinstance(payload, dict):
        raise ValueError("ESPN_CURRENT_PAYLOAD_OBJECT_REQUIRED")
    observed = _timestamp(observed_at, "ESPN_CURRENT_OBSERVED_AT")
    events = payload.get("events")
    if not isinstance(events, list):
        raise ValueError("ESPN_CURRENT_EVENTS_ARRAY_REQUIRED")

    rows: list[ESPNCurrentFixture] = []
    seen: set[str] = set()
    live_skipped = 0
    for event in events:
        if not isinstance(event, dict):
            raise ValueError("ESPN_CURRENT_EVENT_OBJECT_REQUIRED")
        event_id = str(event.get("id") or "").strip()
        if not event_id:
            raise ValueError("ESPN_CURRENT_EVENT_ID_REQUIRED")
        if event_id in seen:
            raise ValueError(f"ESPN_CURRENT_EVENT_DUPLICATE_{event_id}")
        seen.add(event_id)

        status_type = ((event.get("status") or {}).get("type") or {})
        state_raw = str(status_type.get("state") or "").strip().lower()
        completed = status_type.get("completed") is True
        if state_raw == "in":
            live_skipped += 1
            continue
        if state_raw == "pre" and not completed:
            state = "SCHEDULED"
        elif state_raw == "post" or completed:
            state = "SETTLED"
        else:
            raise ValueError(f"ESPN_CURRENT_STATUS_UNSUPPORTED_{state_raw or 'EMPTY'}")

        competitions = event.get("competitions")
        if not isinstance(competitions, list) or len(competitions) != 1 or not isinstance(competitions[0], dict):
            raise ValueError("ESPN_CURRENT_SINGLE_COMPETITION_REQUIRED")
        competition = competitions[0]
        home = _competitor(competition, "home")
        away = _competitor(competition, "away")
        if home["id"] == away["id"]:
            raise ValueError("ESPN_CURRENT_TEAM_ID_COLLISION")

        kickoff = _timestamp(event.get("date") or competition.get("date"), "ESPN_CURRENT_KICKOFF")
        hg, ag = home["score"], away["score"]
        if state == "SCHEDULED":
            hg, ag, result = None, None, None
        else:
            if hg is None or ag is None:
                raise ValueError("ESPN_CURRENT_SETTLED_SCORE_REQUIRED")
            result = "H" if hg > ag else "A" if ag > hg else "D"

        event_sha = hashlib.sha256(json.dumps(event, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        rows.append(ESPNCurrentFixture(
            fixture_id=f"{source.competition_id}-ESPN-{event_id}",
            provider_fixture_id=event_id,
            competition_id=source.competition_id,
            season=source.season,
            kickoff_utc=kickoff.isoformat().replace("+00:00", "Z"),
            date=kickoff.date().isoformat(),
            home_team_id=home["id"],
            home=home["name"],
            away_team_id=away["id"],
            away=away["name"],
            state=state,
            home_goals=hg,
            away_goals=ag,
            result=result,
            observed_at=observed.isoformat().replace("+00:00", "Z"),
            source="ESPN_SITE_SCOREBOARD",
            source_class=source.source_class,
            source_url=request_url,
            source_event_sha256=event_sha,
            discovery_only=True,
            strict_gate1_eligible=False,
            live_in_play_supported=False,
            bookmaker_data_used=False,
            provider_prediction_used=False,
        ))
    return ESPNParseResult(rows=tuple(rows), live_events_skipped_n=live_skipped)


def snapshot_to_dict(row: ESPNCurrentFixture) -> dict[str, Any]:
    return asdict(row)


def source_manifest() -> dict[str, Any]:
    return {
        "version": VERSION,
        "sources": [asdict(row) for row in SOURCES],
        "governance": {
            "discovery_only": True,
            "strict_gate1_eligible": False,
            "public_unofficial_source": True,
            "live_events_skipped_to_dedicated_live_pipeline": True,
            "provider_prediction_used": False,
            "bookmaker_data_used": False,
            "capital_effect": "NONE",
        },
    }
