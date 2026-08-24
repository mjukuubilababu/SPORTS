from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any


VERSION = "API_FOOTBALL_RUNTIME_EVIDENCE_V0_1"
SUCCESS_STATES = {
    "VERIFIED_AUTHENTICATED_PROVIDER_RUNTIME_ZERO_LIVE",
    "VERIFIED_AUTHENTICATED_PROVIDER_RUNTIME_WITH_LIVE_CAPTURE",
}


def _bool(value: object) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes"}


def _load_optional(path: str | None) -> dict[str, Any] | None:
    if not path:
        return None
    candidate = Path(path)
    if not candidate.exists():
        return None
    payload = json.loads(candidate.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("RUNTIME_EVIDENCE_SOURCE_OBJECT_REQUIRED")
    return payload


def _outcome(value: object) -> str:
    normalized = str(value or "").strip().lower()
    if normalized not in {"success", "failure", "skipped", "cancelled", "unknown"}:
        return "unknown"
    return normalized


def build_evidence(
    *,
    credential_available: bool,
    provider_fetch_outcome: str,
    artifact_verify_outcome: str,
    unified_outcome: str,
    runtime_artifact: dict[str, Any] | None,
    unified_report: dict[str, Any] | None,
    run_id: str,
    run_attempt: str,
    trigger_event: str,
    repository: str,
    ref_name: str,
    commit_sha: str,
) -> dict[str, Any]:
    fetch = _outcome(provider_fetch_outcome)
    artifact = _outcome(artifact_verify_outcome)
    unified = _outcome(unified_outcome)

    state: str
    failure_class: str | None
    if not credential_available:
        state = "BLOCKED_CREDENTIAL_NOT_CONFIGURED"
        failure_class = "CREDENTIAL"
    elif fetch != "success":
        state = "PROVIDER_FETCH_FAILED"
        failure_class = "PROVIDER_NETWORK_OR_AUTH"
    elif artifact != "success":
        state = "ARTIFACT_VERIFICATION_FAILED"
        failure_class = "PROVENANCE_OR_SCHEMA"
    elif unified != "success":
        state = "UNIFIED_ASSURANCE_FAILED"
        failure_class = "SYSTEM_ASSURANCE"
    elif runtime_artifact is None or unified_report is None:
        state = "RUNTIME_EVIDENCE_INPUT_MISSING"
        failure_class = "EVIDENCE_IO"
    else:
        if runtime_artifact.get("capability") != "API_FOOTBALL_LIVE_PROVIDER_V0_1":
            raise ValueError("RUNTIME_EVIDENCE_CAPABILITY_MISMATCH")
        if unified_report.get("core_integrated_assurance") != "PROMOTE":
            state = "UNIFIED_ASSURANCE_FAILED"
            failure_class = "SYSTEM_ASSURANCE"
        elif unified_report.get("tests_total") != unified_report.get("tests_passed"):
            state = "UNIFIED_ASSURANCE_FAILED"
            failure_class = "SYSTEM_ASSURANCE"
        elif unified_report.get("capital_assurance") != "LOCKED":
            raise ValueError("RUNTIME_EVIDENCE_CAPITAL_MUST_REMAIN_LOCKED")
        else:
            live_n = runtime_artifact.get("live_in_play_n")
            rows_n = runtime_artifact.get("rows_n")
            if not isinstance(live_n, int) or isinstance(live_n, bool) or live_n < 0:
                raise ValueError("RUNTIME_EVIDENCE_LIVE_COUNT_INVALID")
            if not isinstance(rows_n, int) or isinstance(rows_n, bool) or rows_n < live_n:
                raise ValueError("RUNTIME_EVIDENCE_ROW_COUNT_INVALID")
            state = (
                "VERIFIED_AUTHENTICATED_PROVIDER_RUNTIME_WITH_LIVE_CAPTURE"
                if live_n > 0
                else "VERIFIED_AUTHENTICATED_PROVIDER_RUNTIME_ZERO_LIVE"
            )
            failure_class = None

    rows_n = runtime_artifact.get("rows_n") if runtime_artifact else None
    live_n = runtime_artifact.get("live_in_play_n") if runtime_artifact else None
    observed_at = runtime_artifact.get("observed_at") if runtime_artifact else None
    capital_assurance = unified_report.get("capital_assurance") if unified_report else "NOT_VERIFIED"
    core_assurance = unified_report.get("core_integrated_assurance") if unified_report else "NOT_VERIFIED"
    full_assurance = unified_report.get("full_platform_assurance") if unified_report else "NOT_VERIFIED"

    evidence = {
        "version": VERSION,
        "capability": "API_FOOTBALL_REAL_RUNTIME_ACTIVATION_V0_1",
        "provider": "API_FOOTBALL",
        "state": state,
        "failure_class": failure_class,
        "workflow": {
            "run_id": str(run_id),
            "run_attempt": str(run_attempt),
            "trigger_event": str(trigger_event),
            "repository": str(repository),
            "ref_name": str(ref_name),
            "commit_sha": str(commit_sha),
        },
        "stage_outcomes": {
            "credential_available": bool(credential_available),
            "provider_fetch": fetch,
            "artifact_verification": artifact,
            "unified_assurance": unified,
        },
        "provider_evidence": {
            "response_observed_at": observed_at,
            "rows_n": rows_n,
            "live_in_play_n": live_n,
            "live_match_captured": isinstance(live_n, int) and not isinstance(live_n, bool) and live_n > 0,
            "zero_live_rows_semantics": "VALID_RUNTIME_RESPONSE_NOT_A_LIVE_MATCH_CAPTURE",
        },
        "assurance": {
            "core_integrated_assurance": core_assurance,
            "full_platform_assurance": full_assurance,
            "capital_assurance": capital_assurance,
        },
        "governance": {
            "api_key_persisted": False,
            "provider_payload_persisted_to_repository": False,
            "provider_prediction_used": False,
            "bookmaker_data_used_as_model_input": False,
            "automatic_capital_unlock": False,
            "real_money": "NO",
        },
    }

    if evidence["workflow"]["ref_name"] != "import/decision-intelligence-v0.5-qualified-set":
        raise ValueError("RUNTIME_EVIDENCE_NON_CANONICAL_REF")
    return evidence


def write_evidence(evidence: dict[str, Any], output_dir: str) -> tuple[Path, Path]:
    directory = Path(output_dir)
    runs = directory / "runs"
    runs.mkdir(parents=True, exist_ok=True)
    run_id = evidence["workflow"]["run_id"]
    if not run_id or not run_id.isdigit():
        raise ValueError("RUNTIME_EVIDENCE_RUN_ID_INVALID")
    run_path = runs / f"{run_id}.json"
    latest_path = directory / "latest.json"
    serialized = json.dumps(evidence, indent=2, sort_keys=True) + "\n"
    run_path.write_text(serialized, encoding="utf-8")
    latest_path.write_text(serialized, encoding="utf-8")
    return run_path, latest_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-artifact")
    parser.add_argument("--unified-report")
    parser.add_argument("--output-dir", default="runtime-evidence/api-football")
    args = parser.parse_args()

    evidence = build_evidence(
        credential_available=_bool(os.environ.get("RUNTIME_CREDENTIAL_AVAILABLE")),
        provider_fetch_outcome=os.environ.get("RUNTIME_PROVIDER_FETCH_OUTCOME", "unknown"),
        artifact_verify_outcome=os.environ.get("RUNTIME_ARTIFACT_VERIFY_OUTCOME", "unknown"),
        unified_outcome=os.environ.get("RUNTIME_UNIFIED_OUTCOME", "unknown"),
        runtime_artifact=_load_optional(args.runtime_artifact),
        unified_report=_load_optional(args.unified_report),
        run_id=os.environ.get("GITHUB_RUN_ID", ""),
        run_attempt=os.environ.get("GITHUB_RUN_ATTEMPT", ""),
        trigger_event=os.environ.get("GITHUB_EVENT_NAME", ""),
        repository=os.environ.get("GITHUB_REPOSITORY", ""),
        ref_name=os.environ.get("GITHUB_REF_NAME", ""),
        commit_sha=os.environ.get("GITHUB_SHA", ""),
    )
    run_path, latest_path = write_evidence(evidence, args.output_dir)
    print(json.dumps({
        "state": evidence["state"],
        "failure_class": evidence["failure_class"],
        "live_match_captured": evidence["provider_evidence"]["live_match_captured"],
        "run_evidence": str(run_path),
        "latest_evidence": str(latest_path),
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
