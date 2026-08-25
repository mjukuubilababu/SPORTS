from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
from hashlib import sha256
import json
from math import isfinite
from typing import Dict, Iterable, List, Sequence, Tuple

from canonical_backfill import matches_from_truth_store
from gate2_engine import Match, build_features, devig_u35, feature_row_to_dict
from m015_regularized_poisson_glm import (
    MODEL_ID,
    MODEL_VERSION,
    fit_glm,
    gate2_component_totals,
    gate2_model_mean,
    poisson_u35,
    predict_mean,
)
from m015_forward_evidence_ledger import (
    append_frozen_prediction,
    validate_ledger,
)
from m015_forward_validation import (
    SETTLED_STATE,
    freeze_prediction,
    validate_registration,
)
from future_test_b_capture import ScheduledFixture, fixture_local_date, fixture_match_id


CAPTURE_VERSION = "M015_PROSPECTIVE_TARGET_CAPTURE_V0_1"
CANDIDATE_STATE = "MODEL_READY_MARKET_PENDING"
FROZEN_TARGET_STATE = "SIGNAL_FROZEN"


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


def _positive_decimal_odds(value: object, error: str) -> float:
    if not isinstance(value, (int, float)) or not isfinite(float(value)):
        raise ValueError(error)
    value = float(value)
    if value <= 1.0:
        raise ValueError(error)
    return value


def _score(record: Dict) -> Tuple[int, int]:
    result = record.get("result") or {}
    score = record.get("final_score") or {}
    if result.get("verified") is not True:
        raise ValueError("M015_TARGET_BASE_RESULT_NOT_VERIFIED")
    home = score.get("home")
    away = score.get("away")
    if not isinstance(home, int) or not isinstance(away, int) or home < 0 or away < 0:
        raise ValueError("M015_TARGET_BASE_SCORE_INVALID")
    return home, away


def _candidate_payload(candidate: Dict) -> Dict:
    payload = dict(candidate)
    payload.pop("candidate_fingerprint_sha256", None)
    return payload


def verify_candidate(candidate: Dict) -> bool:
    fingerprint = str(candidate.get("candidate_fingerprint_sha256") or "")
    if not fingerprint or candidate.get("capture_version") != CAPTURE_VERSION:
        return False
    if candidate.get("state") != CANDIDATE_STATE:
        return False
    return fingerprint == _hash(_candidate_payload(candidate))


def _registration_cutoff(registration: Dict) -> str:
    snapshot = registration.get("training_snapshot") or {}
    cutoff = str(snapshot.get("latest_match_date") or "")
    if not cutoff:
        raise ValueError("M015_TARGET_REGISTERED_TRAINING_CUTOFF_REQUIRED")
    return cutoff


