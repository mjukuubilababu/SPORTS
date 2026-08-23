from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
from math import isfinite
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


ACCUMULATOR_VERSION = "BLIND_FUTURE_TEST_SET_B_ACCUMULATOR_V0_1"
DEFAULT_TARGET_N = 100

# These metrics are deliberately unavailable before a cohort is frozen and a
# separate evaluation-release step is implemented. This module never computes them.
FORBIDDEN_INTERIM_METRICS = frozenset({
    "brier", "logloss", "hit_rate", "roi", "profit", "edge", "ev",
    "calibration_error", "champion", "leader", "win_rate", "model_rank",
})


def _iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _prob(value) -> bool:
    return isinstance(value, (int, float)) and isfinite(float(value)) and 0.0 <= float(value) <= 1.0


def _canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha256(value: object) -> str:
    return sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _looks_sha256(value: str) -> bool:
    value = str(value or "")
    return len(value) == 64 and all(char in "0123456789abcdef" for char in value.lower())


@dataclass(frozen=True)
class BlindCandidate:
    match_id: str
    competition: str
    kickoff_at: str

    prediction_snapshot_id: str
    prediction_snapshot_sha256: str
    prediction_frozen_at: str
    poisson_model_version: str
    poisson_probability_u35: float
    negbin_model_version: str
    negbin_specification_sha256: str
    negbin_probability_u35: float
    model_uses_market_odds: bool

    market_snapshot_id: str
    market_snapshot_sha256: str
    market_provider: str
    market_source: str
    market_source_url: str
    market_observed_at: str
    market_fair_probability_u35: float
    market_source_verified: bool
    closing_semantics_verified: bool

    regime_snapshot_id: str
    regime_snapshot_sha256: str
    regime_label: str
    regime_source: str
    regime_source_url: str
    regime_observed_at: str
    regime_verified: bool
    regime_uses_outcome: bool
    regime_uses_market_odds: bool

    settlement_source: str
    settlement_source_url: str
    settlement_verified: bool
    settled_at: str
    home_goals: int
    away_goals: int

    @property
    def outcome_u35(self) -> int:
        return 1 if self.home_goals + self.away_goals <= 3 else 0


@dataclass(frozen=True)
class CandidateDecision:
    match_id: str
    accepted: bool
    promotion_eligible: bool
    reasons: tuple[str, ...]
    record_sha256: Optional[str]


@dataclass(frozen=True)
class TestSetBFreeze:
    freeze_id: str
    accumulator_version: str
    challenger_model_version: str
    challenger_specification_sha256: str
    target_n: int
    frozen_at: str
    match_ids: tuple[str, ...]
    record_hashes: tuple[str, ...]
    cohort_fingerprint_sha256: str
    state: str = "FROZEN_READY_FOR_SEPARATE_ONE_TIME_EVALUATION"
    interim_metrics_exposed: bool = False
    evaluation_performed: bool = False


def candidate_from_mapping(raw: Dict) -> BlindCandidate:
    prediction = raw.get("prediction") or {}
    market = raw.get("market") or {}
    regime = raw.get("regime") or {}
    settlement = raw.get("settlement") or {}
    return BlindCandidate(
        match_id=str(raw.get("match_id") or ""),
        competition=str(raw.get("competition") or ""),
        kickoff_at=str(raw.get("kickoff_at") or ""),

        prediction_snapshot_id=str(prediction.get("snapshot_id") or ""),
        prediction_snapshot_sha256=str(prediction.get("snapshot_sha256") or ""),
        prediction_frozen_at=str(prediction.get("frozen_at") or ""),
        poisson_model_version=str(prediction.get("poisson_model_version") or ""),
        poisson_probability_u35=prediction.get("poisson_probability_u35"),
        negbin_model_version=str(prediction.get("negbin_model_version") or ""),
        negbin_specification_sha256=str(prediction.get("negbin_specification_sha256") or ""),
        negbin_probability_u35=prediction.get("negbin_probability_u35"),
        model_uses_market_odds=bool(prediction.get("uses_market_odds", False)),

        market_snapshot_id=str(market.get("snapshot_id") or ""),
        market_snapshot_sha256=str(market.get("snapshot_sha256") or ""),
        market_provider=str(market.get("provider") or ""),
        market_source=str(market.get("source") or ""),
        market_source_url=str(market.get("source_url") or ""),
        market_observed_at=str(market.get("observed_at") or ""),
        market_fair_probability_u35=market.get("fair_probability_u35"),
        market_source_verified=market.get("source_verified") is True,
        closing_semantics_verified=market.get("closing_semantics_verified") is True,

        regime_snapshot_id=str(regime.get("snapshot_id") or ""),
        regime_snapshot_sha256=str(regime.get("snapshot_sha256") or ""),
        regime_label=str(regime.get("label") or ""),
        regime_source=str(regime.get("source") or ""),
        regime_source_url=str(regime.get("source_url") or ""),
        regime_observed_at=str(regime.get("observed_at") or ""),
        regime_verified=regime.get("verified") is True,
        regime_uses_outcome=bool(regime.get("uses_outcome", False)),
        regime_uses_market_odds=bool(regime.get("uses_market_odds", False)),

        settlement_source=str(settlement.get("source") or ""),
        settlement_source_url=str(settlement.get("source_url") or ""),
        settlement_verified=settlement.get("verified") is True,
        settled_at=str(settlement.get("settled_at") or ""),
        home_goals=settlement.get("home_goals"),
        away_goals=settlement.get("away_goals"),
    )


