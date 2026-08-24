from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Optional


VERSION = "OPENLIGADB_BUNDESLIGA_VERIFIER_V0_1"
SOURCE_URL = "https://api.openligadb.de/getmatchdata/bl1/2026"
SOURCE_CLASS = "PUBLIC_COMMUNITY_DATABASE_ODBL"
COMPETITION_ID = "BUNDESLIGA"
SEASON = "2026/27"

# Explicit provider aliases only. No fuzzy matching is permitted.
ESPN_TEAM_ALIASES = {
    "1. FC Köln": "FC_KOLN",
    "FC Cologne": "FC_KOLN",
    "Union Berlin": "UNION_BERLIN",
    "1. FC Union Berlin": "UNION_BERLIN",
    "Mainz": "MAINZ_05",
    "Mainz 05": "MAINZ_05",
    "Bayer Leverkusen": "BAYER_LEVERKUSEN",
    "Borussia Dortmund": "BORUSSIA_DORTMUND",
    "Borussia Monchengladbach": "BORUSSIA_MONCHENGLADBACH",
    "Borussia Mönchengladbach": "BORUSSIA_MONCHENGLADBACH",
    "Eintracht Frankfurt": "EINTRACHT_FRANKFURT",
    "FC Augsburg": "FC_AUGSBURG",
    "Bayern Munich": "BAYERN_MUNICH",
    "Bayern München": "BAYERN_MUNICH",
    "Hamburg SV": "HAMBURGER_SV",
    "Hamburger SV": "HAMBURGER_SV",
    "RB Leipzig": "RB_LEIPZIG",
    "SC Freiburg": "SC_FREIBURG",
    "Werder Bremen": "WERDER_BREMEN",
    "TSG Hoffenheim": "TSG_HOFFENHEIM",
    "VfB Stuttgart": "VFB_STUTTGART",
    "Schalke 04": "SCHALKE_04",
    "FC Schalke 04": "SCHALKE_04",
    "SV Elversberg": "SV_ELVERSBERG",
    "SV 07 Elversberg": "SV_ELVERSBERG",
    "SC Paderborn 07": "SC_PADERBORN",
    "SC Paderborn": "SC_PADERBORN",
}

OPENLIGADB_TEAM_ALIASES = {
    "1. FC Köln": "FC_KOLN",
    "1. FC Union Berlin": "UNION_BERLIN",
    "1. FSV Mainz 05": "MAINZ_05",
    "Bayer 04 Leverkusen": "BAYER_LEVERKUSEN",
    "Borussia Dortmund": "BORUSSIA_DORTMUND",
    "Borussia Mönchengladbach": "BORUSSIA_MONCHENGLADBACH",
    "Eintracht Frankfurt": "EINTRACHT_FRANKFURT",
    "FC Augsburg": "FC_AUGSBURG",
    "FC Bayern München": "BAYERN_MUNICH",
    "Hamburger SV": "HAMBURGER_SV",
    "RB Leipzig": "RB_LEIPZIG",
    "SC Freiburg": "SC_FREIBURG",
    "SV Werder Bremen": "WERDER_BREMEN",
    "TSG Hoffenheim": "TSG_HOFFENHEIM",
    "VfB Stuttgart": "VFB_STUTTGART",
    "FC Schalke 04": "SCHALKE_04",
    "SV Elversberg": "SV_ELVERSBERG",
    "SV 07 Elversberg": "SV_ELVERSBERG",
    "SC Paderborn 07": "SC_PADERBORN",
}

EXPECTED_TEAM_KEYS = frozenset({
    "FC_KOLN",
    "UNION_BERLIN",
    "MAINZ_05",
    "BAYER_LEVERKUSEN",
    "BORUSSIA_DORTMUND",
    "BORUSSIA_MONCHENGLADBACH",
    "EINTRACHT_FRANKFURT",
    "FC_AUGSBURG",
    "BAYERN_MUNICH",
    "HAMBURGER_SV",
    "RB_LEIPZIG",
    "SC_FREIBURG",
    "WERDER_BREMEN",
    "TSG_HOFFENHEIM",
    "VFB_STUTTGART",
    "SCHALKE_04",
    "SV_ELVERSBERG",
    "SC_PADERBORN",
})


@dataclass(frozen=True)
class OpenLigaDBFixture:
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
    strict_truth_source: bool
    bookmaker_data_used: bool
    provider_prediction_used: bool


@dataclass(frozen=True)
class ReconciliationRow:
    espn_provider_fixture_id: str
    openligadb_provider_fixture_id: str
    competition_id: str
    kickoff_utc: str
    home_key: str
    away_key: str
    state: str
    home_goals: Optional[int]
    away_goals: Optional[int]
    espn_source_sha256: str
    openligadb_source_sha256: str
    strict_gate1_eligible: bool
    reconciliation: str