def _validate_base_snapshot(
    registration: Dict,
    truth_store: Dict,
    gate2_backfill: Dict,
) -> Tuple[List[Match], List[Tuple[Dict, int]], List[str]]:
    validate_registration(registration)
    snapshot = registration.get("training_snapshot") or {}
    dataset_id = str(snapshot.get("dataset_id") or "")
    cutoff = _registration_cutoff(registration)

    if truth_store.get("dataset_id") != dataset_id:
        raise ValueError("M015_TARGET_BASE_DATASET_ID_MISMATCH")
    if gate2_backfill.get("source_dataset_id") != dataset_id:
        raise ValueError("M015_TARGET_GATE2_DATASET_ID_MISMATCH")
    if gate2_backfill.get("pipeline_version") != "GATE1_TO_GATE2_CANONICAL_BACKFILL_V0_1":
        raise ValueError("M015_TARGET_GATE2_PIPELINE_VERSION_MISMATCH")

    features = list(gate2_backfill.get("features", []))
    expected_feature_n = int(snapshot.get("gate2_feature_rows", -1))
    if expected_feature_n < 0 or len(features) != expected_feature_n:
        raise ValueError("M015_TARGET_REGISTERED_GATE2_FEATURE_COUNT_MISMATCH")
    if not features:
        raise ValueError("M015_TARGET_REGISTERED_GATE2_FEATURES_EMPTY")

    latest_feature_date = max(str(row.get("date") or "") for row in features)
    if latest_feature_date != cutoff:
        raise ValueError("M015_TARGET_REGISTERED_TRAINING_CUTOFF_MISMATCH")
    if any(str(row.get("date") or "") > cutoff for row in features):
        raise ValueError("M015_TARGET_POST_CUTOFF_BASE_FEATURE_FORBIDDEN")

    truth_by_id = {str(r.get("match_id")): r for r in truth_store.get("records", [])}
    training_pairs: List[Tuple[Dict, int]] = []
    usable_match_ids: List[str] = []
    for feature in sorted(features, key=lambda r: (str(r.get("date", "")), str(r.get("match_id", "")))):
        match_id = str(feature.get("match_id") or "")
        record = truth_by_id.get(match_id)
        if record is None:
            raise ValueError("M015_TARGET_BASE_TRUTH_RECORD_MISSING")
        if str(feature.get("date")) != str(record.get("canonical_match_date")):
            raise ValueError("M015_TARGET_BASE_DATE_IDENTITY_MISMATCH")
        if str(feature.get("home")) != str(record.get("home_team")):
            raise ValueError("M015_TARGET_BASE_HOME_IDENTITY_MISMATCH")
        if str(feature.get("away")) != str(record.get("away_team")):
            raise ValueError("M015_TARGET_BASE_AWAY_IDENTITY_MISMATCH")
        home_goals, away_goals = _score(record)
        try:
            gate2_model_mean(feature)
            gate2_component_totals(feature)
        except ValueError:
            continue
        training_pairs.append((feature, home_goals + away_goals))
        usable_match_ids.append(match_id)

    matches = matches_from_truth_store(truth_store)
    if not matches or max(m.date for m in matches) != cutoff:
        raise ValueError("M015_TARGET_BASE_MATCH_CUTOFF_MISMATCH")
    if any(m.date > cutoff for m in matches):
        raise ValueError("M015_TARGET_POST_CUTOFF_BASE_MATCH_FORBIDDEN")
    return matches, training_pairs, usable_match_ids


def _forward_rows_before_target(
    ledger: Dict,
    target_date: str,
) -> List[Dict]:
    rows: List[Dict] = []
    for entry in ledger.get("entries", []):
        if entry.get("state") != SETTLED_STATE:
            continue
        row_date = str(entry.get("canonical_match_date") or "")
        if not row_date:
            raise ValueError("M015_TARGET_SETTLED_ROW_CANONICAL_DATE_REQUIRED")
        # Frozen M015 semantics are date-batched: same-date outcomes cannot train
        # another prediction on that date, even if the earlier match has ended.
        if row_date >= target_date:
            continue
        rows.append(entry)
    return sorted(rows, key=lambda r: (str(r.get("canonical_match_date", "")), str(r.get("match_id", ""))))


def _forward_match(row: Dict) -> Match:
    home_team = str(row.get("home_team") or "")
    away_team = str(row.get("away_team") or "")
    if not home_team or not away_team:
        raise ValueError("M015_TARGET_SETTLED_ROW_TEAMS_REQUIRED")
    score = row.get("final_score") or {}
    home = score.get("home")
    away = score.get("away")
    if not isinstance(home, int) or not isinstance(away, int) or home < 0 or away < 0:
        raise ValueError("M015_TARGET_SETTLED_ROW_SCORE_INVALID")
    return Match(
        date=str(row["canonical_match_date"]),
        season=int(row.get("season") or 2026),
        league=str(row.get("league") or "MLS"),
        home=home_team,
        away=away_team,
        hg=home,
        ag=away,
        lineup_state="UNKNOWN",
        attacking_upgrade=False,
    )