def validate_candidate(
    candidate: BlindCandidate,
    *,
    registered_at: str,
    challenger_model_version: str,
    challenger_specification_sha256: str,
    forbidden_match_ids: Iterable[str],
) -> CandidateDecision:
    reasons: List[str] = []
    forbidden = {str(x) for x in forbidden_match_ids}

    if not candidate.match_id or not candidate.competition:
        reasons.append("MATCH_ID_AND_COMPETITION_REQUIRED")
    if candidate.match_id in forbidden:
        reasons.append("FROZEN_HOLDOUT_MATCH_REUSE_FORBIDDEN")

    try:
        registration_time = _iso(registered_at)
        kickoff = _iso(candidate.kickoff_at)
        prediction_time = _iso(candidate.prediction_frozen_at)
        market_time = _iso(candidate.market_observed_at)
        regime_time = _iso(candidate.regime_observed_at)
        settled_time = _iso(candidate.settled_at)
    except (TypeError, ValueError):
        reasons.append("TIMESTAMP_INVALID_OR_MISSING")
        registration_time = kickoff = prediction_time = market_time = regime_time = settled_time = None

    if registration_time is not None:
        if kickoff <= registration_time:
            reasons.append("MATCH_NOT_FUTURE_TO_CHALLENGER_REGISTRATION")
        if prediction_time <= registration_time:
            reasons.append("PREDICTION_NOT_CREATED_AFTER_PREREGISTRATION")
        if market_time <= registration_time:
            reasons.append("MARKET_OBSERVATION_NOT_CREATED_AFTER_PREREGISTRATION")
        if regime_time <= registration_time:
            reasons.append("REGIME_METADATA_NOT_CREATED_AFTER_PREREGISTRATION")
        if prediction_time >= kickoff:
            reasons.append("PREDICTION_NOT_FROZEN_PRE_KICKOFF")
        if market_time >= kickoff:
            reasons.append("MARKET_OBSERVATION_NOT_PRE_KICKOFF")
        if regime_time >= kickoff:
            reasons.append("REGIME_METADATA_NOT_FROZEN_PRE_KICKOFF")
        if settled_time <= kickoff:
            reasons.append("SETTLEMENT_NOT_POST_KICKOFF")

    if not candidate.prediction_snapshot_id or not _looks_sha256(candidate.prediction_snapshot_sha256):
        reasons.append("IMMUTABLE_PREDICTION_SNAPSHOT_ID_AND_SHA256_REQUIRED")
    if candidate.negbin_model_version != challenger_model_version:
        reasons.append("CHALLENGER_MODEL_VERSION_MISMATCH")
    if candidate.negbin_specification_sha256 != challenger_specification_sha256:
        reasons.append("CHALLENGER_SPECIFICATION_HASH_MISMATCH")
    if not candidate.poisson_model_version:
        reasons.append("POISSON_BASELINE_MODEL_VERSION_REQUIRED")
    if candidate.model_uses_market_odds:
        reasons.append("BOOKMAKER_ODDS_AS_MODEL_INPUT_FORBIDDEN")
    if not _prob(candidate.poisson_probability_u35) or not _prob(candidate.negbin_probability_u35):
        reasons.append("MODEL_PROBABILITY_INVALID")

    if not candidate.market_snapshot_id or not _looks_sha256(candidate.market_snapshot_sha256):
        reasons.append("IMMUTABLE_MARKET_SNAPSHOT_ID_AND_SHA256_REQUIRED")
    if not _prob(candidate.market_fair_probability_u35):
        reasons.append("MARKET_FAIR_PROBABILITY_INVALID")
    if not candidate.market_provider or not candidate.market_source or not candidate.market_source_url:
        reasons.append("MARKET_PROVENANCE_REQUIRED")
    if not candidate.market_source_verified:
        reasons.append("MARKET_SOURCE_NOT_VERIFIED")
    if not candidate.closing_semantics_verified:
        reasons.append("CLOSING_SEMANTICS_NOT_VERIFIED")

    if not candidate.regime_snapshot_id or not _looks_sha256(candidate.regime_snapshot_sha256):
        reasons.append("IMMUTABLE_REGIME_SNAPSHOT_ID_AND_SHA256_REQUIRED")
    if not candidate.regime_label or not candidate.regime_source or not candidate.regime_source_url:
        reasons.append("VERIFIED_REGIME_PROVENANCE_REQUIRED")
    if not candidate.regime_verified:
        reasons.append("REGIME_NOT_VERIFIED")
    if candidate.regime_uses_outcome:
        reasons.append("REGIME_DERIVED_FROM_OUTCOME_FORBIDDEN")
    if candidate.regime_uses_market_odds:
        reasons.append("REGIME_DERIVED_FROM_MARKET_FORBIDDEN")

    if not candidate.settlement_source or not candidate.settlement_source_url:
        reasons.append("SETTLEMENT_PROVENANCE_REQUIRED")
    if not candidate.settlement_verified:
        reasons.append("SETTLEMENT_NOT_VERIFIED")
    if not isinstance(candidate.home_goals, int) or candidate.home_goals < 0:
        reasons.append("HOME_GOALS_INVALID")
    if not isinstance(candidate.away_goals, int) or candidate.away_goals < 0:
        reasons.append("AWAY_GOALS_INVALID")

    accepted = not reasons
    return CandidateDecision(
        match_id=candidate.match_id,
        accepted=accepted,
        promotion_eligible=accepted,
        reasons=tuple(reasons),
        record_sha256=_sha256(asdict(candidate)) if accepted else None,
    )


