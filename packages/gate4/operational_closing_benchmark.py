from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
from math import isfinite
from typing import Dict


POLICY_VERSION = "OPERATIONAL_CLOSING_BENCHMARK_V0_1"
SEMANTICS_ID = "OPERATIONAL_PREKICKOFF_CLOSE_300S_V0_1"
POLICY_EFFECTIVE_AT = "2026-08-23T17:00:00Z"
MAX_SECONDS_BEFORE_KICKOFF = 300
ALLOWED_SOURCE_CLASSES = frozenset({
    "DIRECT_BOOKMAKER_PUBLIC",
    "APPROVED_ODDS_AGGREGATOR_PROVIDER_PAIR",
})


def _iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _valid_odds(value) -> bool:
    return isinstance(value, (int, float)) and isfinite(float(value)) and float(value) > 1.0


def _looks_sha256(value: str) -> bool:
    value = str(value or "")
    return len(value) == 64 and all(c in "0123456789abcdef" for c in value.lower())


def observation_sha256(raw_observation: object) -> str:
    text = json.dumps(raw_observation, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class OperationalCloseObservation:
    match_id: str
    kickoff_at: str
    observed_at: str
    provider: str
    source: str
    source_url: str
    source_class: str
    over35_odds: float
    under35_odds: float
    source_verified: bool
    same_provider_two_sided: bool
    raw_observation_sha256: str


@dataclass(frozen=True)
class OperationalCloseDecision:
    accepted: bool
    semantics_id: str
    seconds_before_kickoff: float | None
    reasons: tuple[str, ...]


def validate_operational_close(observation: OperationalCloseObservation) -> OperationalCloseDecision:
    reasons: list[str] = []
    seconds_before: float | None = None
    try:
        effective = _iso(POLICY_EFFECTIVE_AT)
        kickoff = _iso(observation.kickoff_at)
        observed = _iso(observation.observed_at)
        seconds_before = (kickoff - observed).total_seconds()
        if observed < effective:
            reasons.append("OBSERVATION_PRECEDES_POLICY_EFFECTIVE_AT")
        if not (0 < seconds_before <= MAX_SECONDS_BEFORE_KICKOFF):
            reasons.append("OBSERVATION_OUTSIDE_OPERATIONAL_CLOSE_WINDOW")
    except (TypeError, ValueError):
        reasons.append("TIMESTAMP_INVALID_OR_MISSING")

    if not observation.match_id:
        reasons.append("MATCH_ID_REQUIRED")
    if not observation.provider or not observation.source or not observation.source_url:
        reasons.append("MARKET_PROVENANCE_REQUIRED")
    if observation.source_class not in ALLOWED_SOURCE_CLASSES:
        reasons.append("SOURCE_CLASS_NOT_ALLOWED")
    if observation.source_verified is not True:
        reasons.append("SOURCE_NOT_VERIFIED")
    if observation.same_provider_two_sided is not True:
        reasons.append("O35_U35_MUST_USE_SAME_PROVIDER")
    if not _valid_odds(observation.over35_odds) or not _valid_odds(observation.under35_odds):
        reasons.append("TWO_SIDED_DECIMAL_ODDS_INVALID")
    if not _looks_sha256(observation.raw_observation_sha256):
        reasons.append("RAW_OBSERVATION_SHA256_REQUIRED")

    return OperationalCloseDecision(
        accepted=not reasons,
        semantics_id=SEMANTICS_ID,
        seconds_before_kickoff=seconds_before,
        reasons=tuple(reasons),
    )


def decision_to_dict(decision: OperationalCloseDecision) -> Dict:
    return asdict(decision)


def policy_manifest() -> Dict:
    return {
        "policy_version": POLICY_VERSION,
        "semantics_id": SEMANTICS_ID,
        "effective_at": POLICY_EFFECTIVE_AT,
        "max_seconds_before_kickoff": MAX_SECONDS_BEFORE_KICKOFF,
        "allowed_source_classes": sorted(ALLOWED_SOURCE_CLASSES),
        "same_provider_two_sided_required": True,
        "raw_observation_sha256_required": True,
        "source_verified_required": True,
        "true_final_exchange_or_bookmaker_close_claimed": False,
        "benchmark_meaning": "LAST_SYSTEM_CAPTURE_WITHIN_FIXED_300_SECOND_PREKICKOFF_WINDOW",
        "no_post_kickoff_backfill_as_operational_close": True,
        "capital_effect": "NONE",
        "real_money": "NO",
    }
