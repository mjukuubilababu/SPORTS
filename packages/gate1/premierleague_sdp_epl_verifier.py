from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Optional


VERSION = "PREMIERLEAGUE_SDP_EPL_VERIFIER_V0_1"
BASE_URL = "https://sdp-prem-prod.premier-league-prod.pulselive.com"
MATCHES_PATH = "/api/v2/matches"
SOURCE_CLASS = "OFFICIAL_WEBSITE_BACKEND_UNDOCUMENTED_NO_SLA"
COMPETITION_ID = "EPL"
OFFICIAL_COMPETITION_ID = "8"
OFFICIAL_SEASON_ID = "2026"
SEASON = "2026/27"

# Explicit aliases only. No fuzzy or token-similarity matching is allowed.
ESPN_TEAM_ALIASES = {
    "Arsenal": "ARSENAL",
    "Aston Villa": "ASTON_VILLA",
    "AFC Bournemouth": "BOURNEMOUTH",
    "Bournemouth": "BOURNEMOUTH",
    "Brentford": "BRENTFORD",
    "Brighton & Hove Albion": "BRIGHTON",
    "Brighton": "BRIGHTON",
    "Chelsea": "CHELSEA",
    "Coventry City": "COVENTRY_CITY",
    "Coventry": "COVENTRY_CITY",
    "Crystal Palace": "CRYSTAL_PALACE",
    "Everton": "EVERTON",
    "Fulham": "FULHAM",
    "Hull City": "HULL_CITY",
    "Hull": "HULL_CITY",
    "Ipswich Town": "IPSWICH_TOWN",
    "Ipswich": "IPSWICH_TOWN",
    "Leeds United": "LEEDS_UNITED",
    "Leeds": "LEEDS_UNITED",
    "Liverpool": "LIVERPOOL",
    "Manchester City": "MANCHESTER_CITY",
    "Man City": "MANCHESTER_CITY",
    "Manchester United": "MANCHESTER_UNITED",
    "Man United": "MANCHESTER_UNITED",
    "Man Utd": "MANCHESTER_UNITED",
    "Newcastle United": "NEWCASTLE_UNITED",
    "Newcastle": "NEWCASTLE_UNITED",
    "Nottingham Forest": "NOTTINGHAM_FOREST",
    "Nott'm Forest": "NOTTINGHAM_FOREST",
    "Sunderland": "SUNDERLAND",
    "Tottenham Hotspur": "TOTTENHAM_HOTSPUR",
    "Tottenham": "TOTTENHAM_HOTSPUR",
    "Spurs": "TOTTENHAM_HOTSPUR",
}

SDP_TEAM_ALIASES = {
    "Arsenal": "ARSENAL",
    "Aston Villa": "ASTON_VILLA",
    "AFC Bournemouth": "BOURNEMOUTH",
    "Bournemouth": "BOURNEMOUTH",
    "Brentford": "BRENTFORD",
    "Brighton and Hove Albion": "BRIGHTON",
    "Brighton & Hove Albion": "BRIGHTON",
    "Brighton": "BRIGHTON",
    "Chelsea": "CHELSEA",
    "Coventry City": "COVENTRY_CITY",
    "Coventry": "COVENTRY_CITY",
    "Crystal Palace": "CRYSTAL_PALACE",
    "Everton": "EVERTON",
    "Fulham": "FULHAM",
    "Hull City": "HULL_CITY",
    "Hull": "HULL_CITY",
    "Ipswich Town": "IPSWICH_TOWN",
    "Ipswich": "IPSWICH_TOWN",
    "Leeds United": "LEEDS_UNITED",
    "Leeds": "LEEDS_UNITED",
    "Liverpool": "LIVERPOOL",
    "Manchester City": "MANCHESTER_CITY",
    "Man City": "MANCHESTER_CITY",
    "Manchester United": "MANCHESTER_UNITED",
    "Man Utd": "MANCHESTER_UNITED",
    "Newcastle United": "NEWCASTLE_UNITED",
    "Newcastle": "NEWCASTLE_UNITED",
    "Nottingham Forest": "NOTTINGHAM_FOREST",
    "Nott'm Forest": "NOTTINGHAM_FOREST",
    "Sunderland": "SUNDERLAND",
    "Tottenham Hotspur": "TOTTENHAM_HOTSPUR",
    "Tottenham": "TOTTENHAM_HOTSPUR",
    "Spurs": "TOTTENHAM_HOTSPUR",
}