def build_accumulator(
    raw_candidates: Sequence[Dict],
    *,
    registered_at: str,
    challenger_model_version: str,
    challenger_specification_sha256: str,
    forbidden_match_ids: Iterable[str],
    target_n: int = DEFAULT_TARGET_N,
) -> Dict:
    if target_n < DEFAULT_TARGET_N:
        raise ValueError(f"TEST_B_TARGET_BELOW_GATE4_MINIMUM:{target_n}<{DEFAULT_TARGET_N}")

    candidates = [candidate_from_mapping(raw) for raw in raw_candidates]
    decisions: List[CandidateDecision] = []
    accepted: List[Tuple[BlindCandidate, CandidateDecision]] = []
    seen = set()

    for candidate in candidates:
        if candidate.match_id in seen:
            decision = CandidateDecision(
                match_id=candidate.match_id,
                accepted=False,
                promotion_eligible=False,
                reasons=("DUPLICATE_MATCH_ID",),
                record_sha256=None,
            )
        else:
            seen.add(candidate.match_id)
            decision = validate_candidate(
                candidate,
                registered_at=registered_at,
                challenger_model_version=challenger_model_version,
                challenger_specification_sha256=challenger_specification_sha256,
                forbidden_match_ids=forbidden_match_ids,
            )
        decisions.append(decision)
        if decision.accepted:
            accepted.append((candidate, decision))

    accepted.sort(key=lambda pair: (_iso(pair[0].kickoff_at), pair[0].match_id))
    eligible_n = len(accepted)
    state = "READY_TO_FREEZE" if eligible_n >= target_n else "BLIND_ACCUMULATING"

    # Intentionally expose only counts and validation reasons before freeze.
    status = {
        "accumulator_version": ACCUMULATOR_VERSION,
        "state": state,
        "target_n": target_n,
        "promotion_eligible_n": eligible_n,
        "remaining_to_target": max(0, target_n - eligible_n),
        "received_n": len(candidates),
        "rejected_n": sum(1 for decision in decisions if not decision.accepted),
        "rejection_reason_counts": {},
        "interim_metrics_exposed": False,
        "evaluation_performed": False,
        "performance_claim": "NONE_BLIND_ACCUMULATION",
    }
    for decision in decisions:
        for reason in decision.reasons:
            status["rejection_reason_counts"][reason] = status["rejection_reason_counts"].get(reason, 0) + 1

    if FORBIDDEN_INTERIM_METRICS & set(status):
        raise RuntimeError("INTERIM_METRIC_LEAKAGE_IN_STATUS")

    return {
        "accumulator_version": ACCUMULATOR_VERSION,
        "registered_at": registered_at,
        "challenger_model_version": challenger_model_version,
        "challenger_specification_sha256": challenger_specification_sha256,
        "target_n": target_n,
        "status": status,
        # Internal auditable records are retained for the eventual freeze. This is
        # procedural blinding, not encryption. Analyst-facing progress MUST use
        # `blind_public_status()` rather than inspecting these records.
        "_accepted_records": [asdict(candidate) for candidate, _ in accepted],
        "_accepted_hashes": [decision.record_sha256 for _, decision in accepted],
        "_decisions": [asdict(decision) for decision in decisions],
        "governance": {
            "procedural_blind_not_cryptographic_encryption": True,
            "analyst_facing_progress_must_use_blind_public_status": True,
            "immutable_prediction_market_regime_snapshot_hashes_required": True,
            "verified_post_match_settlement_required": True,
            "no_interim_performance_metrics": True,
            "no_interim_model_ranking": True,
            "first_target_n_chronological_records_form_test_b": True,
            "post_target_rows_reserved_for_next_cohort": True,
            "separate_one_time_evaluation_required_after_freeze": True,
            "capital_effect": "NONE",
            "real_money": "NO",
        },
    }


