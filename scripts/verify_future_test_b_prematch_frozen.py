from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "packages" / "gate4" / "data" / "mls-2026-test-b-prematch-frozen-2026-08-23.json"
PREREG = ROOT / "packages" / "gate4" / "data" / "negbin-challenger-preregistration-v0.1.json"


def canonical_hash(value: object) -> str:
    text = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return sha256(text.encode("utf-8")).hexdigest()


def iso(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def verify_child_hash(payload: dict, field: str = "snapshot_sha256") -> None:
    expected = payload[field]
    body = deepcopy(payload)
    body.pop(field)
    actual = canonical_hash(body)
    assert actual == expected, (expected, actual)


def main() -> int:
    batch = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    prereg = json.loads(PREREG.read_text(encoding="utf-8"))
    assert batch["batch_version"] == "FUTURE_TEST_B_PREMATCH_CAPTURE_V0_1"
    assert batch["summary"] == {"prematch_frozen": 2, "test_b_eligible": 0}
    assert batch["performance_metrics_exposed"] is False
    assert batch["ci_evidence"]["conclusion"] == "SUCCESS"
    assert batch["ci_evidence"]["unified_tests"] == "20/20 PASS"

    registered = iso(prereg["registered_at"])
    records = batch["records"]
    assert len(records) == 2
    assert len({row["match_id"] for row in records}) == 2

    for row in records:
        assert row["state"] == "PREMATCH_FROZEN"
        assert row["market"] is None
        assert row["settlement"] is None
        assert row["test_b_eligible"] is False
        assert row["next_required_state"] == "CLOSING_MARKET_CAPTURED"
        assert row["prediction"]["uses_market_odds"] is False
        assert row["prediction"]["negbin_model_version"] == prereg["challenger_specification"]["model_version"]
        assert row["prediction"]["negbin_specification_sha256"] == prereg["specification_sha256"]
        frozen = iso(row["prediction"]["frozen_at"])
        kickoff = iso(row["kickoff_at"])
        assert registered < frozen < kickoff
        assert iso(row["regime"]["observed_at"]) < kickoff
        assert row["regime"]["uses_outcome"] is False
        assert row["regime"]["uses_market_odds"] is False
        verify_child_hash(row["prediction"])
        verify_child_hash(row["regime"])
        expected_record = row["record_sha256"]
        body = deepcopy(row)
        body.pop("record_sha256")
        assert canonical_hash(body) == expected_record

    ids = {row["match_id"] for row in records}
    assert ids == {
        "MLS-2026-2026-08-23-974daa85d59a",
        "MLS-2026-2026-08-23-ad6bd99a845b",
    }
    print("FUTURE_TEST_B_PREMATCH_FROZEN=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
