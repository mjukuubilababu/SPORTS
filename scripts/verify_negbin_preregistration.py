from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from evaluation_freeze import EvaluationFreeze, register_challenger, verify_registration_unchanged

PREREG = ROOT / "packages" / "gate4" / "data" / "negbin-challenger-preregistration-v0.1.json"
HOLDOUT = ROOT / "packages" / "gate4" / "data" / "mls-2026-evaluation-holdout-a-v0.1.json"


def canonical_hash(value: object) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def load_freeze(raw: dict) -> EvaluationFreeze:
    workflow = raw["workflow"]
    return EvaluationFreeze(
        freeze_id=raw["freeze_id"],
        dataset_id=raw["dataset_id"],
        source_reference_git_blob_sha=raw["source_reference_git_blob_sha"],
        workflow_run_id=int(workflow["run_id"]),
        workflow_artifact_digest=workflow["artifact_digest"],
        verified_head_sha=workflow["verified_head_sha"],
        research_n=int(raw["research_n"]),
        strict_p002_n=int(raw["strict_p002_n"]),
        match_ids=tuple(sorted(raw["match_ids"])),
        frozen_at=raw["frozen_at"],
        fingerprint_sha256=raw["fingerprint_sha256"],
        state=raw["state"],
        tuning_reuse_allowed=bool(raw["tuning_reuse_allowed"]),
        promotion_reuse_allowed=bool(raw["promotion_reuse_allowed"]),
    )


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/verify_negbin_preregistration.py training_report.json")

    fresh = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    prereg = json.loads(PREREG.read_text(encoding="utf-8"))
    holdout_raw = json.loads(HOLDOUT.read_text(encoding="utf-8"))
    freeze = load_freeze(holdout_raw)

    assert fresh["evaluation"]["holdout_a_evaluated"] is False
    assert fresh["evaluation"]["test_set_b_evaluated"] is False
    assert fresh["training"]["holdout_a_overlap_n"] == 0
    assert fresh["training"]["uses_market_odds"] is False
    assert fresh["training"]["uses_holdout_a"] is False

    assert fresh["training_dataset_id"] == prereg["training"]["dataset_id"]
    assert fresh["training"]["n"] == prereg["training"]["training_n"] == 117
    assert fresh["training"]["date_start"] == prereg["training"]["date_start"]
    assert fresh["training"]["date_end"] == prereg["training"]["date_end"]
    assert fresh["training"]["match_ids"] == prereg["training"]["match_ids"]
    assert len(set(prereg["training"]["match_ids"])) == 117
    assert not (set(prereg["training"]["match_ids"]) & set(holdout_raw["match_ids"]))

    fresh_fit = fresh["fit"]
    assert fresh_fit["dispersion_r"] == prereg["training"]["dispersion_r"]
    assert fresh_fit["fit_method"] == prereg["training"]["fit_method"]
    assert fresh_fit["boundary_warning"] is False
    assert fresh_fit["training_n"] == 117

    fresh_spec = fresh["challenger_specification"]
    assert fresh_spec == prereg["challenger_specification"]
    assert canonical_hash(fresh_spec) == prereg["specification_sha256"]

    source_audit = fresh["source_audit"]
    assert source_audit["mlsopenskill"]["verified"] is True
    assert source_audit["openfootball"]["verified"] is True
    assert source_audit["mlsopenskill"]["actual_git_blob_sha1"] == prereg["training"]["source_git_blobs"]["mlsopenskill"]
    assert source_audit["openfootball"]["actual_git_blob_sha1"] == prereg["training"]["source_git_blobs"]["openfootball"]

    assert iso(prereg["registered_at"]) > iso(prereg["training"]["workflow"]["artifact_created_at"])

    registration = register_challenger(
        fresh_spec,
        registered_at=prereg["registered_at"],
        training_data_ids=[prereg["training"]["dataset_id"]],
        training_match_ids=prereg["training"]["match_ids"],
        training_cutoff=prereg["training"]["training_cutoff"],
        frozen_evaluations=[freeze],
    )
    assert registration.state == "PRE_REGISTERED_UNEVALUATED"
    assert verify_registration_unchanged(registration, fresh_spec) is True
    assert registration.specification_sha256 == prereg["specification_sha256"]
    assert list(registration.forbidden_evaluation_set_ids) == prereg["forbidden_evaluation_set_ids"]
    assert list(registration.forbidden_match_ids) == prereg["forbidden_holdout_a_match_ids"]

    assert prereg["evaluation"]["holdout_a_evaluated"] is False
    assert prereg["evaluation"]["test_set_b_evaluated"] is False
    assert prereg["evaluation"]["performance_claim"] == "NONE_TRAINING_ONLY"

    print(json.dumps({
        "verification": "NEGBIN_PREREGISTRATION=PASS",
        "model_version": fresh_spec["model_version"],
        "training_n": fresh["training"]["n"],
        "dispersion_r": fresh_fit["dispersion_r"],
        "specification_sha256": prereg["specification_sha256"],
        "holdout_a_evaluated": False,
        "test_set_b_evaluated": False,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
