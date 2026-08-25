from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate3"))
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from m015_forward_evidence_ledger import validate_ledger
from m015_forward_target_capture import freeze_candidate_with_market, verify_candidate

REGISTRATION = ROOT / "packages" / "gate4" / "data" / "m015-forward-registration-v0.1.json"
HOLDOUT = ROOT / "packages" / "gate4" / "data" / "mls-2026-evaluation-holdout-a-v0.1.json"
LEDGER = ROOT / "packages" / "gate4" / "data" / "m015-forward-evidence-ledger-v0.1.json"
CANDIDATE = ROOT / "packages" / "gate4" / "data" / "m015-first-real-forward-target-candidate-v0.1.json"
MARKET = ROOT / "packages" / "gate4" / "data" / "m015-seattle-chicago-caliente-market-v0.1.json"

EXPECTED_MATCH_ID = "MLS-2026-2026-08-29-089a841f1890"
EXPECTED_CANDIDATE_FINGERPRINT = "c0a8b21c0b059faff8621843e41891afd345ed1764528923bc7c4933c9283199"
EXPECTED_MODEL_PROBABILITY = 0.6512982350607462
EXPECTED_FAIR_U35 = 0.5821474773609314


def main() -> int:
    registration = json.loads(REGISTRATION.read_text(encoding="utf-8"))
    holdout = json.loads(HOLDOUT.read_text(encoding="utf-8"))
    ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
    candidate = json.loads(CANDIDATE.read_text(encoding="utf-8"))
    market = json.loads(MARKET.read_text(encoding="utf-8"))

    if not verify_candidate(candidate):
        raise RuntimeError("M015_SEA_CHI_CANDIDATE_FINGERPRINT_INVALID")
    if candidate["match_id"] != EXPECTED_MATCH_ID:
        raise RuntimeError("M015_SEA_CHI_MATCH_ID_MISMATCH")
    if candidate["candidate_fingerprint_sha256"] != EXPECTED_CANDIDATE_FINGERPRINT:
        raise RuntimeError("M015_SEA_CHI_CANDIDATE_CHANGED")
    if abs(float(candidate["model_probability"]) - EXPECTED_MODEL_PROBABILITY) > 1e-15:
        raise RuntimeError("M015_SEA_CHI_MODEL_PROBABILITY_CHANGED")
    if market["match_id"] != EXPECTED_MATCH_ID:
        raise RuntimeError("M015_SEA_CHI_MARKET_MATCH_ID_MISMATCH")
    if market["is_verified"] is not True:
        raise RuntimeError("M015_SEA_CHI_MARKET_NOT_VERIFIED")
    if market["observed_at"] >= candidate["kickoff_at"]:
        raise RuntimeError("M015_SEA_CHI_MARKET_NOT_PRE_KICKOFF")

    before = validate_ledger(
        ledger,
        registration,
        forbidden_match_ids=holdout["match_ids"],
    )
    if before["entry_n"] != 0:
        raise RuntimeError("M015_SEA_CHI_EXPECTED_EMPTY_CANONICAL_LEDGER")

    frozen = freeze_candidate_with_market(
        registration=registration,
        ledger=ledger,
        candidate=candidate,
        market_snapshot=market,
        forbidden_match_ids=holdout["match_ids"],
    )
    fp = frozen["frozen_prediction"]
    updated_ledger = frozen["ledger"]
    fair = float(frozen["summary"]["market_probability"])

    if abs(float(fp["model_probability"]) - EXPECTED_MODEL_PROBABILITY) > 1e-15:
        raise RuntimeError("M015_SEA_CHI_MODEL_PROBABILITY_MUTATED_BY_MARKET")
    if fp["candidate_fingerprint_sha256"] != EXPECTED_CANDIDATE_FINGERPRINT:
        raise RuntimeError("M015_SEA_CHI_CANDIDATE_FINGERPRINT_MUTATED")
    if abs(fair - EXPECTED_FAIR_U35) > 1e-15:
        raise RuntimeError("M015_SEA_CHI_DEVIG_PROBABILITY_MISMATCH")

    after = validate_ledger(
        updated_ledger,
        registration,
        forbidden_match_ids=holdout["match_ids"],
    )
    if after["entry_n"] != 1 or after["pending_n"] != 1 or after["settled_n"] != 0:
        raise RuntimeError("M015_SEA_CHI_FROZEN_LEDGER_COUNTS_INVALID")
    if after["evaluation"]["summary"]["independent_validation_n"] != 0:
        raise RuntimeError("M015_SEA_CHI_INDEPENDENT_N_INCREMENTED_PRE_SETTLEMENT")

    report = {
        "report_version": "M015_SEATTLE_CHICAGO_MARKET_FREEZE_V0_1",
        "state": "SIGNAL_FROZEN",
        "match_id": EXPECTED_MATCH_ID,
        "candidate_fingerprint_sha256": EXPECTED_CANDIDATE_FINGERPRINT,
        "prediction_fingerprint_sha256": fp["prediction_fingerprint_sha256"],
        "model_probability": fp["model_probability"],
        "market": fp["market_snapshot"],
        "devigged_u35_probability": fair,
        "ledger_after_freeze": {
            "entry_n": after["entry_n"],
            "pending_n": after["pending_n"],
            "settled_n": after["settled_n"],
            "independent_validation_n": after["evaluation"]["summary"]["independent_validation_n"],
            "validation_state": after["evaluation"]["validation_state"],
        },
        "governance": {
            "market_used_as_model_input": False,
            "candidate_probability_unchanged": True,
            "pre_kickoff_market_verified": True,
            "settlement_pending": True,
            "independent_n_incremented": False,
            "decision_weight": 0.0,
            "automatic_promotion": False,
        },
    }
    evidence = {
        "artifact": "M015_Seattle_Chicago_Caliente_Freeze_v0.1",
        "overall": {
            "TEST_EXECUTED": True,
            "FREEZE_VALID": True,
            "MODEL_PROBABILITY_UNCHANGED": True,
            "MARKET_BENCHMARK_ONLY": True,
            "LEDGER_PENDING_N": 1,
            "INDEPENDENT_N": 0,
        },
        "runtime": report,
    }

    out = ROOT / "artifacts" / "m015-seattle-chicago-market-freeze"
    out.mkdir(parents=True, exist_ok=True)
    (out / "REPORT.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (out / "FROZEN_PREDICTION.json").write_text(json.dumps(fp, indent=2), encoding="utf-8")
    (out / "LEDGER.json").write_text(json.dumps(updated_ledger, indent=2), encoding="utf-8")
    (out / "TEST_EVIDENCE.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")

    print(json.dumps({
        "state": report["state"],
        "match_id": report["match_id"],
        "model_probability": report["model_probability"],
        "devigged_u35_probability": report["devigged_u35_probability"],
        "prediction_fingerprint_sha256": report["prediction_fingerprint_sha256"],
        "ledger_after_freeze": report["ledger_after_freeze"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
