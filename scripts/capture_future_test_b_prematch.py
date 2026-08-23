from __future__ import annotations

import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))
sys.path.insert(0, str(ROOT / "packages" / "gate2"))
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from cross_source_result_reconciler import parse_mlsopenskill_csv, parse_openfootball_json, reconcile_results, verify_source_blob
from future_test_b_capture import (
    capture_batch, historical_input_matches, parse_fixture_schedule_csv,
    settled_fixture_matches,
)

MLSOPENSKILL_BLOB_API = "https://api.github.com/repos/dewanthenmalai/MLSOpenSkill/git/blobs/022c9bc83a3196adc702bf84a64217571b087630"
OPENFOOTBALL_BLOB_API = "https://api.github.com/repos/openfootball/football.json/git/blobs/2896d283601615739418575cbe6b6c9b316a3151"
FIXTUREDOWNLOAD_2026_CSV = "https://fixturedownload.com/download/mls-2026-UTC.csv"
TARGETS = ROOT / "packages" / "gate4" / "data" / "mls-2026-test-b-prematch-targets-2026-08-23.json"
PREREG = ROOT / "packages" / "gate4" / "data" / "negbin-challenger-preregistration-v0.1.json"
DEFAULT_OUTPUT = ROOT / "artifacts" / "future-test-b-prematch-capture-2026-08-23.json"


def _request(url: str) -> bytes:
    request = urllib.request.Request(url, headers={
        "User-Agent": "SPORTS-Decision-Intelligence-Future-Test-B/0.1",
        "Accept": "application/vnd.github+json,text/csv,text/plain,*/*",
    })
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def _blob_text(url: str) -> str:
    payload = json.loads(_request(url).decode("utf-8"))
    if payload.get("encoding") != "base64" or not payload.get("content"):
        raise RuntimeError("GITHUB_BLOB_RESPONSE_INVALID")
    return base64.b64decode(payload["content"]).decode("utf-8")


def main() -> int:
    captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    prereg = json.loads(PREREG.read_text(encoding="utf-8"))
    targets = json.loads(TARGETS.read_text(encoding="utf-8"))

    source_a = _blob_text(MLSOPENSKILL_BLOB_API)
    source_b = _blob_text(OPENFOOTBALL_BLOB_API)
    audit_a = verify_source_blob(source_a.encode("utf-8"), "MLSOPENSKILL")
    audit_b = verify_source_blob(source_b.encode("utf-8"), "OPENFOOTBALL")
    if not audit_a["verified"] or not audit_b["verified"]:
        raise RuntimeError("PINNED_2025_SOURCE_VERIFICATION_FAILED")
    prior = reconcile_results(parse_mlsopenskill_csv(source_a), parse_openfootball_json(source_b))

    fixture_bytes = _request(FIXTUREDOWNLOAD_2026_CSV)
    fixtures = parse_fixture_schedule_csv(fixture_bytes.decode("utf-8-sig"))
    history = [
        *historical_input_matches(prior["verified_rows"]),
        *settled_fixture_matches(fixtures, captured_at=captured_at),
    ]

    spec = prereg["challenger_specification"]
    report = capture_batch(
        fixtures=fixtures,
        target_match_ids=[row["match_id"] for row in targets["targets"]],
        history=history,
        captured_at=captured_at,
        registered_at=prereg["registered_at"],
        challenger_model_version=spec["model_version"],
        challenger_specification_sha256=prereg["specification_sha256"],
        dispersion_r=float(spec["dispersion_r"]),
        fixture_source_sha256=hashlib.sha256(fixture_bytes).hexdigest(),
    )
    report["source_audit"] = {
        "mlsopenskill_2025": audit_a,
        "openfootball_2025": audit_b,
        "fixturedownload_2026": {
            "url": FIXTUREDOWNLOAD_2026_CSV,
            "sha256": hashlib.sha256(fixture_bytes).hexdigest(),
            "fixtures_received": len(fixtures),
            "settled_history_rows_before_capture": len(settled_fixture_matches(fixtures, captured_at=captured_at)),
        },
        "cross_source_2025_verified": prior["summary"]["cross_source_verified"],
    }
    report["governance"] = {
        "capture_is_after_preregistration": True,
        "capture_is_before_each_target_kickoff": True,
        "future_targets_are_not_used_as_history": True,
        "market_not_required_for_model_generation": True,
        "market_closing_capture_is_separate_future_stage": True,
        "settlement_is_separate_post_match_stage": True,
        "no_performance_metrics": True,
        "capital_effect": "NONE",
        "real_money": "NO",
    }

    DEFAULT_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    DEFAULT_OUTPUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