def _timestamp(value: object, name: str) -> datetime:
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
    return _team_key(name, ESPN_TEAM_ALIASES, "ESPN_BUNDESLIGA")


def openligadb_team_key(name: object) -> str:
    return _team_key(name, OPENLIGADB_TEAM_ALIASES, "OPENLIGADB_BUNDESLIGA")


def _integer(value: object, name: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{name}_INTEGER_REQUIRED")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name}_INTEGER_REQUIRED") from exc
    if parsed < 0:
        raise ValueError(f"{name}_NONNEGATIVE_REQUIRED")
    return parsed


def _final_score(results: object) -> tuple[int, int]:
    if not isinstance(results, list) or not results:
        raise ValueError("OPENLIGADB_FINAL_RESULT_REQUIRED")
    candidates = []
    for row in results:
        if not isinstance(row, dict):
            raise ValueError("OPENLIGADB_RESULT_OBJECT_REQUIRED")
        order = row.get("resultOrder")
        if order is None:
            continue
        candidates.append((int(order), row))
    if not candidates:
        raise ValueError("OPENLIGADB_RESULT_ORDER_REQUIRED")
    highest = max(order for order, _ in candidates)
    finalists = [row for order, row in candidates if order == highest]
    if len(finalists) != 1:
        raise ValueError("OPENLIGADB_FINAL_RESULT_AMBIGUOUS")
    final = finalists[0]
    return (
        _integer(final.get("pointsTeam1"), "OPENLIGADB_HOME_SCORE"),
        _integer(final.get("pointsTeam2"), "OPENLIGADB_AWAY_SCORE"),
    )


