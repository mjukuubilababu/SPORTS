from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "packages" / "gate4" / "data" / "m015-first-real-target-registration-v0.1.json"
REGISTRATION = ROOT / "packages" / "gate4" / "data" / "m015-forward-registration-v0.1.json"


def dt(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def main() -> int:
    target = json.loads(TARGET.read_text(encoding="utf-8"))
    registration = json.loads(REGISTRATION.read_text(encoding="utf-8"))
    assert target["challenger_id"] == registration["challenger_id"]
    assert target["model_id"] == registration["model_id"]
    assert target["model_version"] == registration["model_version"]
    assert target["competition"] == "MLS"
    assert target["home_team"] == "seattle sounders"
    assert target["away_team"] == "chicago fire"
    assert target["target_source_row_id"] == "322"
    assert dt(target["prepared_at"]) > dt(registration["registered_at"])
    assert dt(target["prepared_at"]) < dt(target["kickoff_at"])
    assert target["market_state"] == "PENDING"
    assert target["ledger_state"] == "NOT_APPENDED_UNTIL_MARKET_CAPTURE"
    assert target["independent_n_incremented"] is False
    assert target["decision_weight"] == 0.0
    assert target["automatic_promotion"] is False
    print("M015_FIRST_REAL_TARGET_REGISTRATION_TEST=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
