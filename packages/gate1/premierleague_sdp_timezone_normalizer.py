from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


VERSION = "PREMIERLEAGUE_SDP_TIMEZONE_NORMALIZER_V0_1"


def _is_naive_iso(value: object) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is None


def normalize_sdp_kickoffs(payload: object) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("PREMIERLEAGUE_SDP_TIMEZONE_PAYLOAD_OBJECT_REQUIRED")
    data = payload.get("data")
    if not isinstance(data, list):
        raise ValueError("PREMIERLEAGUE_SDP_TIMEZONE_DATA_ARRAY_REQUIRED")

    normalized = copy.deepcopy(payload)
    for event in normalized["data"]:
        if not isinstance(event, dict):
            raise ValueError("PREMIERLEAGUE_SDP_TIMEZONE_MATCH_OBJECT_REQUIRED")
        kickoff = event.get("kickoff")
        if isinstance(kickoff, dict):
            # Existing parser already prefers epoch millis when supplied.
            if kickoff.get("millis") is not None:
                continue
            raw = kickoff.get("label") or kickoff.get("iso") or kickoff.get("date") or kickoff.get("value")
            container = kickoff
        else:
            raw = kickoff
            container = None

        if not _is_naive_iso(raw):
            continue

        timezone_name = str(event.get("kickoffTimezone") or "").strip()
        if not timezone_name:
            raise ValueError("PREMIERLEAGUE_SDP_KICKOFF_TIMEZONE_FIELD_REQUIRED_FOR_NAIVE_KICKOFF")
        try:
            zone = ZoneInfo(timezone_name)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"PREMIERLEAGUE_SDP_KICKOFF_TIMEZONE_UNSUPPORTED_{timezone_name}") from exc

        local = datetime.fromisoformat(str(raw).strip())
        utc_value = local.replace(tzinfo=zone).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        if container is None:
            event["kickoff"] = utc_value
        elif "label" in container:
            container["label"] = utc_value
        elif "iso" in container:
            container["iso"] = utc_value
        elif "date" in container:
            container["date"] = utc_value
        elif "value" in container:
            container["value"] = utc_value
        else:
            raise ValueError("PREMIERLEAGUE_SDP_KICKOFF_CONTAINER_VALUE_REQUIRED")

    return normalized