def parse_openligadb(payload: object, *, observed_at: str, source_url: str = SOURCE_URL) -> tuple[OpenLigaDBFixture, ...]:
    if not isinstance(payload, list):
        raise ValueError("OPENLIGADB_MATCH_ARRAY_REQUIRED")
    observed = _timestamp(observed_at, "OPENLIGADB_OBSERVED_AT")
    rows: list[OpenLigaDBFixture] = []
    seen: set[str] = set()
    for event in payload:
        if not isinstance(event, dict):
            raise ValueError("OPENLIGADB_MATCH_OBJECT_REQUIRED")
        match_id = str(event.get("matchID") or event.get("matchId") or "").strip()
        if not match_id:
            raise ValueError("OPENLIGADB_MATCH_ID_REQUIRED")
        if match_id in seen:
            raise ValueError(f"OPENLIGADB_MATCH_DUPLICATE_{match_id}")
        seen.add(match_id)

        league_shortcut = str(event.get("leagueShortcut") or "").strip().lower()
        league_season = str(event.get("leagueSeason") or "").strip()
        if league_shortcut and league_shortcut != "bl1":
            raise ValueError(f"OPENLIGADB_LEAGUE_MISMATCH_{league_shortcut}")
        if league_season and league_season != "2026":
            raise ValueError(f"OPENLIGADB_SEASON_MISMATCH_{league_season}")

        kickoff = _timestamp(event.get("matchDateTimeUTC"), "OPENLIGADB_KICKOFF")
        team1 = event.get("team1") or {}
        team2 = event.get("team2") or {}
        if not isinstance(team1, dict) or not isinstance(team2, dict):
            raise ValueError("OPENLIGADB_TEAM_OBJECT_REQUIRED")
        home_id = str(team1.get("teamId") or team1.get("teamID") or "").strip()
        away_id = str(team2.get("teamId") or team2.get("teamID") or "").strip()
        home = str(team1.get("teamName") or "").strip()
        away = str(team2.get("teamName") or "").strip()
        if not home_id or not away_id or home_id == away_id:
            raise ValueError("OPENLIGADB_TEAM_IDENTITY_INVALID")
        home_key = openligadb_team_key(home)
        away_key = openligadb_team_key(away)
        if home_key == away_key:
            raise ValueError("OPENLIGADB_TEAM_KEY_COLLISION")

        finished = event.get("matchIsFinished")
        if finished is True:
            hg, ag = _final_score(event.get("matchResults"))
            state = "SETTLED"
            result = "H" if hg > ag else "A" if ag > hg else "D"
        elif finished is False:
            if kickoff <= observed:
                # Could be delayed, abandoned or in play. Do not call it scheduled.
                continue
            hg = ag = None
            state = "SCHEDULED"
            result = None
        else:
            raise ValueError("OPENLIGADB_MATCH_FINISHED_BOOLEAN_REQUIRED")

        event_sha = hashlib.sha256(json.dumps(event, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        rows.append(OpenLigaDBFixture(
            provider_fixture_id=match_id,
            competition_id=COMPETITION_ID,
            season=SEASON,
            kickoff_utc=kickoff.isoformat().replace("+00:00", "Z"),
            date=kickoff.date().isoformat(),
            home_team_id=home_id,
            home=home,
            home_key=home_key,
            away_team_id=away_id,
            away=away,
            away_key=away_key,
            state=state,
            home_goals=hg,
            away_goals=ag,
            result=result,
            observed_at=observed.isoformat().replace("+00:00", "Z"),
            source="OPENLIGADB",
            source_class=SOURCE_CLASS,
            source_url=source_url,
            source_event_sha256=event_sha,
            strict_truth_source=True,
            bookmaker_data_used=False,
            provider_prediction_used=False,
        ))
    return tuple(rows)


def reconcile_espn_openligadb(espn_rows: list[Any] | tuple[Any, ...], openliga_rows: list[OpenLigaDBFixture] | tuple[OpenLigaDBFixture, ...]) -> dict[str, Any]:
    open_by_identity: dict[tuple[str, str, str], OpenLigaDBFixture] = {}
    for row in openliga_rows:
        key = (row.kickoff_utc, row.home_key, row.away_key)
        if key in open_by_identity:
            raise ValueError(f"OPENLIGADB_RECONCILIATION_DUPLICATE_IDENTITY_{key}")
        open_by_identity[key] = row

    reconciled: list[ReconciliationRow] = []
    unmatched: list[dict[str, Any]] = []
    used_open_ids: set[str] = set()
    for espn in espn_rows:
        if getattr(espn, "competition_id", None) != COMPETITION_ID:
            raise ValueError("ESPN_RECONCILIATION_COMPETITION_MISMATCH")
        home_key = espn_team_key(getattr(espn, "home", ""))
        away_key = espn_team_key(getattr(espn, "away", ""))
        identity = (getattr(espn, "kickoff_utc", ""), home_key, away_key)
        other = open_by_identity.get(identity)
        if other is None:
            unmatched.append({
                "espn_provider_fixture_id": str(getattr(espn, "provider_fixture_id", "")),
                "kickoff_utc": identity[0],
                "home_key": home_key,
                "away_key": away_key,
                "reason": "NO_EXACT_OPENLIGADB_IDENTITY_MATCH",
            })
            continue
        if other.provider_fixture_id in used_open_ids:
            raise ValueError(f"OPENLIGADB_RECONCILIATION_REUSE_{other.provider_fixture_id}")
        used_open_ids.add(other.provider_fixture_id)

        espn_state = getattr(espn, "state", None)
        if espn_state != other.state:
            unmatched.append({
                "espn_provider_fixture_id": str(getattr(espn, "provider_fixture_id", "")),
                "openligadb_provider_fixture_id": other.provider_fixture_id,
                "reason": "STATE_MISMATCH",
            })
            continue
        if espn_state == "SETTLED":
            if getattr(espn, "home_goals", None) != other.home_goals or getattr(espn, "away_goals", None) != other.away_goals:
                unmatched.append({
                    "espn_provider_fixture_id": str(getattr(espn, "provider_fixture_id", "")),
                    "openligadb_provider_fixture_id": other.provider_fixture_id,
                    "reason": "FINAL_SCORE_MISMATCH",
                })
                continue

        reconciled.append(ReconciliationRow(
            espn_provider_fixture_id=str(getattr(espn, "provider_fixture_id", "")),
            openligadb_provider_fixture_id=other.provider_fixture_id,
            competition_id=COMPETITION_ID,
            kickoff_utc=other.kickoff_utc,
            home_key=home_key,
            away_key=away_key,
            state=other.state,
            home_goals=other.home_goals,
            away_goals=other.away_goals,
            espn_source_sha256=str(getattr(espn, "source_event_sha256", "")),
            openligadb_source_sha256=other.source_event_sha256,
            strict_gate1_eligible=True,
            reconciliation="EXACT_CROSS_SOURCE_MATCH",
        ))

    return {
        "provider_pair": ["ESPN_SITE_SCOREBOARD", "OPENLIGADB"],
        "competition_id": COMPETITION_ID,
        "identity_rule": "EXACT_KICKOFF_UTC_HOME_KEY_AWAY_KEY",
        "settled_rule": "EXACT_STATE_AND_FINAL_SCORE",
        "fuzzy_matching": False,
        "espn_rows_n": len(espn_rows),
        "openligadb_rows_n": len(openliga_rows),
        "reconciled_n": len(reconciled),
        "unmatched_espn_n": len(unmatched),
        "strict_gate1_eligible_n": len(reconciled),
        "reconciled": [asdict(row) for row in reconciled],
        "unmatched": unmatched,
        "governance": {
            "cross_source_agreement_required": True,
            "openligadb_alone_is_not_sufficient": True,
            "bookmaker_data_used": False,
            "provider_prediction_used": False,
            "automatic_model_promotion": False,
            "capital_effect": "NONE",
        },
    }