def blind_public_status(accumulator: Dict) -> Dict:
    status = dict(accumulator.get("status") or {})
    if FORBIDDEN_INTERIM_METRICS & set(status):
        raise RuntimeError("INTERIM_METRIC_LEAKAGE_IN_STATUS")
    return status


def freeze_test_set_b(
    accumulator: Dict,
    *,
    freeze_id: str,
    frozen_at: str,
) -> TestSetBFreeze:
    if accumulator.get("accumulator_version") != ACCUMULATOR_VERSION:
        raise ValueError("UNSUPPORTED_ACCUMULATOR_VERSION")
    target_n = int(accumulator.get("target_n", 0))
    records = list(accumulator.get("_accepted_records") or [])
    hashes = list(accumulator.get("_accepted_hashes") or [])
    if len(records) < target_n or len(hashes) < target_n:
        raise ValueError(f"TEST_B_TARGET_NOT_REACHED:{len(records)}<{target_n}")
    if not freeze_id:
        raise ValueError("FREEZE_ID_REQUIRED")
    frozen_time = _iso(frozen_at)

    selected_records = records[:target_n]
    selected_hashes = hashes[:target_n]
    match_ids = tuple(record["match_id"] for record in selected_records)
    if len(set(match_ids)) != target_n:
        raise ValueError("TEST_B_MATCH_IDS_NOT_UNIQUE")
    latest_settlement = max(_iso(record["settled_at"]) for record in selected_records)
    if frozen_time <= latest_settlement:
        raise ValueError("TEST_B_FREEZE_MUST_FOLLOW_ALL_SELECTED_SETTLEMENTS")

    fingerprint_payload = {
        "freeze_id": freeze_id,
        "accumulator_version": ACCUMULATOR_VERSION,
        "challenger_model_version": accumulator["challenger_model_version"],
        "challenger_specification_sha256": accumulator["challenger_specification_sha256"],
        "target_n": target_n,
        "match_ids": match_ids,
        "record_hashes": selected_hashes,
    }
    return TestSetBFreeze(
        freeze_id=freeze_id,
        accumulator_version=ACCUMULATOR_VERSION,
        challenger_model_version=accumulator["challenger_model_version"],
        challenger_specification_sha256=accumulator["challenger_specification_sha256"],
        target_n=target_n,
        frozen_at=frozen_at,
        match_ids=match_ids,
        record_hashes=tuple(selected_hashes),
        cohort_fingerprint_sha256=_sha256(fingerprint_payload),
    )


def freeze_to_dict(freeze: TestSetBFreeze) -> Dict:
    return asdict(freeze)
