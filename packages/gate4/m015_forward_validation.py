from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
from math import isfinite
from typing import Dict, Iterable, List, Optional, Sequence, Set

from gate3_engine import brier_score, log_loss


PROTOCOL_VERSION = "M015_PROSPECTIVE_FORWARD_VALIDATION_V0_1"
REGISTRATION_VERSION = "M015_FORWARD_REGISTRATION_V0_1"
FROZEN_SIGNAL_STATE = "SIGNAL_FROZEN"
SETTLED_STATE = "SETTLED"


def _canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha256_json(value: object) -> str:
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


def _probability(value: object, error: str) -> float:
    if not isinstance(value, (int, float)) or not isfinite(float(value)):
        raise ValueError(error)
    value = float(value)
    if not 0.0 < value < 1.0:
        raise ValueError(error)
    return value


def validate_registration(registration: Dict) -> Dict:
    if registration.get("registration_version") != REGISTRATION_VERSION:
        raise ValueError("M015_FORWARD_REGISTRATION_VERSION_MISMATCH")
    if registration.get("model_id") != "M015":
        raise ValueError("M015_FORWARD_MODEL_ID_MISMATCH")
    if registration.get("state") != "PRE_REGISTERED_FORWARD_VALIDATION_WAITING":
        raise ValueError("M015_FORWARD_REGISTRATION_STATE_INVALID")

    specification = registration.get("specification")
    if not isinstance(specification, dict):
        raise ValueError("M015_FORWARD_SPECIFICATION_REQUIRED")
    expected = str(registration.get("specification_sha256") or "")
    actual = _sha256_json(specification)
    if not expected or expected != actual:
        raise ValueError("M015_FORWARD_SPECIFICATION_FINGERPRINT_MISMATCH")

    if specification.get("model_id") != registration.get("model_id"):
        raise ValueError("M015_FORWARD_SPEC_MODEL_ID_MISMATCH")
    if specification.get("model_version") != registration.get("model_version"):
        raise ValueError("M015_FORWARD_SPEC_MODEL_VERSION_MISMATCH")
    if specification.get("market_used_as_model_input") is not False:
        raise ValueError("M015_FORWARD_MARKET_INPUT_FORBIDDEN")
    if specification.get("market_used_as_benchmark_only") is not True:
        raise ValueError("M015_FORWARD_MARKET_BENCHMARK_ONLY_REQUIRED")
    if specification.get("retuning_allowed_during_forward_test") is not False:
        raise ValueError("M015_FORWARD_RETUNING_MUST_BE_DISABLED")

    _dt(registration.get("registered_at"), "M015_FORWARD_REGISTERED_AT_REQUIRED")
    requirements = registration.get("forward_evidence_requirements") or {}
    if int(requirements.get("independent_validation_min_n", 0)) <= 0:
        raise ValueError("M015_FORWARD_INDEPENDENT_MIN_N_REQUIRED")
    if int(requirements.get("gate4_min_n", 0)) <= 0:
        raise ValueError("M015_FORWARD_GATE4_MIN_N_REQUIRED")
    if float(requirements.get("decision_weight_until_existing_gates_pass", -1.0)) != 0.0:
        raise ValueError("M015_FORWARD_DECISION_WEIGHT_MUST_BE_ZERO")
    if requirements.get("automatic_promotion") is not False:
        raise ValueError("M015_FORWARD_AUTOMATIC_PROMOTION_FORBIDDEN")
    return registration


