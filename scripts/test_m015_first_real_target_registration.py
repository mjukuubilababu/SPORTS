from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "packages" / "gate4" / "data" / "m015-first-real-target-registration-v0.1.json"
REGISTRATION = ROOT / "packages" / "gate4" / "data" / "m015-forward-registration-v0.1.json"
CANDIDATE = ROOT / "packages" / "gate4" / "data" / "m015-first-real-forward-target-candidate-v0.1.json"


def dt(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def main() -> int:
    target = json.loads(TARGET.read_text(encoding="utf-8"))
    registration = json.loads(REGISTRATION.read_text(encoding="utf-8"))
    candidate = json.loads(CANDIDATE.read_text(encoding="utf-8"))
    assert target["challenger_id"] == registration["challenger_id"] == candidate["challenger_id"]
    assert target["model_id"] == registration["model_id"] == candidate["model_id"]
    assert target["model_version"] == registration["model_version"] == candidate["model_version"]
    assert target["competition"] == candidate["league"] == "MLS"
    assert target["home_team"] == candidate["home_team"] == "seattle sounders"
    assert target["away_team"] == candidate["away_team"] == "chicago fire"
    assert target["target_source_row_id"] == "322"
    assert target["match_id"] == candidate["match_id"] == "MLS-2026-2026-08-29-089a841f1890"
    assert target["feature_snapshot_id"] == candidate["feature_snapshot_id"]
    assert target["training_state_fingerprint"] == candidate["training_state_fingerprint"]
    assert target["candidate_fingerprint_sha256"] == candidate["candidate_fingerprint_sha256"]
    assert target["model_lambda"] == candidate["model_lambda"]
    assert target["model_probability"] == candidate["model_probability"]
    assert target["state"] == "MODEL_CANDIDATE_CAPTURED_MARKET_PENDING"
    assert candidate["state"] == "MODEL_READY_MARKET_PENDING"
    assert dt(target["prepared_at"]) > dt(registration["registered_at"])
    assert dt(target["prepared_at"]) < dt(target["kickoff_at"])
    assert target["kickoff_at"] == candidate["kickoff_at"]
    assert target["market_state"] == "PENDING"
    assert candidate["market_probability"] is None
    assert candidate["market_snapshot"] is None
    assert target["ledger_state"] == "NOT_APPENDED_UNTIL_MARKET_CAPTURE"
    assert target["independent_n_incremented"] is False
    assert target["decision_weight"] == 0.0
    assert target["automatic_promotion"] is False
    print("M015_FIRST_REAL_TARGET_REGISTRATION_TEST=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
