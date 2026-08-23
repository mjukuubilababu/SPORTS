from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))
sys.path.insert(0, str(ROOT / "packages" / "gate2"))
sys.path.insert(0, str(ROOT / "packages" / "gate3"))

from cross_source_result_reconciler import (
    parse_mlsopenskill_csv,
    parse_openfootball_json,
    reconcile_results,
    verify_source_blob,
)
from footiqo_fixture_reconciler import (
    load_reviewed_footiqo_snapshot,
    parse_fixture_download_csv,
    reconcile_footiqo_with_fixtures,
)
from historical_truth_importer import import_historical_rows
from canonical_backfill import build_backfill_from_truth_store
from canonical_settlement_adapter import build_settled_corpus, evaluate_settled_corpus


MLSOPENSKILL_BLOB_API = "https://api.github.com/repos/dewanthenmalai/MLSOpenSkill/git/blobs/022c9bc83a3196adc702bf84a64217571b087630"
OPENFOOTBALL_BLOB_API = "https://api.github.com/repos/openfootball/football.json/git/blobs/2896d283601615739418575cbe6b6c9b316a3151"
FIXTUREDOWNLOAD_2026_CSV = "https://fixturedownload.com/download/mls-2026-UTC.csv"
FOOTIQO_SNAPSHOT = ROOT / "packages" / "gate1" / "data" / "footiqo-mls-2026-public-closing-snapshot-v0.1.csv"
DATASET_ID = "MLS-2025-WARMUP-PLUS-2026-FOOTIQO-CLOSING-RESEARCH-V0.1"


def _request(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "SPORTS-Decision-Intelligence-Historical-Research/0.1",
            "Accept": "application/vnd.github+json,text/csv,text/plain,*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def _github_blob_text(url: str) -> str:
    payload = json.loads(_request(url).decode("utf-8"))
    if payload.get("encoding") != "base64" or not payload.get("content"):
        raise RuntimeError("GITHUB_BLOB_RESPONSE_INVALID")
    return base64.b64decode(payload["content"]).decode("utf-8")


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def build_report(*, bootstrap_reps: int = 2000) -> dict:
    source_a_text = _github_blob_text(MLSOPENSKILL_BLOB_API)
    source_b_text = _github_blob_text(OPENFOOTBALL_BLOB_API)

    audit_a = verify_source_blob(source_a_text.encode("utf-8"), "MLSOPENSKILL")
    audit_b = verify_source_blob(source_b_text.encode("utf-8"), "OPENFOOTBALL")
    if not audit_a["verified"] or not audit_b["verified"]:
        raise RuntimeError("PINNED_2025_SOURCE_BLOB_VERIFICATION_FAILED")

    prior_reconciliation = reconcile_results(
        parse_mlsopenskill_csv(source_a_text),
        parse_openfootball_json(source_b_text),
    )

    fixture_bytes = _request(FIXTUREDOWNLOAD_2026_CSV)
    fixture_text = fixture_bytes.decode("utf-8-sig")
    current_reconciliation = reconcile_footiqo_with_fixtures(
        load_reviewed_footiqo_snapshot(FOOTIQO_SNAPSHOT),
        parse_fixture_download_csv(fixture_text),
    )

    combined_inputs = [
        *prior_reconciliation["verified_rows"],
        *current_reconciliation["verified_rows"],
    ]
    truth_store = import_historical_rows(combined_inputs, dataset_id=DATASET_ID)
    backfill = build_backfill_from_truth_store(truth_store)
    settled = build_settled_corpus(truth_store, backfill)
    evaluation = evaluate_settled_corpus(settled, bootstrap_reps=bootstrap_reps, seed=42)

    research = evaluation["research_model_market_report"]
    strict = evaluation["strict_p002_validation_report"]
    current_rows = [row for row in evaluation["rows"] if row.get("season") == 2026]

    return {
        "report_version": "REAL_HISTORICAL_RESEARCH_RUNTIME_V0_1",
        "dataset_id": DATASET_ID,
        "source_audit": {
            "mlsopenskill_2025": audit_a,
            "openfootball_2025": audit_b,
            "fixturedownload_2026": {
                "url": FIXTUREDOWNLOAD_2026_CSV,
                "sha256_at_runtime": _sha256(fixture_bytes),
                "semantics": "UTC_FIXTURE_AND_FINAL_RESULT_EXPORT",
            },
            "footiqo_2026": {
                "snapshot": str(FOOTIQO_SNAPSHOT.relative_to(ROOT)),
                "source_url": "https://footiqo.com/database/leagues/usa-mls/",
                "semantics": "PUBLIC_REVIEWED_1XBET_CLOSING_ODDS_SNAPSHOT",
            },
        },
        "source_summaries": {
            "mls_2025_cross_source": prior_reconciliation["summary"],
            "mls_2026_footiqo_fixturedownload": current_reconciliation["summary"],
            "canonical_truth_store": truth_store["summary"],
            "gate2_backfill": backfill["summary"],
            "gate3_settled": settled["summary"],
        },
        "headline": {
            "research_n": research["n"],
            "strict_p002_n": strict["n"],
            "model_brier": research["brier_model"],
            "market_brier": research["brier_market"],
            "delta_brier_vs_market": research["delta_brier_vs_market"],
            "model_logloss": research["logloss_model"],
            "market_logloss": research["logloss_market"],
            "delta_logloss_vs_market": research["delta_logloss_vs_market"],
            "expected_calibration_error": research["expected_calibration_error"],
            "strict_p002_promotion_pass": evaluation["strict_p002_promotion_readiness"]["pass"],
        },
        "current_2026_rows": current_rows,
        "evaluation": evaluation,
        "governance": {
            "2025_rows_are_history_only_without_market_prices": True,
            "2026_market_rows_require_footiqo_fixturedownload_score_agreement": True,
            "2026_canonical_date_derived_from_fixture_utc_and_home_timezone": True,
            "research_report_cannot_promote_p002": True,
            "strict_report_remains_existing_gate1_plus_gate2_semantics": True,
            "closing_reference_is_not_execution_entry": True,
            "clv_not_fabricated": True,
            "no_hindsight": True,
            "capital_effect": "NONE",
            "real_money": "NO",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=str(ROOT / "artifacts" / "real-2026-historical-research-report.json"))
    parser.add_argument("--bootstrap-reps", type=int, default=2000)
    args = parser.parse_args()

    report = build_report(bootstrap_reps=args.bootstrap_reps)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({
        "report_version": report["report_version"],
        "dataset_id": report["dataset_id"],
        **report["headline"],
        "source_summaries": report["source_summaries"],
        "output": str(output),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
