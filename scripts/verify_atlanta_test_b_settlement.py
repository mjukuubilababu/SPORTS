from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate2"))
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from blind_test_set import build_accumulator, blind_public_status
from future_test_b_transition import attach_verified_settlement, to_blind_candidate

CLOSING = ROOT / "packages" / "gate4" / "data" / "mls-2026-test-b-closing-market-atlanta-skc-2026-08-23.json"
SETTLEMENT = ROOT / "packages" / "gate4" / "data" / "mls-2026-test-b-settlement-atlanta-skc-2026-08-24.json"
CANDIDATE = ROOT / "packages" / "gate4" / "data" / "mls-2026-test-b-candidate-atlanta-skc-2026-08-23.json"
PREREG = ROOT / "packages" / "gate4" / "data" / "negbin-challenger-preregistration-v0.1.json"
HOLDOUT = ROOT / "packages" / "gate4" / "data" / "mls-2026-evaluation-holdout-a-v0.1.json"


def main() -> int:
    closing = json.loads(CLOSING.read_text(encoding="utf-8"))
    artifact = json.loads(SETTLEMENT.read_text(encoding="utf-8"))
    candidate_payload = json.loads(CANDIDATE.read_text(encoding="utf-8"))
    prereg = json.loads(PREREG.read_text(encoding="utf-8"))
    holdout = json.loads(HOLDOUT.read_text(encoding="utf-8"))

    assert closing["capture_status"] == "ACCEPTED"
    priced = closing["transitioned_record"]
    assert priced["state"] == "CLOSING_MARKET_CAPTURED"
    assert priced["record_sha256"] == "d8ad6b51e53285256c0073935c28b894afa19fea0361a41058962c40057445e8"

    expected = attach_verified_settlement(
        priced,
        source="Sporting Kansas City official match recap",
        source_url="https://www.sportingkc.com/news/latest/",
        verified=True,
        settled_at="2026-08-24T17:52:06Z",
        home_goals=2,
        away_goals=1,
    )
    assert expected == artifact["settled_record"]
    assert expected["state"] == "SETTLED_ELIGIBLE"
    assert expected["test_b_eligible"] is True
    assert expected["parent_record_sha256"] == priced["record_sha256"]
    assert expected["record_sha256"] == "0dd085d3bcdcb12130584b8e9b41f781fa7a0ac267658165727cbbbfa69c0940"
    assert expected["settlement"]["snapshot_sha256"] == "1447d1b522604db9342e3c8b88cfcdc9e77b3f951ec011e2e6963233b78aa4cf"

    candidate = to_blind_candidate(expected)
    assert candidate_payload == {"records": [candidate]}

    accumulator = build_accumulator(
        [candidate],
        registered_at=prereg["registered_at"],
        challenger_model_version=prereg["challenger_specification"]["model_version"],
        challenger_specification_sha256=prereg["specification_sha256"],
        forbidden_match_ids=holdout["match_ids"],
        target_n=100,
    )
    public = blind_public_status(accumulator)
    assert public["received_n"] == 1
    assert public["promotion_eligible_n"] == 1
    assert public["remaining_to_target"] == 99
    assert public["rejected_n"] == 0
    assert public["interim_metrics_exposed"] is False
    assert public["evaluation_performed"] is False

    print(json.dumps({
        "status": "ATLANTA_TEST_B_SETTLEMENT=PASS",
        "match_id": expected["match_id"],
        "state": expected["state"],
        "final_score": "2-1",
        "test_b_eligible": expected["test_b_eligible"],
        "promotion_eligible_n": public["promotion_eligible_n"],
        "remaining_to_target": public["remaining_to_target"],
        "performance_metrics_exposed": False,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