def _forward_training_pair(row: Dict) -> Tuple[Dict, int]:
    snapshot = row.get("model_feature_snapshot")
    if not isinstance(snapshot, dict):
        raise ValueError("M015_TARGET_SETTLED_ROW_FEATURE_SNAPSHOT_REQUIRED")
    required = (
        "venue_home_lambda", "venue_away_lambda",
        "last10_home_lambda", "last10_away_lambda",
        "last5_home_lambda", "last5_away_lambda",
        "post_lineup_lambda",
    )
    if any(key not in snapshot for key in required):
        raise ValueError("M015_TARGET_SETTLED_ROW_FEATURE_SNAPSHOT_INCOMPLETE")
    gate2_model_mean(snapshot)
    gate2_component_totals(snapshot)
    total_goals = row.get("total_goals")
    if not isinstance(total_goals, int) or total_goals < 0:
        raise ValueError("M015_TARGET_SETTLED_ROW_TOTAL_GOALS_INVALID")
    return snapshot, total_goals


def _target_feature(history: Sequence[Match], fixture: ScheduledFixture) -> Dict:
    if fixture.is_settled:
        raise ValueError("M015_TARGET_FIXTURE_ALREADY_SETTLED")
    target_date = fixture_local_date(fixture)
    placeholder = Match(
        date=target_date,
        season=2026,
        league="MLS",
        home=fixture.home_team,
        away=fixture.away_team,
        hg=0,
        ag=0,
        lineup_state="UNKNOWN",
        attacking_upgrade=False,
    )
    features = build_features([*history, placeholder])
    row = features[-1]
    if row.date != target_date or row.home != fixture.home_team or row.away != fixture.away_team:
        raise ValueError("M015_TARGET_FEATURE_IDENTITY_LOST")
    payload = feature_row_to_dict(row)
    gate2_model_mean(payload)
    gate2_component_totals(payload)
    return payload