EXPECTED_TEAM_KEYS = frozenset({
    "ARSENAL", "ASTON_VILLA", "BOURNEMOUTH", "BRENTFORD", "BRIGHTON",
    "CHELSEA", "COVENTRY_CITY", "CRYSTAL_PALACE", "EVERTON", "FULHAM",
    "HULL_CITY", "IPSWICH_TOWN", "LEEDS_UNITED", "LIVERPOOL", "MANCHESTER_CITY",
    "MANCHESTER_UNITED", "NEWCASTLE_UNITED", "NOTTINGHAM_FOREST", "SUNDERLAND",
    "TOTTENHAM_HOTSPUR",
})


@dataclass(frozen=True)
class PremierLeagueSDPFixture:
    provider_fixture_id: str
    competition_id: str
    season: str
    kickoff_utc: str
    date: str
    home_team_id: str
    home: str
    home_key: str
    away_team_id: str
    away: str
    away_key: str
    state: str
    home_goals: Optional[int]
    away_goals: Optional[int]
    result: Optional[str]
    observed_at: str
    source: str
    source_class: str
    source_url: str
    source_event_sha256: str
    verification_source_only: bool
    bookmaker_data_used: bool
    provider_prediction_used: bool


@dataclass(frozen=True)
class ReconciliationRow:
    espn_provider_fixture_id: str
    sdp_provider_fixture_id: str
    competition_id: str
    kickoff_utc: str
    home_key: str
    away_key: str
    state: str
    home_goals: Optional[int]
    away_goals: Optional[int]
    espn_source_sha256: str
    sdp_source_sha256: str
    strict_gate1_eligible: bool
    reconciliation: str


def _timestamp(value: object, name: str) -> datetime:
    if isinstance(value, dict):
        if value.get("millis") is not None:
            try:
                return datetime.fromtimestamp(float(value["millis"]) / 1000.0, tz=timezone.utc)
            except (TypeError, ValueError, OSError) as exc:
                raise ValueError(f"{name}_MILLIS_INVALID") from exc
        value = value.get("label") or value.get("iso") or value.get("date") or value.get("value")
    try:
        parsed = datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{name}_INVALID") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{name}_TIMEZONE_REQUIRED")
    return parsed.astimezone(timezone.utc)


def _team_key(name: object, aliases: dict[str, str], provider: str) -> str:
    value = str(name or "").strip()
    if not value:
        raise ValueError(f"{provider}_TEAM_NAME_REQUIRED")
    try:
        key = aliases[value]
    except KeyError as exc:
        raise ValueError(f"{provider}_TEAM_ALIAS_UNKNOWN_{value}") from exc
    if key not in EXPECTED_TEAM_KEYS:
        raise ValueError(f"{provider}_TEAM_KEY_NOT_2026_27_{key}")
    return key


def espn_team_key(name: object) -> str:
    return _team_key(name, ESPN_TEAM_ALIASES, "ESPN_EPL")


def sdp_team_key(name: object) -> str:
    return _team_key(name, SDP_TEAM_ALIASES, "PREMIERLEAGUE_SDP")


def _nonnegative_int(value: object, name: str) -> int:
    if isinstance(value, dict):
        value = value.get("value", value.get("score", value.get("displayValue")))
    if isinstance(value, bool):
        raise ValueError(f"{name}_INTEGER_REQUIRED")
    try:
        numeric = float(str(value))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name}_INTEGER_REQUIRED") from exc
    if not math.isfinite(numeric) or not numeric.is_integer():
        raise ValueError(f"{name}_INTEGER_REQUIRED")
    parsed = int(numeric)
    if parsed < 0:
        raise ValueError(f"{name}_NONNEGATIVE_REQUIRED")
    return parsed


def _id(value: object, name: str) -> str:
    parsed = str(value or "").strip()
    if not parsed:
        raise ValueError(f"{name}_REQUIRED")
    return parsed


def _period(event: dict[str, Any]) -> str:
    value = event.get("period")
    if isinstance(value, dict):
        value = value.get("label") or value.get("name") or value.get("code") or value.get("value")
    value = str(value or "").strip().lower().replace("_", "").replace("-", "").replace(" ", "")
    if value in {"prematch", "pre"}:
        return "PREMATCH"
    if value in {"fulltime", "fulltime90", "postmatch", "post", "finished"}:
        return "FULLTIME"
    if value in {"live", "firsthalf", "secondhalf", "halftime", "extratime", "penalties"}:
        return "LIVE"
    raise ValueError(f"PREMIERLEAGUE_SDP_PERIOD_UNSUPPORTED_{value or 'EMPTY'}")


