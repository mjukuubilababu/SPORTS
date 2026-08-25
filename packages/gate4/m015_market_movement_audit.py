from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
from math import isfinite
from typing import Dict, Iterable, List


AUDIT_VERSION = "M015_MARKET_MOVEMENT_AUDIT_V0_1"
AUDIT_STATE = "APPEND_ONLY_RESEARCH_CONTEXT"
OBSERVATION_ROLE = "INTERMEDIATE_PREKICKOFF_MARKET_MOVEMENT_ONLY"


def _canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _hash(value: object) -> str:
    return sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _dt(value: object, error: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(error)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(error) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _decimal_odds(value: object, error: str) -> float:
    if not isinstance(value, (int, float)) or not isfinite(float(value)):
        raise ValueError(error)
    value = float(value)
    if value <= 1.0:
        raise ValueError(error)
    return value


def devig_u35(o35: float, u35: float) -> float:
    over = 1.0 / _decimal_odds(o35, "M015_MOVEMENT_O35_INVALID")
    under = 1.0 / _decimal_odds(u35, "M015_MOVEMENT_U35_INVALID")
    return under / (over + under)


def _observation_payload(observation: Dict) -> Dict:
    payload = dict(observation)
    payload.pop("observation_payload_sha256", None)
    return payload


def verify_observation_fingerprint(observation: Dict) -> bool:
    fingerprint = str(observation.get("observation_payload_sha256") or "")
    return bool(fingerprint) and fingerprint == _hash(_observation_payload(observation))


def validate_frozen_anchor(*, candidate: Dict, frozen_snapshot: Dict, forward_ledger: Dict) -> Dict:
    match_id = str(candidate.get("match_id") or "")
    if not match_id:
        raise ValueError("M015_MOVEMENT_CANDIDATE_MATCH_ID_REQUIRED")
    if frozen_snapshot.get("match_id") != match_id:
        raise ValueError("M015_MOVEMENT_SNAPSHOT_MATCH_MISMATCH")
    if frozen_snapshot.get("resulting_state") != "SIGNAL_FROZEN":
        raise ValueError("M015_MOVEMENT_ANCHOR_NOT_SIGNAL_FROZEN")
    if frozen_snapshot.get("candidate_fingerprint_sha256") != candidate.get("candidate_fingerprint_sha256"):
        raise ValueError("M015_MOVEMENT_CANDIDATE_FINGERPRINT_MISMATCH")
    if frozen_snapshot.get("model_probability_preserved") != candidate.get("model_probability"):
        raise ValueError("M015_MOVEMENT_MODEL_PROBABILITY_CHANGED")
    if frozen_snapshot.get("provider") != "Caliente.mx":
        raise ValueError("M015_MOVEMENT_ANCHOR_PROVIDER_UNEXPECTED")
    if frozen_snapshot.get("is_verified") is not True:
        raise ValueError("M015_MOVEMENT_ANCHOR_NOT_VERIFIED")
    if frozen_snapshot.get("pair_same_provider") is not True:
        raise ValueError("M015_MOVEMENT_ANCHOR_NOT_SAME_PROVIDER_PAIR")
    if frozen_snapshot.get("direct_provider_observation") is not True:
        raise ValueError("M015_MOVEMENT_ANCHOR_NOT_DIRECT_PROVIDER")

    frozen_observed_at = _dt(frozen_snapshot.get("observed_at"), "M015_MOVEMENT_ANCHOR_OBSERVED_AT_REQUIRED")
    kickoff_at = _dt(frozen_snapshot.get("kickoff_at"), "M015_MOVEMENT_KICKOFF_REQUIRED")
    if frozen_observed_at >= kickoff_at:
        raise ValueError("M015_MOVEMENT_ANCHOR_NOT_PREKICKOFF")

    o35 = _decimal_odds(frozen_snapshot.get("o35"), "M015_MOVEMENT_ANCHOR_O35_INVALID")
    u35 = _decimal_odds(frozen_snapshot.get("u35"), "M015_MOVEMENT_ANCHOR_U35_INVALID")
    fair = devig_u35(o35, u35)
    if abs(fair - float(frozen_snapshot.get("fair_u35_probability"))) > 1e-12:
        raise ValueError("M015_MOVEMENT_ANCHOR_DEVIG_MISMATCH")

    entries = [entry for entry in forward_ledger.get("entries", []) if entry.get("match_id") == match_id]
    if len(entries) != 1:
        raise ValueError("M015_MOVEMENT_EXPECTED_ONE_FROZEN_LEDGER_ENTRY")
    entry = entries[0]
    if entry.get("state") != "SIGNAL_FROZEN":
        raise ValueError("M015_MOVEMENT_LEDGER_ENTRY_NOT_FROZEN")
    market = entry.get("market_snapshot") or {}
    exact_fields = (
        "provider", "observed_at", "o35", "u35", "fair_u35_probability",
        "source_reference", "direct_provider_observation", "pair_same_provider",
    )
    for field in exact_fields:
        if market.get(field) != frozen_snapshot.get(field):
            raise ValueError(f"M015_MOVEMENT_LEDGER_ANCHOR_MISMATCH:{field}")
    if entry.get("model_probability") != candidate.get("model_probability"):
        raise ValueError("M015_MOVEMENT_LEDGER_MODEL_PROBABILITY_CHANGED")
    if entry.get("candidate_fingerprint_sha256") != candidate.get("candidate_fingerprint_sha256"):
        raise ValueError("M015_MOVEMENT_LEDGER_CANDIDATE_FINGERPRINT_CHANGED")

    return {
        "match_id": match_id,
        "provider": frozen_snapshot["provider"],
        "kickoff_at": frozen_snapshot["kickoff_at"],
        "frozen_observed_at": frozen_snapshot["observed_at"],
        "frozen_o35": o35,
        "frozen_u35": u35,
        "frozen_fair_u35_probability": fair,
        "model_probability": candidate["model_probability"],
        "candidate_fingerprint_sha256": candidate["candidate_fingerprint_sha256"],
        "prediction_fingerprint_sha256": entry["prediction_fingerprint_sha256"],
        "entry_fingerprint_sha256": entry["entry_fingerprint_sha256"],
    }


def validate_market_path(*, path: Dict, candidate: Dict, frozen_snapshot: Dict, forward_ledger: Dict) -> Dict:
    anchor = validate_frozen_anchor(
        candidate=candidate,
        frozen_snapshot=frozen_snapshot,
        forward_ledger=forward_ledger,
    )
    if path.get("audit_version") != AUDIT_VERSION:
        raise ValueError("M015_MOVEMENT_AUDIT_VERSION_MISMATCH")
    if path.get("state") != AUDIT_STATE:
        raise ValueError("M015_MOVEMENT_AUDIT_STATE_MISMATCH")
    if path.get("match_id") != anchor["match_id"]:
        raise ValueError("M015_MOVEMENT_PATH_MATCH_MISMATCH")
    if path.get("candidate_fingerprint_sha256") != anchor["candidate_fingerprint_sha256"]:
        raise ValueError("M015_MOVEMENT_PATH_CANDIDATE_FINGERPRINT_MISMATCH")
    if path.get("frozen_prediction_fingerprint_sha256") != anchor["prediction_fingerprint_sha256"]:
        raise ValueError("M015_MOVEMENT_PATH_PREDICTION_FINGERPRINT_MISMATCH")
    if path.get("evaluation_benchmark_observed_at") != anchor["frozen_observed_at"]:
        raise ValueError("M015_MOVEMENT_EVALUATION_ANCHOR_CHANGED")

    kickoff = _dt(anchor["kickoff_at"], "M015_MOVEMENT_KICKOFF_REQUIRED")
    frozen_time = _dt(anchor["frozen_observed_at"], "M015_MOVEMENT_ANCHOR_OBSERVED_AT_REQUIRED")
    previous = frozen_time
    seen_ids = set()
    seen_fingerprints = set()
    observations: List[Dict] = []

    for observation in path.get("observations", []):
        if not verify_observation_fingerprint(observation):
            raise ValueError("M015_MOVEMENT_OBSERVATION_TAMPERED")
        observation_id = str(observation.get("observation_id") or "")
        if not observation_id or observation_id in seen_ids:
            raise ValueError("M015_MOVEMENT_OBSERVATION_ID_DUPLICATE_OR_MISSING")
        fingerprint = str(observation["observation_payload_sha256"])
        if fingerprint in seen_fingerprints:
            raise ValueError("M015_MOVEMENT_OBSERVATION_FINGERPRINT_DUPLICATE")
        seen_ids.add(observation_id)
        seen_fingerprints.add(fingerprint)

        if observation.get("match_id") != anchor["match_id"]:
            raise ValueError("M015_MOVEMENT_OBSERVATION_MATCH_MISMATCH")
        if observation.get("provider") != anchor["provider"]:
            raise ValueError("M015_MOVEMENT_PROVIDER_CHANGED")
        if observation.get("market") != "O3.5/U3.5":
            raise ValueError("M015_MOVEMENT_MARKET_CHANGED")
        if observation.get("is_verified") is not True:
            raise ValueError("M015_MOVEMENT_OBSERVATION_NOT_VERIFIED")
        if observation.get("pair_same_provider") is not True:
            raise ValueError("M015_MOVEMENT_OBSERVATION_NOT_SAME_PROVIDER")
        if observation.get("direct_provider_observation") is not True:
            raise ValueError("M015_MOVEMENT_OBSERVATION_NOT_DIRECT_PROVIDER")
        if observation.get("role") != OBSERVATION_ROLE:
            raise ValueError("M015_MOVEMENT_OBSERVATION_ROLE_INVALID")

        observed = _dt(observation.get("observed_at"), "M015_MOVEMENT_OBSERVED_AT_REQUIRED")
        if observed <= previous:
            raise ValueError("M015_MOVEMENT_OBSERVATIONS_NOT_STRICTLY_CHRONOLOGICAL")
        if observed >= kickoff:
            raise ValueError("M015_MOVEMENT_POST_KICKOFF_OBSERVATION_FORBIDDEN")
        previous = observed

        o35 = _decimal_odds(observation.get("o35"), "M015_MOVEMENT_O35_INVALID")
        u35 = _decimal_odds(observation.get("u35"), "M015_MOVEMENT_U35_INVALID")
        fair = devig_u35(o35, u35)
        if abs(fair - float(observation.get("fair_u35_probability"))) > 1e-12:
            raise ValueError("M015_MOVEMENT_DEVIG_MISMATCH")
        observations.append(observation)

    latest_fair = anchor["frozen_fair_u35_probability"] if not observations else observations[-1]["fair_u35_probability"]
    frozen_edge = anchor["model_probability"] - anchor["frozen_fair_u35_probability"]
    latest_edge = anchor["model_probability"] - latest_fair
    return {
        "audit_valid": True,
        "match_id": anchor["match_id"],
        "observation_n": len(observations),
        "evaluation_benchmark_locked": True,
        "evaluation_benchmark_fair_u35_probability": anchor["frozen_fair_u35_probability"],
        "latest_context_fair_u35_probability": latest_fair,
        "market_probability_change_vs_frozen": latest_fair - anchor["frozen_fair_u35_probability"],
        "model_probability": anchor["model_probability"],
        "frozen_model_market_gap": frozen_edge,
        "latest_context_model_market_gap": latest_edge,
        "gap_change_vs_frozen": latest_edge - frozen_edge,
        "independent_n_incremented": False,
        "forward_ledger_modified": False,
        "evaluation_benchmark_replaced": False,
        "decision_weight": 0.0,
        "automatic_promotion": False,
    }