def freeze_prediction(
    registration: Dict,
    prediction: Dict,
    *,
    forbidden_match_ids: Iterable[str] = (),
) -> Dict:
    validate_registration(registration)
    forbidden = {str(x) for x in forbidden_match_ids}

    forbidden_outcome_fields = {
        "outcome_u35", "total_goals", "final_score", "settled_at", "result_verified"
    }
    leaked = sorted(k for k in forbidden_outcome_fields if k in prediction)
    if leaked:
        raise ValueError(f"M015_FORWARD_OUTCOME_LEAKAGE_IN_PREDICTION:{','.join(leaked)}")

    match_id = str(prediction.get("match_id") or "").strip()
    if not match_id:
        raise ValueError("M015_FORWARD_MATCH_ID_REQUIRED")
    if match_id in forbidden:
        raise ValueError("M015_FORWARD_FROZEN_MATCH_REUSE_FORBIDDEN")

    scope = registration.get("scope") or {}
    competition = str(scope.get("competition") or "").upper()
    league = str(prediction.get("league") or "").upper()
    if not competition or league != competition:
        raise ValueError("M015_FORWARD_COMPETITION_SCOPE_MISMATCH")

    if prediction.get("model_id") != registration.get("model_id"):
        raise ValueError("M015_FORWARD_PREDICTION_MODEL_ID_MISMATCH")
    if prediction.get("model_version") != registration.get("model_version"):
        raise ValueError("M015_FORWARD_PREDICTION_MODEL_VERSION_MISMATCH")
    if prediction.get("specification_sha256") != registration.get("specification_sha256"):
        raise ValueError("M015_FORWARD_PREDICTION_SPEC_FINGERPRINT_MISMATCH")

    feature_snapshot_id = str(prediction.get("feature_snapshot_id") or "").strip()
    training_state_fingerprint = str(prediction.get("training_state_fingerprint") or "").strip()
    if not feature_snapshot_id:
        raise ValueError("M015_FORWARD_FEATURE_SNAPSHOT_ID_REQUIRED")
    if not training_state_fingerprint:
        raise ValueError("M015_FORWARD_TRAINING_STATE_FINGERPRINT_REQUIRED")

    registered_at = _dt(registration["registered_at"], "M015_FORWARD_REGISTERED_AT_REQUIRED")
    kickoff_at = _dt(prediction.get("kickoff_at"), "M015_FORWARD_KICKOFF_AT_REQUIRED")
    frozen_at = _dt(prediction.get("prediction_frozen_at"), "M015_FORWARD_PREDICTION_FROZEN_AT_REQUIRED")
    market_at = _dt(prediction.get("market_observed_at"), "M015_FORWARD_MARKET_OBSERVED_AT_REQUIRED")

    if kickoff_at <= registered_at:
        raise ValueError("M015_FORWARD_KICKOFF_NOT_FUTURE_TO_REGISTRATION")
    if frozen_at <= registered_at:
        raise ValueError("M015_FORWARD_PREDICTION_NOT_FUTURE_TO_REGISTRATION")
    if frozen_at >= kickoff_at:
        raise ValueError("M015_FORWARD_PREDICTION_NOT_PRE_KICKOFF")
    if market_at <= registered_at:
        raise ValueError("M015_FORWARD_MARKET_NOT_FUTURE_TO_REGISTRATION")
    if market_at >= kickoff_at:
        raise ValueError("M015_FORWARD_MARKET_NOT_PRE_KICKOFF")

    model_probability = _probability(
        prediction.get("model_probability"), "M015_FORWARD_MODEL_PROBABILITY_INVALID"
    )
    market_probability = _probability(
        prediction.get("market_probability"), "M015_FORWARD_MARKET_PROBABILITY_INVALID"
    )

    payload = {
        "protocol_version": PROTOCOL_VERSION,
        "state": FROZEN_SIGNAL_STATE,
        "challenger_id": registration["challenger_id"],
        "model_id": registration["model_id"],
        "model_version": registration["model_version"],
        "specification_sha256": registration["specification_sha256"],
        "match_id": match_id,
        "league": league,
        "market": "U3.5",
        "feature_snapshot_id": feature_snapshot_id,
        "training_state_fingerprint": training_state_fingerprint,
        "kickoff_at": prediction["kickoff_at"],
        "prediction_frozen_at": prediction["prediction_frozen_at"],
        "market_observed_at": prediction["market_observed_at"],
        "model_probability": model_probability,
        "market_probability": market_probability,
    }
    payload["prediction_fingerprint_sha256"] = _sha256_json(payload)
    return payload


def verify_frozen_prediction(frozen: Dict) -> bool:
    fingerprint = str(frozen.get("prediction_fingerprint_sha256") or "")
    if not fingerprint:
        return False
    payload = dict(frozen)
    payload.pop("prediction_fingerprint_sha256", None)
    return fingerprint == _sha256_json(payload) and frozen.get("state") == FROZEN_SIGNAL_STATE


def settle_prediction(frozen: Dict, settlement: Dict) -> Dict:
    if not verify_frozen_prediction(frozen):
        raise ValueError("M015_FORWARD_FROZEN_PREDICTION_TAMPERED")
    if str(settlement.get("match_id") or "") != frozen.get("match_id"):
        raise ValueError("M015_FORWARD_SETTLEMENT_MATCH_ID_MISMATCH")
    if settlement.get("result_verified") is not True:
        raise ValueError("M015_FORWARD_VERIFIED_SETTLEMENT_REQUIRED")

    score = settlement.get("final_score") or {}
    home = score.get("home")
    away = score.get("away")
    if not isinstance(home, int) or not isinstance(away, int) or home < 0 or away < 0:
        raise ValueError("M015_FORWARD_FINAL_SCORE_INVALID")

    kickoff_at = _dt(frozen.get("kickoff_at"), "M015_FORWARD_KICKOFF_AT_REQUIRED")
    settled_at = _dt(settlement.get("settled_at"), "M015_FORWARD_SETTLED_AT_REQUIRED")
    if settled_at <= kickoff_at:
        raise ValueError("M015_FORWARD_SETTLEMENT_NOT_POST_KICKOFF")

    total_goals = home + away
    outcome = 1 if total_goals <= 3 else 0
    row = dict(frozen)
    row.update({
        "state": SETTLED_STATE,
        "settled_at": settlement["settled_at"],
        "result_verified": True,
        "final_score": {"home": home, "away": away},
        "total_goals": total_goals,
        "outcome_u35": outcome,
    })
    settlement_payload = dict(row)
    settlement_payload.pop("settlement_fingerprint_sha256", None)
    row["settlement_fingerprint_sha256"] = _sha256_json(settlement_payload)
    return row