def _season_id(event: dict[str, Any]) -> Optional[str]:
    for value in (event.get("seasonId"), event.get("season")):
        if isinstance(value, dict):
            value = value.get("id") or value.get("seasonId") or value.get("startYear")
        if value is not None and str(value).strip():
            return str(value).strip()
    info = event.get("seasonInfo")
    if isinstance(info, dict):
        value = info.get("id") or info.get("seasonId") or info.get("startYear")
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def parse_sdp_matches(payload: object, *, observed_at: str, source_url: str) -> tuple[PremierLeagueSDPFixture, ...]:
    if not isinstance(payload, dict):
        raise ValueError("PREMIERLEAGUE_SDP_PAYLOAD_OBJECT_REQUIRED")
    data = payload.get("data")
    if not isinstance(data, list):
        raise ValueError("PREMIERLEAGUE_SDP_DATA_ARRAY_REQUIRED")
    observed = _timestamp(observed_at, "PREMIERLEAGUE_SDP_OBSERVED_AT")
    rows: list[PremierLeagueSDPFixture] = []
    seen: set[str] = set()

    for event in data:
        if not isinstance(event, dict):
            raise ValueError("PREMIERLEAGUE_SDP_MATCH_OBJECT_REQUIRED")
        match_id = _id(event.get("matchId") or event.get("id"), "PREMIERLEAGUE_SDP_MATCH_ID")
        if match_id in seen:
            raise ValueError(f"PREMIERLEAGUE_SDP_MATCH_DUPLICATE_{match_id}")
        seen.add(match_id)

        competition = event.get("competitionId")
        if isinstance(competition, dict):
            competition = competition.get("id")
        if str(competition or "").strip() != OFFICIAL_COMPETITION_ID:
            raise ValueError(f"PREMIERLEAGUE_SDP_COMPETITION_MISMATCH_{competition}")
        season_id = _season_id(event)
        if season_id is not None and season_id != OFFICIAL_SEASON_ID:
            raise ValueError(f"PREMIERLEAGUE_SDP_SEASON_MISMATCH_{season_id}")

        kickoff = _timestamp(event.get("kickoff"), "PREMIERLEAGUE_SDP_KICKOFF")
        period = _period(event)
        if period == "LIVE":
            continue
        if period == "PREMATCH" and kickoff <= observed:
            # Do not silently relabel a delayed/ambiguous match as scheduled.
            continue

        home = event.get("homeTeam")
        away = event.get("awayTeam")
        if not isinstance(home, dict) or not isinstance(away, dict):
            raise ValueError("PREMIERLEAGUE_SDP_TEAM_OBJECT_REQUIRED")
        home_id = _id(home.get("id"), "PREMIERLEAGUE_SDP_HOME_TEAM_ID")
        away_id = _id(away.get("id"), "PREMIERLEAGUE_SDP_AWAY_TEAM_ID")
        if home_id == away_id:
            raise ValueError("PREMIERLEAGUE_SDP_TEAM_ID_COLLISION")
        home_name = str(home.get("name") or home.get("shortName") or "").strip()
        away_name = str(away.get("name") or away.get("shortName") or "").strip()
        home_key = sdp_team_key(home_name)
        away_key = sdp_team_key(away_name)
        if home_key == away_key:
            raise ValueError("PREMIERLEAGUE_SDP_TEAM_KEY_COLLISION")

        if period == "PREMATCH":
            state = "SCHEDULED"
            hg = ag = None
            result = None
        else:
            state = "SETTLED"
            hg = _nonnegative_int(home.get("score"), "PREMIERLEAGUE_SDP_HOME_SCORE")
            ag = _nonnegative_int(away.get("score"), "PREMIERLEAGUE_SDP_AWAY_SCORE")
            result = "H" if hg > ag else "A" if ag > hg else "D"

        event_sha = hashlib.sha256(json.dumps(event, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        rows.append(PremierLeagueSDPFixture(
            provider_fixture_id=match_id,
            competition_id=COMPETITION_ID,
            season=SEASON,
            kickoff_utc=kickoff.isoformat().replace("+00:00", "Z"),
            date=kickoff.date().isoformat(),
            home_team_id=home_id,
            home=home_name,
            home_key=home_key,
            away_team_id=away_id,
            away=away_name,
            away_key=away_key,
            state=state,
            home_goals=hg,
            away_goals=ag,
            result=result,
            observed_at=observed.isoformat().replace("+00:00", "Z"),
            source="PREMIERLEAGUE_SDP",
            source_class=SOURCE_CLASS,
            source_url=source_url,
            source_event_sha256=event_sha,
            verification_source_only=True,
            bookmaker_data_used=False,
            provider_prediction_used=False,
        ))
    return tuple(rows)


def reconcile_espn_sdp(espn_rows: list[Any] | tuple[Any, ...], sdp_rows: list[PremierLeagueSDPFixture] | tuple[PremierLeagueSDPFixture, ...]) -> dict[str, Any]:
    sdp_by_identity: dict[tuple[str, str, str], PremierLeagueSDPFixture] = {}
    for row in sdp_rows:
        key = (row.kickoff_utc, row.home_key, row.away_key)
        if key in sdp_by_identity:
            raise ValueError(f"PREMIERLEAGUE_SDP_RECONCILIATION_DUPLICATE_IDENTITY_{key}")
        sdp_by_identity[key] = row

    reconciled: list[ReconciliationRow] = []
    unmatched: list[dict[str, Any]] = []
    used_sdp_ids: set[str] = set()
    for espn in espn_rows:
        if getattr(espn, "competition_id", None) != COMPETITION_ID:
            raise ValueError("ESPN_EPL_RECONCILIATION_COMPETITION_MISMATCH")
        home_key = espn_team_key(getattr(espn, "home", ""))
        away_key = espn_team_key(getattr(espn, "away", ""))
        identity = (str(getattr(espn, "kickoff_utc", "")), home_key, away_key)
        other = sdp_by_identity.get(identity)
        if other is None:
            unmatched.append({
                "espn_provider_fixture_id": str(getattr(espn, "provider_fixture_id", "")),
                "kickoff_utc": identity[0],
                "home_key": home_key,
                "away_key": away_key,
                "reason": "NO_EXACT_PREMIERLEAGUE_SDP_IDENTITY_MATCH",
            })
            continue
        if other.provider_fixture_id in used_sdp_ids:
            raise ValueError(f"PREMIERLEAGUE_SDP_RECONCILIATION_REUSE_{other.provider_fixture_id}")
        used_sdp_ids.add(other.provider_fixture_id)

        espn_state = getattr(espn, "state", None)
        if espn_state != other.state:
            unmatched.append({
                "espn_provider_fixture_id": str(getattr(espn, "provider_fixture_id", "")),
                "sdp_provider_fixture_id": other.provider_fixture_id,
                "reason": "STATE_MISMATCH",
            })
            continue
        if espn_state == "SETTLED":
            if getattr(espn, "home_goals", None) != other.home_goals or getattr(espn, "away_goals", None) != other.away_goals:
                unmatched.append({
                    "espn_provider_fixture_id": str(getattr(espn, "provider_fixture_id", "")),
                    "sdp_provider_fixture_id": other.provider_fixture_id,
                    "reason": "FINAL_SCORE_MISMATCH",
                })
                continue

        reconciled.append(ReconciliationRow(
            espn_provider_fixture_id=str(getattr(espn, "provider_fixture_id", "")),
            sdp_provider_fixture_id=other.provider_fixture_id,
            competition_id=COMPETITION_ID,
            kickoff_utc=other.kickoff_utc,
            home_key=home_key,
            away_key=away_key,
            state=other.state,
            home_goals=other.home_goals,
            away_goals=other.away_goals,
            espn_source_sha256=str(getattr(espn, "source_event_sha256", "")),
            sdp_source_sha256=other.source_event_sha256,
            strict_gate1_eligible=True,
            reconciliation="EXACT_CROSS_SOURCE_MATCH",
        ))

    return {
        "provider_pair": ["ESPN_SITE_SCOREBOARD", "PREMIERLEAGUE_SDP"],
        "competition_id": COMPETITION_ID,
        "identity_rule": "EXACT_KICKOFF_UTC_HOME_KEY_AWAY_KEY",
        "settled_rule": "EXACT_STATE_AND_FINAL_SCORE",
        "fuzzy_matching": False,
        "espn_rows_n": len(espn_rows),
        "sdp_rows_n": len(sdp_rows),
        "reconciled_n": len(reconciled),
        "unmatched_espn_n": len(unmatched),
        "strict_gate1_eligible_n": len(reconciled),
        "reconciled": [asdict(row) for row in reconciled],
        "unmatched": unmatched,
        "governance": {
            "cross_source_agreement_required": True,
            "official_site_backend_undocumented": True,
            "official_site_backend_alone_auto_promotes": False,
            "fuzzy_matching": False,
            "bookmaker_data_used": False,
            "provider_prediction_used": False,
            "automatic_model_promotion": False,
            "capital_effect": "NONE",
        },
    }
