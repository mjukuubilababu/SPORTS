from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))
sys.path.insert(0, str(ROOT / "packages" / "gate2"))
sys.path.insert(0, str(ROOT / "packages" / "gate3"))
sys.path.insert(0, str(ROOT / "packages" / "gate4"))
sys.path.insert(0, str(ROOT / "scripts"))

from future_test_b_capture import (
    FIXTUREDOWNLOAD_UTC_CSV,
    fixture_match_id,
    parse_fixture_schedule_csv,
)
from m015_forward_target_capture import prepare_target_candidate, verify_candidate
from m015_forward_evidence_ledger import validate_ledger
from run_m015_walkforward import build_canonical_inputs
from run_real_2026_historical_research import _request

REGISTRATION = ROOT / "packages" / "gate4" / "data" / "m015-forward-registration-v0.1.json"
HOLDOUT = ROOT / "packages" / "gate4" / "data" / "mls-2026-evaluation-holdout-a-v0.1.json"
LEDGER = ROOT / "packages" / "gate4" / "data" / "m015-forward-evidence-ledger-v0.1.json"

CAPTURED_AT = "2026-08-25T00:42:00Z"
EXPECTED_SOURCE_ROW_ID = "322"
EXPECTED_KICKOFF = "2026-08-29T20:30:00Z"
EXPECTED_HOME = "seattle sounders"
EXPECTED_AWAY = "chicago fire"


def _dt(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def main() -> int:
    registration = json.loads(REGISTRATION.read_text(encoding="utf-8"))
    holdout = json.loads(HOLDOUT.read_text(encoding="utf-8"))
    ledger = json.loads(LEDGER.read_text(encoding="utf-8"))

    ledger_report = validate_ledger(
        ledger,
        registration,
        forbidden_match_ids=holdout["match_ids"],
    )
    if ledger_report["entry_n"] != 0:
        raise RuntimeError("M015_FIRST_TARGET_EXPECTED_EMPTY_LEDGER")

    fixture_bytes = _request(FIXTUREDOWNLOAD_UTC_CSV)
    fixture_sha256 = sha256(fixture_bytes).hexdigest()
    fixtures = parse_fixture_schedule_csv(fixture_bytes.decode("utf-8-sig"))
    registered_at = _dt(registration["registered_at"])
    future = sorted(
        [fixture for fixture in fixtures if _dt(fixture.kickoff_at_utc) > registered_at and not fixture.is_settled],
        key=lambda fixture: (_dt(fixture.kickoff_at_utc), fixture.source_row_id),
    )
    if not future:
        raise RuntimeError("M015_FIRST_TARGET_NO_POST_REGISTRATION_FIXTURE")

    target = future[0]
    if target.source_row_id != EXPECTED_SOURCE_ROW_ID:
        raise RuntimeError(f"M015_FIRST_TARGET_SOURCE_ROW_CHANGED:{target.source_row_id}")
    if target.kickoff_at_utc != EXPECTED_KICKOFF:
        raise RuntimeError(f"M015_FIRST_TARGET_KICKOFF_CHANGED:{target.kickoff_at_utc}")
    if target.home_team != EXPECTED_HOME or target.away_team != EXPECTED_AWAY:
        raise RuntimeError(
            f"M015_FIRST_TARGET_IDENTITY_CHANGED:{target.home_team}:{target.away_team}"
        )
    if _dt(CAPTURED_AT) <= registered_at or _dt(CAPTURED_AT) >= _dt(target.kickoff_at_utc):
        raise RuntimeError("M015_FIRST_TARGET_CAPTURE_TIME_INVALID")

    truth_store, gate2, sources = build_canonical_inputs()
    candidate = prepare_target_candidate(
        registration=registration,
        ledger=ledger,
        truth_store=truth_store,
        gate2_backfill=gate2,
        fixture=target,
        prepared_at=CAPTURED_AT,
        forbidden_match_ids=holdout["match_ids"],
    )
    if not verify_candidate(candidate):
        raise RuntimeError("M015_FIRST_TARGET_CANDIDATE_FINGERPRINT_INVALID")
    if candidate["state"] != "MODEL_READY_MARKET_PENDING":
        raise RuntimeError("M015_FIRST_TARGET_STATE_INVALID")
    if candidate["market_probability"] is not None or candidate["market_snapshot"] is not None:
        raise RuntimeError("M015_FIRST_TARGET_MARKET_MUST_REMAIN_PENDING")

    report = {
        "report_version": "M015_FIRST_REAL_FORWARD_TARGET_CAPTURE_V0_1",
        "capture_classification": "PROSPECTIVE_REAL_PRE_KICKOFF_MODEL_CANDIDATE",
        "fixture_source": {
            "provider": "FixtureDownload",
            "url": FIXTUREDOWNLOAD_UTC_CSV,
            "sha256": fixture_sha256,
            "source_row_id": target.source_row_id,
        },
        "target": {
            "match_id": fixture_match_id(target),
            "kickoff_at": target.kickoff_at_utc,
            "home_team": target.home_team,
            "away_team": target.away_team,
            "venue": target.venue,
            "prepared_at": CAPTURED_AT,
        },
        "candidate": candidate,
        "source_summaries": sources,
        "ledger_before_capture": {
            "entry_n": ledger_report["entry_n"],
            "pending_n": ledger_report["pending_n"],
            "settled_n": ledger_report["settled_n"],
            "independent_validation_n": ledger_report["evaluation"]["summary"]["independent_validation_n"],
        },
        "governance": {
            "real_fixture": True,
            "fixture_selected_as_earliest_post_registration_mls_fixture": True,
            "prediction_created_pre_kickoff": True,
            "market_not_used_as_model_input": True,
            "market_state": "PENDING",
            "not_appended_to_forward_ledger_without_market": True,
            "independent_n_incremented": False,
            "decision_weight": 0.0,
            "automatic_promotion": False,
        },
    }
    evidence = {
        "artifact": "M015_First_Real_Forward_Target_v0.1",
        "overall": {
            "TEST_EXECUTED": True,
            "TARGET_CAPTURED": True,
            "CANDIDATE_FINGERPRINT_VALID": True,
            "MARKET_PENDING": True,
            "LEDGER_UNCHANGED": True,
            "INDEPENDENT_N": 0,
        },
        "runtime": {
            "match_id": candidate["match_id"],
            "state": candidate["state"],
            "kickoff_at": candidate["kickoff_at"],
            "prepared_at": candidate["prepared_at"],
            "model_lambda": candidate["model_lambda"],
            "model_probability": candidate["model_probability"],
            "feature_snapshot_id": candidate["feature_snapshot_id"],
            "training_state_fingerprint": candidate["training_state_fingerprint"],
            "candidate_fingerprint_sha256": candidate["candidate_fingerprint_sha256"],
        },
    }

    report_path = ROOT / "artifacts" / "m015-first-real-forward-target-v0.1.json"
    evidence_path = ROOT / "artifacts" / "m015-first-real-target" / "TEST_EVIDENCE.json"
    candidate_path = ROOT / "artifacts" / "m015-first-real-target" / "CANDIDATE.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    evidence_path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    candidate_path.write_text(json.dumps(candidate, indent=2), encoding="utf-8")

    print(json.dumps({
        "target": report["target"],
        "candidate_state": candidate["state"],
        "model_lambda": candidate["model_lambda"],
        "model_probability": candidate["model_probability"],
        "candidate_fingerprint_sha256": candidate["candidate_fingerprint_sha256"],
        "training_state_fingerprint": candidate["training_state_fingerprint"],
        "ledger_independent_n": 0,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