def prepare_target_candidate(
    *,
    registration: Dict,
    ledger: Dict,
    truth_store: Dict,
    gate2_backfill: Dict,
    fixture: ScheduledFixture,
    prepared_at: str,
    forbidden_match_ids: Iterable[str] = (),
) -> Dict:
    validate_registration(registration)
    validate_ledger(
        ledger,
        registration,
        forbidden_match_ids=forbidden_match_ids,
    )

    if str(registration.get("scope", {}).get("competition") or "").upper() != "MLS":
        raise ValueError("M015_TARGET_REGISTRATION_SCOPE_NOT_MLS")
    if fixture.is_settled:
        raise ValueError("M015_TARGET_FIXTURE_ALREADY_SETTLED")

    target_match_id = fixture_match_id(fixture)
    forbidden = {str(x) for x in forbidden_match_ids}
    if target_match_id in forbidden:
        raise ValueError("M015_TARGET_CONSUMED_HOLDOUT_OVERLAP")
    if any(str(e.get("match_id")) == target_match_id for e in ledger.get("entries", [])):
        raise ValueError("M015_TARGET_ALREADY_PRESENT_IN_LEDGER")

    registered_at = _dt(registration.get("registered_at"), "M015_TARGET_REGISTERED_AT_REQUIRED")
    kickoff_at = _dt(fixture.kickoff_at_utc, "M015_TARGET_KICKOFF_REQUIRED")
    prepared = _dt(prepared_at, "M015_TARGET_PREPARED_AT_REQUIRED")
    if kickoff_at <= registered_at:
        raise ValueError("M015_TARGET_KICKOFF_NOT_FUTURE_TO_REGISTRATION")
    if prepared <= registered_at:
        raise ValueError("M015_TARGET_PREPARATION_NOT_FUTURE_TO_REGISTRATION")
    if prepared >= kickoff_at:
        raise ValueError("M015_TARGET_PREPARATION_NOT_PRE_KICKOFF")

    target_date = fixture_local_date(fixture)
    cutoff = _registration_cutoff(registration)
    if target_date <= cutoff:
        raise ValueError("M015_TARGET_DATE_NOT_AFTER_REGISTERED_TRAINING_CUTOFF")

    base_matches, base_pairs, base_usable_ids = _validate_base_snapshot(
        registration,
        truth_store,
        gate2_backfill,
    )
    prior_forward_rows = _forward_rows_before_target(ledger, target_date)
    forward_matches = [_forward_match(row) for row in prior_forward_rows]
    forward_pairs = [_forward_training_pair(row) for row in prior_forward_rows]

    # All target features are built from the exact registered base corpus plus
    # legitimately settled, earlier-date forward-ledger rows only.
    history = [*base_matches, *forward_matches]
    feature = _target_feature(history, fixture)
    state = fit_glm([*base_pairs, *forward_pairs])
    model_mean = predict_mean(feature, state)
    model_probability = poisson_u35(model_mean)

    model_feature_snapshot = {
        "date": target_date,
        "home": fixture.home_team,
        "away": fixture.away_team,
        "home_prior_n": int(feature.get("home_prior_n", 0)),
        "away_prior_n": int(feature.get("away_prior_n", 0)),
        "venue_home_lambda": feature["venue_home_lambda"],
        "venue_away_lambda": feature["venue_away_lambda"],
        "last10_home_lambda": feature["last10_home_lambda"],
        "last10_away_lambda": feature["last10_away_lambda"],
        "last5_home_lambda": feature["last5_home_lambda"],
        "last5_away_lambda": feature["last5_away_lambda"],
        "post_lineup_lambda": feature["post_lineup_lambda"],
    }
    feature_snapshot_id = f"M015-FEATURE-{_hash(model_feature_snapshot)}"

    forward_training_ids = [str(row["match_id"]) for row in prior_forward_rows]
    training_state = {
        "model_id": MODEL_ID,
        "model_version": MODEL_VERSION,
        "specification_sha256": registration["specification_sha256"],
        "base_dataset_id": registration["training_snapshot"]["dataset_id"],
        "base_training_cutoff": cutoff,
        "base_usable_training_n": len(base_pairs),
        "base_usable_match_ids_sha256": _hash(sorted(base_usable_ids)),
        "forward_training_match_ids": forward_training_ids,
        "training_n": state.training_n,
        "coefficients": list(state.coefficients),
        "iterations": state.iterations,
        "converged": state.converged,
        "fallback_gate2": state.fallback_gate2,
    }
    training_state_fingerprint = _hash(training_state)

    candidate = {
        "capture_version": CAPTURE_VERSION,
        "state": CANDIDATE_STATE,
        "challenger_id": registration["challenger_id"],
        "model_id": MODEL_ID,
        "model_version": MODEL_VERSION,
        "specification_sha256": registration["specification_sha256"],
        "match_id": target_match_id,
        "league": "MLS",
        "season": 2026,
        "canonical_match_date": target_date,
        "home_team": fixture.home_team,
        "away_team": fixture.away_team,
        "kickoff_at": fixture.kickoff_at_utc,
        "prepared_at": prepared_at,
        "feature_snapshot_id": feature_snapshot_id,
        "model_feature_snapshot": model_feature_snapshot,
        "training_state_fingerprint": training_state_fingerprint,
        "training_state": training_state,
        "model_lambda": model_mean,
        "model_probability": model_probability,
        "market_probability": None,
        "market_snapshot": None,
        "governance": {
            "registered_base_training_snapshot_only": True,
            "post_registration_training_rows_from_settled_forward_ledger_only": True,
            "same_date_forward_outcomes_excluded": True,
            "current_fixture_outcome_not_available": True,
            "market_used_as_model_input": False,
            "market_state": "PENDING",
            "ledger_state": "NOT_APPENDED_UNTIL_MARKET_CAPTURE",
            "decision_weight": 0.0,
            "automatic_promotion": False,
        },
    }
    candidate["candidate_fingerprint_sha256"] = _hash(_candidate_payload(candidate))
    return candidate


