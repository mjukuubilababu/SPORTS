from __future__ import annotations

import tempfile
from pathlib import Path

from write_api_football_runtime_evidence import SUCCESS_STATES, build_evidence, write_evidence


BASE = {
    "run_id": "123456",
    "run_attempt": "1",
    "trigger_event": "push",
    "repository": "mjukuubilababu/SPORTS",
    "ref_name": "import/decision-intelligence-v0.5-qualified-set",
    "commit_sha": "a" * 40,
}


def runtime(live_n=0):
    return {
        "capability": "API_FOOTBALL_LIVE_PROVIDER_V0_1",
        "observed_at": "2026-08-25T00:30:00Z",
        "rows_n": max(1, live_n),
        "live_in_play_n": live_n,
    }


def unified():
    return {
        "core_integrated_assurance": "PROMOTE",
        "full_platform_assurance": "PROMOTE",
        "capital_assurance": "LOCKED",
        "tests_total": 29,
        "tests_passed": 29,
    }


def evidence(**overrides):
    kwargs = {
        "credential_available": True,
        "provider_fetch_outcome": "success",
        "artifact_verify_outcome": "success",
        "unified_outcome": "success",
        "runtime_artifact": runtime(),
        "unified_report": unified(),
        **BASE,
    }
    kwargs.update(overrides)
    return build_evidence(**kwargs)


def expect_error(fn, fragment):
    try:
        fn()
    except ValueError as exc:
        assert fragment in str(exc), (fragment, str(exc))
    else:
        raise AssertionError(fragment)


def main() -> int:
    zero = evidence()
    assert zero["state"] == "VERIFIED_AUTHENTICATED_PROVIDER_RUNTIME_ZERO_LIVE"
    assert zero["state"] in SUCCESS_STATES
    assert zero["provider_evidence"]["live_match_captured"] is False
    assert zero["governance"]["api_key_persisted"] is False
    assert zero["governance"]["provider_payload_persisted_to_repository"] is False

    live = evidence(runtime_artifact=runtime(2))
    assert live["state"] == "VERIFIED_AUTHENTICATED_PROVIDER_RUNTIME_WITH_LIVE_CAPTURE"
    assert live["provider_evidence"]["live_match_captured"] is True

    missing = evidence(
        credential_available=False,
        provider_fetch_outcome="skipped",
        artifact_verify_outcome="skipped",
        runtime_artifact=None,
    )
    assert missing["state"] == "BLOCKED_CREDENTIAL_NOT_CONFIGURED"
    assert missing["failure_class"] == "CREDENTIAL"
    assert missing["assurance"]["capital_assurance"] == "LOCKED"

    provider_failure = evidence(
        provider_fetch_outcome="failure",
        artifact_verify_outcome="skipped",
        runtime_artifact=None,
    )
    assert provider_failure["state"] == "PROVIDER_FETCH_FAILED"
    assert provider_failure["failure_class"] == "PROVIDER_NETWORK_OR_AUTH"

    artifact_failure = evidence(artifact_verify_outcome="failure")
    assert artifact_failure["state"] == "ARTIFACT_VERIFICATION_FAILED"

    assurance_failure = evidence(unified_outcome="failure")
    assert assurance_failure["state"] == "UNIFIED_ASSURANCE_FAILED"

    bad_capital = unified()
    bad_capital["capital_assurance"] = "UNLOCKED"
    expect_error(lambda: evidence(unified_report=bad_capital), "CAPITAL_MUST_REMAIN_LOCKED")
    expect_error(lambda: evidence(ref_name="main"), "NON_CANONICAL_REF")

    with tempfile.TemporaryDirectory() as temp:
        run_path, latest_path = write_evidence(zero, temp)
        assert run_path.name == "123456.json"
        assert latest_path.name == "latest.json"
        assert run_path.exists() and latest_path.exists()
        text = latest_path.read_text()
        assert "APISPORTS_KEY" not in text
        assert "api_key_persisted" in text

    print("API_FOOTBALL_RUNTIME_EVIDENCE=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
