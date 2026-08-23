from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from hashlib import sha256
import json
from typing import Dict, Iterable, List, Optional, Set


PROTOCOL_VERSION = "EVALUATION_FREEZE_CHALLENGER_PROTOCOL_V0_1"


def _canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha256_json(value: object) -> str:
    return sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


@dataclass(frozen=True)
class EvaluationFreeze:
    freeze_id: str
    dataset_id: str
    source_reference_git_blob_sha: str
    workflow_run_id: int
    workflow_artifact_digest: str
    verified_head_sha: str
    research_n: int
    strict_p002_n: int
    frozen_at: str
    fingerprint_sha256: str
    state: str = "FROZEN_EVALUATION_USED"
    tuning_reuse_allowed: bool = False
    promotion_reuse_allowed: bool = False


@dataclass(frozen=True)
class ChallengerRegistration:
    challenger_id: str
    model_version: str
    registered_at: str
    training_data_ids: tuple[str, ...]
    training_cutoff: str
    specification_sha256: str
    forbidden_evaluation_set_ids: tuple[str, ...]
    state: str = "PRE_REGISTERED_UNEVALUATED"


def freeze_reference(
    reference: Dict,
    *,
    freeze_id: str,
    source_reference_git_blob_sha: str,
    frozen_at: str,
) -> EvaluationFreeze:
    if not freeze_id:
        raise ValueError("FREEZE_ID_REQUIRED")
    if reference.get("workflow", {}).get("conclusion") != "success":
        raise ValueError("REFERENCE_WORKFLOW_NOT_SUCCESS")
    if int(reference.get("headline", {}).get("research_n", 0)) <= 0:
        raise ValueError("REFERENCE_RESEARCH_SAMPLE_EMPTY")
    if not source_reference_git_blob_sha:
        raise ValueError("SOURCE_REFERENCE_BLOB_SHA_REQUIRED")

    workflow = reference["workflow"]
    headline = reference["headline"]
    fingerprint_payload = {
        "freeze_id": freeze_id,
        "dataset_id": reference["dataset_id"],
        "source_reference_git_blob_sha": source_reference_git_blob_sha,
        "workflow_run_id": workflow["run_id"],
        "workflow_artifact_digest": workflow["artifact_digest"],
        "verified_head_sha": workflow["head_sha"],
        "research_n": headline["research_n"],
        "strict_p002_n": headline["strict_p002_n"],
        "headline": headline,
        "interpretation": reference.get("interpretation"),
    }
    return EvaluationFreeze(
        freeze_id=freeze_id,
        dataset_id=reference["dataset_id"],
        source_reference_git_blob_sha=source_reference_git_blob_sha,
        workflow_run_id=int(workflow["run_id"]),
        workflow_artifact_digest=str(workflow["artifact_digest"]),
        verified_head_sha=str(workflow["head_sha"]),
        research_n=int(headline["research_n"]),
        strict_p002_n=int(headline["strict_p002_n"]),
        frozen_at=frozen_at,
        fingerprint_sha256=_sha256_json(fingerprint_payload),
    )


def register_challenger(
    specification: Dict,
    *,
    registered_at: str,
    training_data_ids: Iterable[str],
    training_cutoff: str,
    frozen_evaluations: Iterable[EvaluationFreeze],
) -> ChallengerRegistration:
    challenger_id = str(specification.get("challenger_id") or "").strip()
    model_version = str(specification.get("model_version") or "").strip()
    if not challenger_id or not model_version:
        raise ValueError("CHALLENGER_ID_AND_MODEL_VERSION_REQUIRED")

    ids = tuple(sorted({str(x) for x in training_data_ids if str(x)}))
    if not ids:
        raise ValueError("TRAINING_DATA_ID_REQUIRED")

    freezes = tuple(frozen_evaluations)
    forbidden: Set[str] = set()
    for freeze in freezes:
        forbidden.add(freeze.freeze_id)
        forbidden.add(freeze.dataset_id)
    overlap = sorted(set(ids) & forbidden)
    if overlap:
        raise ValueError(f"FROZEN_EVALUATION_REUSED_FOR_TUNING:{','.join(overlap)}")

    _iso(registered_at)
    _iso(training_cutoff)
    return ChallengerRegistration(
        challenger_id=challenger_id,
        model_version=model_version,
        registered_at=registered_at,
        training_data_ids=ids,
        training_cutoff=training_cutoff,
        specification_sha256=_sha256_json(specification),
        forbidden_evaluation_set_ids=tuple(sorted(forbidden)),
    )


def verify_registration_unchanged(registration: ChallengerRegistration, specification: Dict) -> bool:
    return registration.specification_sha256 == _sha256_json(specification)


def evaluation_permission(
    registration: ChallengerRegistration,
    evaluation_set: Dict,
    *,
    frozen_evaluations: Iterable[EvaluationFreeze],
) -> Dict[str, object]:
    reasons: List[str] = []
    evaluation_id = str(evaluation_set.get("evaluation_set_id") or "")
    dataset_id = str(evaluation_set.get("dataset_id") or "")
    captured_after = str(evaluation_set.get("captured_after") or "")
    if not evaluation_id or not dataset_id or not captured_after:
        reasons.append("EVALUATION_ID_DATASET_AND_CAPTURE_TIME_REQUIRED")

    frozen_ids = set(registration.forbidden_evaluation_set_ids)
    for freeze in frozen_evaluations:
        frozen_ids.update((freeze.freeze_id, freeze.dataset_id))
    if evaluation_id in frozen_ids or dataset_id in frozen_ids:
        reasons.append("FROZEN_EVALUATION_SET_REUSE_FORBIDDEN")

    if captured_after:
        if _iso(captured_after) <= _iso(registration.registered_at):
            reasons.append("EVALUATION_DATA_NOT_FUTURE_TO_PREREGISTRATION")

    match_ids = {str(x) for x in evaluation_set.get("match_ids", []) if str(x)}
    frozen_match_ids = {
        str(x)
        for freeze in frozen_evaluations
        for x in evaluation_set.get("known_frozen_match_ids", {}).get(freeze.freeze_id, [])
        if str(x)
    }
    if match_ids & frozen_match_ids:
        reasons.append("MATCH_LEVEL_HOLDOUT_OVERLAP")

    return {
        "protocol_version": PROTOCOL_VERSION,
        "challenger_id": registration.challenger_id,
        "model_version": registration.model_version,
        "evaluation_set_id": evaluation_id or None,
        "allowed": not reasons,
        "reasons": reasons,
        "promotion_allowed_if_metrics_pass": not reasons,
        "registration": asdict(registration),
    }


def freeze_to_dict(freeze: EvaluationFreeze) -> Dict:
    return asdict(freeze)


def registration_to_dict(registration: ChallengerRegistration) -> Dict:
    return asdict(registration)
