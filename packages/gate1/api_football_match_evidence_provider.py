from __future__ import annotations

import hashlib
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Callable, Iterable, Mapping, Optional, Sequence

from api_football_live_provider import BY_PROVIDER_ID


VERSION = "API_FOOTBALL_PREMATCH_EVIDENCE_RUNTIME_V0_1"
SCHEMA_VERSION = "CANONICAL_PROVIDER_MATCH_EVIDENCE_V0_1"
BASE_URL = "https://v3.football.api-sports.io/fixtures"
SETTLED_STATUSES = {"FT", "AET", "PEN"}
SCHEDULED_STATUSES = {"NS", "TBD"}
DEFAULT_FETCH_LAST = 20
DEFAULT_FEATURE_LIMIT = 5


def _canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha256(value: object) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _required_string(value: object, code: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(code)
    return value.strip()


def _positive_int(value: object, code: str) -> int:
    if isinstance(value, bool):
        raise ValueError(code)
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(code) from exc
    if parsed <= 0:
        raise ValueError(code)
    return parsed


def _score(value: object, code: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(code)
    return value


def _utc(value: object, code: str) -> str:
    text = _required_string(value, code)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(code) from exc
    if parsed.tzinfo is None:
        raise ValueError(code)
    parsed = parsed.astimezone(timezone.utc)
    return parsed.strftime("%Y-%m-%dT%H:%M:%S.") + f"{parsed.microsecond // 1000:03d}Z"


def _timestamp(value: object, code: str) -> datetime:
    return datetime.fromisoformat(_utc(value, code).replace("Z", "+00:00"))


def _response(document: object, code: str) -> list[dict]:
    if not isinstance(document, dict):
        raise ValueError(code + "_OBJECT_REQUIRED")
    if document.get("errors") not in (None, [], {}):
        raise ValueError(code + "_ERRORS_PRESENT")
    rows = document.get("response")
    if not isinstance(rows, list):
        raise ValueError(code + "_RESPONSE_ARRAY_REQUIRED")
    if any(not isinstance(row, dict) for row in rows):
        raise ValueError(code + "_ROW_OBJECT_REQUIRED")
    return rows


def _fixture_parts(row: dict, code: str) -> tuple[dict, dict, dict, dict]:
    fixture = row.get("fixture")
    league = row.get("league")
    teams = row.get("teams")
    goals = row.get("goals")
    if not all(isinstance(value, dict) for value in (fixture, league, teams, goals)):
        raise ValueError(code + "_STRUCTURE_INVALID")
    return fixture, league, teams, goals


def _team(team: object, code: str) -> tuple[int, str]:
    if not isinstance(team, dict):
        raise ValueError(code + "_OBJECT_REQUIRED")
    return (
        _positive_int(team.get("id"), code + "_ID_INVALID"),
        _required_string(team.get("name"), code + "_NAME_REQUIRED"),
    )


def _status(fixture: dict, code: str) -> str:
    status = fixture.get("status")
    if not isinstance(status, dict):
        raise ValueError(code + "_STATUS_REQUIRED")
    return _required_string(status.get("short"), code + "_STATUS_REQUIRED").upper()


def _target_fields(target: object) -> dict:
    if not isinstance(target, dict):
        raise ValueError("API_FOOTBALL_TARGET_OBJECT_REQUIRED")
    home_id = _positive_int(target.get("homeTeamId"), "API_FOOTBALL_TARGET_HOME_TEAM_ID_INVALID")
    away_id = _positive_int(target.get("awayTeamId"), "API_FOOTBALL_TARGET_AWAY_TEAM_ID_INVALID")
    if home_id == away_id:
        raise ValueError("API_FOOTBALL_TARGET_TEAM_COLLISION")
    kickoff = _utc(target.get("kickoffAt"), "API_FOOTBALL_TARGET_KICKOFF_INVALID")
    cutoff = _utc(target.get("predictionCutoff"), "API_FOOTBALL_TARGET_PREDICTION_CUTOFF_INVALID")
    if _timestamp(cutoff, "API_FOOTBALL_TARGET_PREDICTION_CUTOFF_INVALID") >= _timestamp(
        kickoff, "API_FOOTBALL_TARGET_KICKOFF_INVALID"
    ):
        raise ValueError("API_FOOTBALL_TARGET_PREDICTION_CUTOFF_NOT_PREMATCH")
    return {
        "eventId": _required_string(target.get("eventId"), "API_FOOTBALL_TARGET_EVENT_ID_REQUIRED"),
        "providerFixtureId": _positive_int(
            target.get("providerFixtureId"), "API_FOOTBALL_TARGET_FIXTURE_ID_INVALID"
        ),
        "kickoffAt": kickoff,
        "predictionCutoff": cutoff,
        "homeTeamId": home_id,
        "homeTeam": _required_string(target.get("homeTeam"), "API_FOOTBALL_TARGET_HOME_TEAM_REQUIRED"),
        "awayTeamId": away_id,
        "awayTeam": _required_string(target.get("awayTeam"), "API_FOOTBALL_TARGET_AWAY_TEAM_REQUIRED"),
    }


def _verify_target_fixture(target: dict, document: object) -> None:
    rows = _response(document, "API_FOOTBALL_TARGET_FIXTURE")
    if len(rows) != 1:
        raise ValueError("API_FOOTBALL_TARGET_FIXTURE_EXACTLY_ONE_REQUIRED")
    fixture, league, teams, goals = _fixture_parts(rows[0], "API_FOOTBALL_TARGET_FIXTURE")
    if _positive_int(fixture.get("id"), "API_FOOTBALL_TARGET_FIXTURE_ID_INVALID") != target["providerFixtureId"]:
        raise ValueError("API_FOOTBALL_TARGET_FIXTURE_ID_MISMATCH")
    league_id = _positive_int(league.get("id"), "API_FOOTBALL_TARGET_LEAGUE_ID_INVALID")
    if league_id not in BY_PROVIDER_ID:
        raise ValueError("API_FOOTBALL_TARGET_LEAGUE_UNREGISTERED")
    home_id, home_name = _team(teams.get("home"), "API_FOOTBALL_TARGET_HOME_TEAM")
    away_id, away_name = _team(teams.get("away"), "API_FOOTBALL_TARGET_AWAY_TEAM")
    if (home_id, away_id) != (target["homeTeamId"], target["awayTeamId"]):
        raise ValueError("API_FOOTBALL_TARGET_TEAM_ID_MISMATCH")
    if (home_name, away_name) != (target["homeTeam"], target["awayTeam"]):
        raise ValueError("API_FOOTBALL_TARGET_TEAM_NAME_MISMATCH")
    if _utc(fixture.get("date"), "API_FOOTBALL_TARGET_FIXTURE_KICKOFF_INVALID") != target["kickoffAt"]:
        raise ValueError("API_FOOTBALL_TARGET_KICKOFF_MISMATCH")
    if _status(fixture, "API_FOOTBALL_TARGET_FIXTURE") not in SCHEDULED_STATUSES:
        raise ValueError("API_FOOTBALL_TARGET_NOT_PREMATCH")
    if goals.get("home") is not None or goals.get("away") is not None:
        raise ValueError("API_FOOTBALL_TARGET_PREMATCH_SCORE_PRESENT")


def _map_history(
    document: object,
    *,
    subject_team_id: int,
    target_kickoff: str,
    captured_at: str,
    code: str,
) -> list[tuple[dict, str]]:
    rows = _response(document, code)
    target_time = _timestamp(target_kickoff, "API_FOOTBALL_TARGET_KICKOFF_INVALID")
    capture_time = _timestamp(captured_at, "API_FOOTBALL_CAPTURED_AT_INVALID")
    mapped: list[tuple[dict, str]] = []
    seen: set[int] = set()
    for row in rows:
        fixture, _league, teams, goals = _fixture_parts(row, code)
        fixture_id = _positive_int(fixture.get("id"), code + "_FIXTURE_ID_INVALID")
        if fixture_id in seen:
            raise ValueError(code + "_DUPLICATE_FIXTURE_ID")
        seen.add(fixture_id)
        if _status(fixture, code) not in SETTLED_STATUSES:
            raise ValueError(code + "_NON_SETTLED_FIXTURE_REJECTED")
        played_at = _utc(fixture.get("date"), code + "_PLAYED_AT_INVALID")
        played_time = _timestamp(played_at, code + "_PLAYED_AT_INVALID")
        if played_time >= target_time:
            raise ValueError("API_FOOTBALL_POST_KICKOFF_HISTORY_REJECTED")
        if played_time > capture_time:
            raise ValueError("API_FOOTBALL_POST_CAPTURE_HISTORY_REJECTED")
        home_id, _home_name = _team(teams.get("home"), code + "_HOME_TEAM")
        away_id, _away_name = _team(teams.get("away"), code + "_AWAY_TEAM")
        if subject_team_id == home_id:
            venue = "HOME"
            goals_for = _score(goals.get("home"), code + "_HOME_GOALS_INVALID")
            goals_against = _score(goals.get("away"), code + "_AWAY_GOALS_INVALID")
        elif subject_team_id == away_id:
            venue = "AWAY"
            goals_for = _score(goals.get("away"), code + "_AWAY_GOALS_INVALID")
            goals_against = _score(goals.get("home"), code + "_HOME_GOALS_INVALID")
        else:
            raise ValueError(code + "_SUBJECT_TEAM_MISSING")
        mapped.append(({
            "matchId": "API_FOOTBALL-" + str(fixture_id),
            "playedAt": played_at,
            "goalsFor": goals_for,
            "goalsAgainst": goals_against,
            "opponentStrength": None,
            "scoringMinutes": None,
            "concedingMinutes": None,
        }, venue))
    mapped.sort(key=lambda item: item[0]["playedAt"], reverse=True)
    return mapped


def _rest_days(rows: Sequence[tuple[dict, str]], kickoff: str) -> Optional[int]:
    if not rows:
        return None
    elapsed = _timestamp(kickoff, "API_FOOTBALL_TARGET_KICKOFF_INVALID") - _timestamp(
        rows[0][0]["playedAt"], "API_FOOTBALL_HISTORY_PLAYED_AT_INVALID"
    )
    return int(elapsed.total_seconds() // 86400)


def _document_manifest(bundle: Mapping[str, object]) -> list[dict]:
    names = ("targetFixture", "homeHistory", "awayHistory", "h2h")
    return [
        {
            "document": name,
            "sha256": _sha256(bundle[name]),
            "responseCount": len(_response(bundle[name], "API_FOOTBALL_" + name.upper())),
        }
        for name in names
    ]


def _package_index(provider_package: object) -> dict[int, dict]:
    if not isinstance(provider_package, dict):
        raise ValueError("API_FOOTBALL_PROVIDER_PACKAGE_OBJECT_REQUIRED")
    if provider_package.get("provider") != "API_FOOTBALL":
        raise ValueError("API_FOOTBALL_PROVIDER_PACKAGE_PROVIDER_MISMATCH")
    events = provider_package.get("events")
    if not isinstance(events, list) or not events:
        raise ValueError("API_FOOTBALL_PROVIDER_PACKAGE_EVENTS_REQUIRED")
    index: dict[int, dict] = {}
    for item in events:
        if not isinstance(item, dict):
            raise ValueError("API_FOOTBALL_PROVIDER_PACKAGE_EVENT_OBJECT_REQUIRED")
        fixture_id = _positive_int(
            item.get("providerFixtureId"), "API_FOOTBALL_PROVIDER_PACKAGE_FIXTURE_ID_INVALID"
        )
        if fixture_id in index:
            raise ValueError("API_FOOTBALL_PROVIDER_PACKAGE_DUPLICATE_FIXTURE_ID")
        index[fixture_id] = item
    return index


def build_runtime_envelope(
    targets: Iterable[dict],
    provider_package: object,
    *,
    captured_at: object,
    feature_limit: int = DEFAULT_FEATURE_LIMIT,
) -> dict:
    captured = _utc(captured_at, "API_FOOTBALL_CAPTURED_AT_INVALID")
    if not isinstance(feature_limit, int) or feature_limit <= 0:
        raise ValueError("API_FOOTBALL_FEATURE_LIMIT_INVALID")
    normalized_targets = [_target_fields(target) for target in targets]
    if not normalized_targets:
        raise ValueError("API_FOOTBALL_TARGETS_REQUIRED")
    event_ids = [target["eventId"] for target in normalized_targets]
    fixture_ids = [target["providerFixtureId"] for target in normalized_targets]
    if len(event_ids) != len(set(event_ids)):
        raise ValueError("API_FOOTBALL_TARGET_EVENT_ID_DUPLICATE")
    if len(fixture_ids) != len(set(fixture_ids)):
        raise ValueError("API_FOOTBALL_TARGET_FIXTURE_ID_DUPLICATE")

    packages = _package_index(provider_package)
    if set(packages) != set(fixture_ids):
        raise ValueError("API_FOOTBALL_PROVIDER_PACKAGE_TARGET_SET_NOT_EXACT")

    canonical_events = []
    timings = {}
    batch_sources = []
    for target in normalized_targets:
        if _timestamp(captured, "API_FOOTBALL_CAPTURED_AT_INVALID") >= _timestamp(
            target["kickoffAt"], "API_FOOTBALL_TARGET_KICKOFF_INVALID"
        ):
            raise ValueError("API_FOOTBALL_CAPTURE_NOT_PREMATCH")
        if _timestamp(captured, "API_FOOTBALL_CAPTURED_AT_INVALID") > _timestamp(
            target["predictionCutoff"], "API_FOOTBALL_TARGET_PREDICTION_CUTOFF_INVALID"
        ):
            raise ValueError("API_FOOTBALL_CAPTURE_AFTER_PREDICTION_CUTOFF")
        bundle = packages[target["providerFixtureId"]]
        _verify_target_fixture(target, bundle.get("targetFixture"))

        home_history = _map_history(
            bundle.get("homeHistory"),
            subject_team_id=target["homeTeamId"],
            target_kickoff=target["kickoffAt"],
            captured_at=captured,
            code="API_FOOTBALL_HOME_HISTORY",
        )
        away_history = _map_history(
            bundle.get("awayHistory"),
            subject_team_id=target["awayTeamId"],
            target_kickoff=target["kickoffAt"],
            captured_at=captured,
            code="API_FOOTBALL_AWAY_HISTORY",
        )
        h2h = _map_history(
            bundle.get("h2h"),
            subject_team_id=target["homeTeamId"],
            target_kickoff=target["kickoffAt"],
            captured_at=captured,
            code="API_FOOTBALL_H2H",
        )

        sources = _document_manifest(bundle)
        source_fingerprint = _sha256({
            "providerFixtureId": target["providerFixtureId"],
            "documents": sources,
        })
        source_reference = (
            "api-football://prematch-evidence/"
            + str(target["providerFixtureId"])
            + "/bundle/"
            + source_fingerprint
        )
        snapshot_identity = _sha256({
            "eventId": target["eventId"],
            "providerFixtureId": target["providerFixtureId"],
            "capturedAt": captured,
        })
        home_recent = [row for row, _venue in home_history[:feature_limit]]
        away_recent = [row for row, _venue in away_history[:feature_limit]]
        home_venue = [row for row, venue in home_history if venue == "HOME"][:feature_limit]
        away_venue = [row for row, venue in away_history if venue == "AWAY"][:feature_limit]
        h2h_rows = [row for row, _venue in h2h]

        canonical_events.append({
            "schemaVersion": SCHEMA_VERSION,
            "provider": "API_FOOTBALL",
            "eventId": target["eventId"],
            "providerEventId": str(target["providerFixtureId"]),
            "evidenceSnapshotId": "API-FOOTBALL-EVIDENCE-" + snapshot_identity[:24],
            "kickoffAt": target["kickoffAt"],
            "homeTeam": target["homeTeam"],
            "awayTeam": target["awayTeam"],
            "sourceReference": source_reference,
            "providerSourceFingerprint": source_fingerprint,
            "sourceDocuments": sources,
            "featureVersion": "MATCH_EVIDENCE_FEATURES_V0_1",
            "recencyConfigVersion": "RECENCY_WEIGHTS_V1",
            "formContextWeightVersion": "FORM_CONTEXT_WEIGHTS_V1",
            "h2hDecayVersion": "H2H_DECAY_V1",
            "evidence": {
                "homeRecentMatches": home_recent,
                "awayRecentMatches": away_recent,
                "homeHomeMatches": home_venue,
                "awayAwayMatches": away_venue,
                "h2hMatches": h2h_rows,
                "leaguePositions": None,
                "restDays": {
                    "home": _rest_days(home_history, target["kickoffAt"]),
                    "away": _rest_days(away_history, target["kickoffAt"]),
                },
                "injuries": None,
                "suspensions": None,
                "lineups": None,
                "xG": None,
                "marketObservations": [],
            },
            "model": None,
        })
        timings[target["eventId"]] = {
            "observedAt": captured,
            "availableAt": captured,
            "predictionCutoff": target["predictionCutoff"],
        }
        batch_sources.append({
            "eventId": target["eventId"],
            "providerFixtureId": target["providerFixtureId"],
            "sourceFingerprint": source_fingerprint,
        })

    batch_identity = _sha256({
        "capturedAt": captured,
        "sources": sorted(batch_sources, key=lambda row: row["eventId"]),
    })
    return {
        "runtimeVersion": VERSION,
        "providerBatch": {
            "batchId": "API-FOOTBALL-PREMATCH-" + batch_identity[:24],
            "provider": "API_FOOTBALL",
            "sourceType": "PROVIDER_API",
            "sourceReference": "api-football://prematch-evidence/batch/" + batch_identity,
            "capturedAt": captured,
            "verified": True,
            "independentlyVerified": False,
            "events": canonical_events,
        },
        "timingByEvent": timings,
        "governance": {
            "authenticatedProviderRequiredForAcquisition": True,
            "rawProviderPayloadPersisted": False,
            "rawSourceFingerprintsRetained": True,
            "postKickoffEvidenceRejected": True,
            "providerPredictionUsed": False,
            "bookmakerOddsUsed": False,
            "missingEvidenceFabricated": False,
            "predictionIsNotValidationOrExecution": True,
            "settlementSeparate": True,
            "p002Unchanged": True,
            "gate1TruthOwner": True,
            "gate6CapitalOwner": True,
            "capitalState": "LOCKED",
            "realMoney": "NO",
            "automaticPromotionOrRetuning": False,
        },
    }


def _url(**params: object) -> str:
    return BASE_URL + "?" + urllib.parse.urlencode(sorted(params.items()))


def _open_json(url: str, headers: Mapping[str, str], timeout: int) -> dict:
    request = urllib.request.Request(url, headers=dict(headers))
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_provider_package(
    *,
    api_key: str,
    targets: Iterable[dict],
    timeout: int = 20,
    fetch_last: int = DEFAULT_FETCH_LAST,
    transport: Optional[Callable[[str, Mapping[str, str], int], dict]] = None,
) -> dict:
    key = _required_string(api_key, "APISPORTS_KEY_REQUIRED")
    if not isinstance(fetch_last, int) or fetch_last < DEFAULT_FEATURE_LIMIT:
        raise ValueError("API_FOOTBALL_FETCH_LAST_INVALID")
    normalized_targets = [_target_fields(target) for target in targets]
    if not normalized_targets:
        raise ValueError("API_FOOTBALL_TARGETS_REQUIRED")
    fetch = transport or _open_json
    headers = {
        "x-apisports-key": key,
        "Accept": "application/json",
        "User-Agent": "SPORTS-Decision-Intelligence/0.1",
    }
    cache: dict[str, dict] = {}

    def get(url: str) -> dict:
        if url not in cache:
            cache[url] = fetch(url, headers, timeout)
        return cache[url]

    events = []
    status = "-".join(sorted(SETTLED_STATUSES))
    for target in normalized_targets:
        home = target["homeTeamId"]
        away = target["awayTeamId"]
        events.append({
            "providerFixtureId": target["providerFixtureId"],
            "targetFixture": get(_url(id=target["providerFixtureId"])),
            "homeHistory": get(_url(last=fetch_last, status=status, team=home)),
            "awayHistory": get(_url(last=fetch_last, status=status, team=away)),
            "h2h": get(_url(h2h=str(home) + "-" + str(away), last=fetch_last, status=status)),
        })
    return {
        "provider": "API_FOOTBALL",
        "acquiredAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        "events": events,
        "requestCount": len(cache),
        "apiKeyPersisted": False,
    }


def provider_manifest() -> dict:
    return {
        "version": VERSION,
        "provider": "API_FOOTBALL",
        "canonicalSchemaVersion": SCHEMA_VERSION,
        "endpoints": {
            "targetFixture": "/fixtures?id={provider_fixture_id}",
            "teamHistory": "/fixtures?last={n}&status=AET-FT-PEN&team={team_id}",
            "h2h": "/fixtures?h2h={home_id}-{away_id}&last={n}&status=AET-FT-PEN",
        },
        "architecture": {
            "existingMatchEvidenceSnapshotReused": True,
            "existingPostgreSQLRuntimeReused": True,
            "newStore": False,
            "providerPredictionUsed": False,
            "bookmakerOddsUsed": False,
        },
    }
