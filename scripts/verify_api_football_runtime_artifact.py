from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse


EXPECTED_CAPABILITY = "API_FOOTBALL_LIVE_PROVIDER_V0_1"
ALLOWED_COMPETITIONS = {"EPL", "LA_LIGA", "SERIE_A", "BUNDESLIGA", "LIGUE_1"}
FORBIDDEN_SECRET_KEYS = {"apisports_key", "api_key", "token", "secret", "authorization", "x-apisports-key"}
LIVE_MODEL_POLICY = "UNCHANGED_UNLESS_SEPARATE_VERIFIED_EVENT_IMPACT_MODEL_SUPPLIES_MULTIPLIERS"


def _timestamp(value: object, name: str) -> None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{name}_INVALID") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{name}_TIMEZONE_REQUIRED")


def _scan_secrets(value: object, path: str = "root") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in FORBIDDEN_SECRET_KEYS:
                raise ValueError(f"SECRET_FIELD_FORBIDDEN_{path}_{key}")
            _scan_secrets(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _scan_secrets(child, f"{path}[{index}]")


def _source_url_safe(url: object) -> None:
    parsed = urlparse(str(url or ""))
    if parsed.scheme != "https" or parsed.netloc != "v3.football.api-sports.io":
        raise ValueError("PROVIDER_SOURCE_URL_INVALID")
    params = {key.lower() for key in parse_qs(parsed.query)}
    if params & FORBIDDEN_SECRET_KEYS:
        raise ValueError("PROVIDER_SOURCE_URL_CONTAINS_SECRET")


def _positive_int(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{name}_INVALID")
    return value


def _non_negative_int(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{name}_INVALID")
    return value


def _verify_live_model_inputs(live_rows: list[dict], live_inputs: list[dict]) -> None:
    by_event_id: dict[str, dict] = {}
    for row in live_rows:
        event_id = row.get("fixture_id")
        if not isinstance(event_id, str) or not event_id:
            raise ValueError("RUNTIME_LIVE_FIXTURE_ID_REQUIRED")
        if event_id in by_event_id:
            raise ValueError("RUNTIME_LIVE_FIXTURE_ID_DUPLICATE")
        by_event_id[event_id] = row

    seen_inputs: set[str] = set()
    for item in live_inputs:
        if not isinstance(item, dict):
            raise ValueError("RUNTIME_LIVE_MODEL_INPUT_OBJECT_REQUIRED")
        event_id = item.get("eventId")
        if event_id not in by_event_id:
            raise ValueError("RUNTIME_LIVE_MODEL_INPUT_EVENT_MISMATCH")
        if event_id in seen_inputs:
            raise ValueError("RUNTIME_LIVE_MODEL_INPUT_DUPLICATE")
        seen_inputs.add(event_id)
        row = by_event_id[event_id]

        if item.get("minute") != row.get("elapsed_minute"):
            raise ValueError("RUNTIME_LIVE_MODEL_INPUT_MINUTE_MISMATCH")
        if item.get("homeScore") != row.get("home_goals"):
            raise ValueError("RUNTIME_LIVE_MODEL_INPUT_HOME_SCORE_MISMATCH")
        if item.get("awayScore") != row.get("away_goals"):
            raise ValueError("RUNTIME_LIVE_MODEL_INPUT_AWAY_SCORE_MISMATCH")
        if item.get("observedAt") != row.get("observed_at"):
            raise ValueError("RUNTIME_LIVE_MODEL_INPUT_OBSERVED_AT_MISMATCH")
        if item.get("rateMultiplierPolicy") != LIVE_MODEL_POLICY:
            raise ValueError("RUNTIME_LIVE_MODEL_INPUT_RATE_POLICY_INVALID")

        evidence = item.get("evidence")
        if not isinstance(evidence, list) or not evidence:
            raise ValueError("RUNTIME_LIVE_MODEL_INPUT_EVIDENCE_REQUIRED")
        matches = [
            entry for entry in evidence
            if isinstance(entry, dict)
            and entry.get("type") == "LIVE_SCORE_TIME_PROVIDER_SNAPSHOT"
            and entry.get("provider") == "API_FOOTBALL"
            and entry.get("providerFixtureId") == row.get("provider_fixture_id")
            and entry.get("status") == row.get("status_short")
            and entry.get("sourceFixtureSha256") == row.get("source_fixture_sha256")
            and entry.get("verified") is True
        ]
        if len(matches) != 1:
            raise ValueError("RUNTIME_LIVE_MODEL_INPUT_PROVENANCE_MISMATCH")

    if seen_inputs != set(by_event_id):
        raise ValueError("RUNTIME_LIVE_MODEL_INPUT_COVERAGE_MISMATCH")


def verify(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("RUNTIME_ARTIFACT_OBJECT_REQUIRED")
    _scan_secrets(payload)
    if payload.get("capability") != EXPECTED_CAPABILITY:
        raise ValueError("RUNTIME_ARTIFACT_CAPABILITY_MISMATCH")
    _timestamp(payload.get("observed_at"), "RUNTIME_OBSERVED_AT")

    competitions = payload.get("competitions_requested")
    if not isinstance(competitions, list) or not competitions:
        raise ValueError("RUNTIME_COMPETITIONS_REQUIRED")
    if len(competitions) != len(set(competitions)):
        raise ValueError("RUNTIME_COMPETITIONS_DUPLICATE")
    if not set(competitions).issubset(ALLOWED_COMPETITIONS):
        raise ValueError("RUNTIME_COMPETITION_UNSUPPORTED")

    snapshots = payload.get("snapshots")
    live_inputs = payload.get("live_model_inputs")
    if not isinstance(snapshots, list) or not isinstance(live_inputs, list):
        raise ValueError("RUNTIME_ARRAYS_REQUIRED")
    if payload.get("rows_n") != len(snapshots):
        raise ValueError("RUNTIME_ROWS_COUNT_MISMATCH")
    live_rows = [row for row in snapshots if isinstance(row, dict) and row.get("state") == "LIVE_IN_PLAY"]
    if payload.get("live_in_play_n") != len(live_rows):
        raise ValueError("RUNTIME_LIVE_COUNT_MISMATCH")
    if len(live_inputs) != len(live_rows):
        raise ValueError("RUNTIME_LIVE_MODEL_INPUT_COUNT_MISMATCH")

    fixture_ids = set()
    for row in snapshots:
        if not isinstance(row, dict):
            raise ValueError("RUNTIME_SNAPSHOT_OBJECT_REQUIRED")
        if row.get("provider") != "API_FOOTBALL":
            raise ValueError("RUNTIME_PROVIDER_MISMATCH")
        fixture_id = _positive_int(row.get("provider_fixture_id"), "RUNTIME_PROVIDER_FIXTURE_ID")
        if fixture_id in fixture_ids:
            raise ValueError("RUNTIME_PROVIDER_FIXTURE_DUPLICATE")
        fixture_ids.add(fixture_id)

        competition_id = row.get("competition_id")
        if competition_id not in competitions or competition_id not in ALLOWED_COMPETITIONS:
            raise ValueError("RUNTIME_ROW_COMPETITION_MISMATCH")
        expected_fixture_id = f"{competition_id}-API_FOOTBALL-{fixture_id}"
        if row.get("fixture_id") != expected_fixture_id:
            raise ValueError("RUNTIME_CANONICAL_FIXTURE_ID_MISMATCH")

        if row.get("bookmaker_data_used") is not False:
            raise ValueError("RUNTIME_BOOKMAKER_DATA_FORBIDDEN")
        if row.get("provider_prediction_used") is not False:
            raise ValueError("RUNTIME_PROVIDER_PREDICTION_FORBIDDEN")
        digest = str(row.get("source_fixture_sha256") or "")
        if len(digest) != 64 or any(ch not in "0123456789abcdefABCDEF" for ch in digest):
            raise ValueError("RUNTIME_SOURCE_FIXTURE_SHA256_INVALID")
        _timestamp(row.get("observed_at"), "RUNTIME_ROW_OBSERVED_AT")
        if row.get("observed_at") != payload.get("observed_at"):
            raise ValueError("RUNTIME_ROW_OBSERVED_AT_MISMATCH")
        _source_url_safe(row.get("source_url"))

        if row.get("state") == "LIVE_IN_PLAY":
            minute = _non_negative_int(row.get("elapsed_minute"), "RUNTIME_LIVE_ELAPSED_MINUTE")
            if minute > 130:
                raise ValueError("RUNTIME_LIVE_ELAPSED_MINUTE_OUT_OF_RANGE")
            _non_negative_int(row.get("home_goals"), "RUNTIME_LIVE_HOME_GOALS")
            _non_negative_int(row.get("away_goals"), "RUNTIME_LIVE_AWAY_GOALS")

    _verify_live_model_inputs(live_rows, live_inputs)

    governance = payload.get("governance") or {}
    required_false = {
        "provider_prediction_used": False,
        "bookmaker_data_used": False,
        "api_key_persisted": False,
        "silent_rate_multiplier_derivation": False,
    }
    for key, expected in required_false.items():
        if governance.get(key) is not expected:
            raise ValueError(f"RUNTIME_GOVERNANCE_{key.upper()}_INVALID")
    if governance.get("real_money") != "NO":
        raise ValueError("RUNTIME_REAL_MONEY_MUST_BE_NO")

    return {
        "authenticated_provider_response_artifact": "VALID",
        "rows_n": len(snapshots),
        "live_in_play_n": len(live_rows),
        "live_match_captured": bool(live_rows),
        "zero_live_rows_is_valid_provider_runtime": True,
        "live_model_input_linkage": "EXACT_VERIFIED",
        "secret_persisted": False,
        "capital_effect": "NONE",
        "real_money": "NO",
    }


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        raise SystemExit("Usage: python scripts/verify_api_football_runtime_artifact.py <artifact.json>")
    payload = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    print(json.dumps(verify(payload), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
