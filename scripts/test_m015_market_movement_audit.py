from __future__ import annotations

from copy import deepcopy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from m015_market_movement_audit import validate_market_path

CANDIDATE = ROOT / "packages" / "gate4" / "data" / "m015-first-real-forward-target-candidate-v0.1.json"
SNAPSHOT = ROOT / "packages" / "gate4" / "data" / "m015-first-real-forward-target-market-snapshot-v0.1.json"
LEDGER = ROOT / "packages" / "gate4" / "data" / "m015-forward-evidence-ledger-v0.1.json"
PATH = ROOT / "packages" / "gate4" / "data" / "m015-seattle-chicago-market-movement-v0.1.json"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def expect_error(fn, fragment: str) -> None:
    try:
        fn()
    except ValueError as exc:
        assert fragment in str(exc), (fragment, str(exc))
    else:
        raise AssertionError(f"Expected ValueError containing {fragment}")


def main() -> int:
    candidate, snapshot, ledger, path = load(CANDIDATE), load(SNAPSHOT), load(LEDGER), load(PATH)
    report = validate_market_path(path=path, candidate=candidate, frozen_snapshot=snapshot, forward_ledger=ledger)
    assert report["audit_valid"] is True
    assert report["observation_n"] == 1
    assert report["evaluation_benchmark_locked"] is True
    assert report["evaluation_benchmark_replaced"] is False
    assert report["forward_ledger_modified"] is False
    assert report["independent_n_incremented"] is False
    assert report["latest_context_fair_u35_probability"] < report["evaluation_benchmark_fair_u35_probability"]
    assert report["latest_context_model_market_gap"] > report["frozen_model_market_gap"]

    tampered = deepcopy(path)
    tampered["observations"][0]["u35"] = 1.70
    expect_error(
        lambda: validate_market_path(path=tampered, candidate=candidate, frozen_snapshot=snapshot, forward_ledger=ledger),
        "OBSERVATION_TAMPERED",
    )

    provider_swap = deepcopy(path)
    provider_swap["observations"][0]["provider"] = "OTHER_PROVIDER"
    # Fingerprint must be deliberately recomputed by an attacker before provider invariant is reached;
    # the stored immutable row itself must fail first.
    expect_error(
        lambda: validate_market_path(path=provider_swap, candidate=candidate, frozen_snapshot=snapshot, forward_ledger=ledger),
        "OBSERVATION_TAMPERED",
    )

    anchor_changed = deepcopy(snapshot)
    anchor_changed["u35"] = 1.60
    expect_error(
        lambda: validate_market_path(path=path, candidate=candidate, frozen_snapshot=anchor_changed, forward_ledger=ledger),
        "ANCHOR_DEVIG_MISMATCH",
    )

    post_kickoff = deepcopy(path)
    row = post_kickoff["observations"][0]
    row["observed_at"] = "2026-08-29T20:31:00Z"
    row.pop("observation_payload_sha256", None)
    import hashlib
    payload = json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    row["observation_payload_sha256"] = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    expect_error(
        lambda: validate_market_path(path=post_kickoff, candidate=candidate, frozen_snapshot=snapshot, forward_ledger=ledger),
        "POST_KICKOFF_OBSERVATION_FORBIDDEN",
    )

    print("M015_MARKET_MOVEMENT_AUDIT_TEST=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