def freeze_candidate_with_market(
    *,
    registration: Dict,
    ledger: Dict,
    candidate: Dict,
    market_snapshot: Dict,
    forbidden_match_ids: Iterable[str] = (),
) -> Dict:
    if not verify_candidate(candidate):
        raise ValueError("M015_TARGET_CANDIDATE_TAMPERED")
    validate_registration(registration)

    provider = str(market_snapshot.get("provider") or "").strip()
    source_type = str(market_snapshot.get("source_type") or "").strip()
    if not provider or not source_type:
        raise ValueError("M015_TARGET_MARKET_PROVENANCE_REQUIRED")
    if market_snapshot.get("is_verified") is not True:
        raise ValueError("M015_TARGET_VERIFIED_MARKET_REQUIRED")
    if market_snapshot.get("pair_same_provider") is not True:
        raise ValueError("M015_TARGET_SAME_PROVIDER_MARKET_PAIR_REQUIRED")
    if market_snapshot.get("direct_provider_observation") is not True:
        raise ValueError("M015_TARGET_DIRECT_PROVIDER_OBSERVATION_REQUIRED")
    o35 = _positive_decimal_odds(market_snapshot.get("o35"), "M015_TARGET_O35_ODDS_INVALID")
    u35 = _positive_decimal_odds(market_snapshot.get("u35"), "M015_TARGET_U35_ODDS_INVALID")
    observed_at = str(market_snapshot.get("observed_at") or "")
    fair_u35 = devig_u35(o35, u35)

    frozen = freeze_prediction(
        registration,
        {
            "match_id": candidate["match_id"],
            "league": candidate["league"],
            "model_id": candidate["model_id"],
            "model_version": candidate["model_version"],
            "specification_sha256": candidate["specification_sha256"],
            "feature_snapshot_id": candidate["feature_snapshot_id"],
            "training_state_fingerprint": candidate["training_state_fingerprint"],
            "kickoff_at": candidate["kickoff_at"],
            "prediction_frozen_at": candidate["prepared_at"],
            "market_observed_at": observed_at,
            "model_probability": candidate["model_probability"],
            "market_probability": fair_u35,
        },
        forbidden_match_ids=forbidden_match_ids,
    )

    # Enrich the immutable frozen record with the exact feature/training/provenance
    # needed to reconstruct future walk-forward training, then recompute the same
    # canonical prediction fingerprint used by the validation protocol.
    enriched_market = {
        "provider": provider,
        "source_type": source_type,
        "is_verified": True,
        "is_primary": bool(market_snapshot.get("is_primary", False)),
        "pair_same_provider": True,
        "direct_provider_observation": True,
        "observed_at": observed_at,
        "market": "O3.5/U3.5",
        "o35": o35,
        "u35": u35,
        "fair_u35_probability": fair_u35,
    }
    for optional in ("source_reference", "provider_event_id"):
        if market_snapshot.get(optional) is not None:
            enriched_market[optional] = market_snapshot[optional]

    frozen.update({
        "capture_version": CAPTURE_VERSION,
        "candidate_fingerprint_sha256": candidate["candidate_fingerprint_sha256"],
        "season": candidate["season"],
        "canonical_match_date": candidate["canonical_match_date"],
        "home_team": candidate["home_team"],
        "away_team": candidate["away_team"],
        "model_lambda": candidate["model_lambda"],
        "model_feature_snapshot": candidate["model_feature_snapshot"],
        "training_state": candidate["training_state"],
        "market_snapshot": enriched_market,
        "governance": {
            "candidate_model_probability_unchanged_by_market": True,
            "market_used_as_model_input": False,
            "market_used_as_benchmark_only": True,
            "prediction_frozen_pre_kickoff": True,
            "settlement_pending": True,
            "decision_weight": 0.0,
            "automatic_promotion": False,
        },
    })
    payload = dict(frozen)
    payload.pop("prediction_fingerprint_sha256", None)
    frozen["prediction_fingerprint_sha256"] = _hash(payload)

    updated_ledger = append_frozen_prediction(
        ledger,
        registration,
        frozen,
        forbidden_match_ids=forbidden_match_ids,
    )
    return {
        "capture_version": CAPTURE_VERSION,
        "state": FROZEN_TARGET_STATE,
        "frozen_prediction": frozen,
        "ledger": updated_ledger,
        "summary": {
            "match_id": candidate["match_id"],
            "model_probability": candidate["model_probability"],
            "market_probability": fair_u35,
            "ledger_pending_n": updated_ledger["summary"]["frozen_pending_settlement"],
            "ledger_settled_independent_n": updated_ledger["summary"]["settled_independent_n"],
        },
        "governance": {
            "independent_n_incremented": False,
            "reason": "FROZEN_PREDICTION_AWAITS_VERIFIED_POST_KICKOFF_SETTLEMENT",
            "decision_weight": 0.0,
            "automatic_promotion": False,
        },
    }
