from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate2"))
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from operational_closing_benchmark import (
    MAX_SECONDS_BEFORE_KICKOFF, POLICY_EFFECTIVE_AT, SEMANTICS_ID,
    OperationalCloseObservation, attach_operational_close,
    observation_sha256, policy_manifest, validate_operational_close,
)


def prematch() -> dict:
    return {
        "state":"PREMATCH_FROZEN", "match_id":"MLS-2026-2026-08-23-test", "competition":"MLS",
        "kickoff_at":"2026-08-23T20:30:00Z", "record_sha256":"4"*64,
        "prediction": {"frozen_at":"2026-08-23T16:08:52Z"},
        "market":None, "settlement":None, "test_b_eligible":False,
    }


def observation(observed_at: str = "2026-08-23T20:25:00Z", **changes) -> OperationalCloseObservation:
    raw = {"provider":"1xBet","market":"O/U 3.5","over":2.60,"under":1.48,"observed_at":observed_at}
    values = dict(
        match_id="MLS-2026-2026-08-23-test", kickoff_at="2026-08-23T20:30:00Z",
        observed_at=observed_at, provider="1xBet", source="ExampleAggregator",
        source_url="https://example.test/market", source_class="APPROVED_ODDS_AGGREGATOR_PROVIDER_PAIR",
        over35_odds=2.60, under35_odds=1.48, source_verified=True,
        same_provider_two_sided=True, raw_observation_sha256=observation_sha256(raw),
    )
    values.update(changes)
    return OperationalCloseObservation(**values)


def main() -> int:
    assert POLICY_EFFECTIVE_AT == "2026-08-23T17:00:00Z"
    assert MAX_SECONDS_BEFORE_KICKOFF == 300
    manifest = policy_manifest()
    assert manifest["true_final_exchange_or_bookmaker_close_claimed"] is False
    assert manifest["max_seconds_before_kickoff"] == 300

    accepted = validate_operational_close(observation())
    assert accepted.accepted is True
    assert accepted.semantics_id == SEMANTICS_ID
    assert accepted.seconds_before_kickoff == 300.0

    at_one_second = validate_operational_close(observation("2026-08-23T20:29:59Z"))
    assert at_one_second.accepted is True and at_one_second.seconds_before_kickoff == 1.0

    early = validate_operational_close(observation("2026-08-23T20:24:59Z"))
    assert early.accepted is False and "OBSERVATION_OUTSIDE_OPERATIONAL_CLOSE_WINDOW" in early.reasons
    post = validate_operational_close(observation("2026-08-23T20:30:00Z"))
    assert post.accepted is False and "OBSERVATION_OUTSIDE_OPERATIONAL_CLOSE_WINDOW" in post.reasons
    mixed = validate_operational_close(observation(same_provider_two_sided=False))
    assert mixed.accepted is False and "O35_U35_MUST_USE_SAME_PROVIDER" in mixed.reasons
    weak_source = validate_operational_close(observation(source_verified=False))
    assert weak_source.accepted is False and "SOURCE_NOT_VERIFIED" in weak_source.reasons
    bad_hash = validate_operational_close(observation(raw_observation_sha256="bad"))
    assert bad_hash.accepted is False and "RAW_OBSERVATION_SHA256_REQUIRED" in bad_hash.reasons

    priced = attach_operational_close(prematch(), observation())
    assert priced["state"] == "CLOSING_MARKET_CAPTURED"
    assert priced["market"]["closing_semantics_id"] == SEMANTICS_ID
    assert priced["market"]["seconds_before_kickoff"] == 300.0
    assert priced["market"]["source_observation_sha256"] == observation().raw_observation_sha256
    assert priced["test_b_eligible"] is False

    print("OPERATIONAL_CLOSING_BENCHMARK=PASS")
    return 0


if __name__ == "__main__": raise SystemExit(main())