def verify_settled_row(row: Dict) -> bool:
    fingerprint = str(row.get("settlement_fingerprint_sha256") or "")
    if not fingerprint or row.get("state") != SETTLED_STATE:
        return False
    payload = dict(row)
    payload.pop("settlement_fingerprint_sha256", None)
    return fingerprint == _sha256_json(payload)


def evaluate_forward_set(
    registration: Dict,
    settled_rows: Sequence[Dict],
    *,
    forbidden_match_ids: Iterable[str] = (),
) -> Dict:
    validate_registration(registration)
    forbidden: Set[str] = {str(x) for x in forbidden_match_ids}
    seen: Set[str] = set()
    model_probs: List[float] = []
    market_probs: List[float] = []
    outcomes: List[int] = []

    for row in settled_rows:
        if not verify_settled_row(row):
            raise ValueError("M015_FORWARD_SETTLED_ROW_TAMPERED")
        match_id = str(row.get("match_id") or "")
        if match_id in seen:
            raise ValueError("M015_FORWARD_DUPLICATE_MATCH_ID")
        if match_id in forbidden:
            raise ValueError("M015_FORWARD_FROZEN_MATCH_REUSE_FORBIDDEN")
        seen.add(match_id)
        if row.get("model_id") != registration.get("model_id"):
            raise ValueError("M015_FORWARD_ROW_MODEL_ID_MISMATCH")
        if row.get("model_version") != registration.get("model_version"):
            raise ValueError("M015_FORWARD_ROW_MODEL_VERSION_MISMATCH")
        if row.get("specification_sha256") != registration.get("specification_sha256"):
            raise ValueError("M015_FORWARD_ROW_SPEC_FINGERPRINT_MISMATCH")
        model_probs.append(_probability(row.get("model_probability"), "M015_FORWARD_MODEL_PROBABILITY_INVALID"))
        market_probs.append(_probability(row.get("market_probability"), "M015_FORWARD_MARKET_PROBABILITY_INVALID"))
        outcome = row.get("outcome_u35")
        if outcome not in (0, 1):
            raise ValueError("M015_FORWARD_OUTCOME_INVALID")
        outcomes.append(int(outcome))

    n = len(outcomes)
    requirements = registration["forward_evidence_requirements"]
    min_n = int(requirements["independent_validation_min_n"])
    gate4_min_n = int(requirements["gate4_min_n"])

    if n:
        bm = brier_score(model_probs, outcomes)
        bk = brier_score(market_probs, outcomes)
        lm = log_loss(model_probs, outcomes)
        lk = log_loss(market_probs, outcomes)
        delta_brier = bk - bm
        delta_logloss = lk - lm
    else:
        bm = bk = lm = lk = delta_brier = delta_logloss = None

    sample_pass = n >= min_n
    metric_pass = bool(
        sample_pass
        and delta_brier is not None
        and delta_logloss is not None
        and delta_brier > 0.0
        and delta_logloss > 0.0
    )

    if not sample_pass:
        validation_state = "WAITING_FOR_INDEPENDENT_MIN_N"
    elif metric_pass:
        validation_state = "INDEPENDENT_VALIDATION_PASS_GATE4_PENDING"
    else:
        validation_state = "INDEPENDENT_VALIDATION_FAIL"

    return {
        "protocol_version": PROTOCOL_VERSION,
        "evaluation_classification": "PROSPECTIVE_INDEPENDENT_FORWARD_VALIDATION",
        "challenger_id": registration["challenger_id"],
        "model_id": registration["model_id"],
        "model_version": registration["model_version"],
        "specification_sha256": registration["specification_sha256"],
        "summary": {
            "independent_validation_n": n,
            "independent_validation_min_n": min_n,
            "remaining_to_independent_min_n": max(0, min_n - n),
            "gate4_min_n": gate4_min_n,
            "remaining_to_gate4_min_n": max(0, gate4_min_n - n),
        },
        "metrics": {
            "brier_model": bm,
            "brier_market": bk,
            "delta_brier_vs_market": delta_brier,
            "logloss_model": lm,
            "logloss_market": lk,
            "delta_logloss_vs_market": delta_logloss,
        },
        "gate_results": {
            "independent_sample_gate": "PASS" if sample_pass else "WAITING",
            "independent_metrics_vs_market": "PASS" if metric_pass else ("NOT_EVALUATED" if not sample_pass else "FAIL"),
            "gate4_sample_size_reached": n >= gate4_min_n,
        },
        "validation_state": validation_state,
        "model_state": "PAPER_ONLY",
        "decision_weight": 0.0,
        "market_champion_replaced": False,
        "automatic_promotion": False,
        "capital_effect": "NONE",
        "real_money": "NO",
        "governance": {
            "retuning_during_forward_test": False,
            "all_counted_rows_post_registration": True,
            "all_predictions_frozen_pre_kickoff": True,
            "all_market_benchmarks_observed_pre_kickoff": True,
            "all_outcomes_verified_post_kickoff": True,
            "consumed_development_rows_counted_as_independent": False,
            "gate4_still_separate": True,
        },
    }
