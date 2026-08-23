from __future__ import annotations

import argparse
import base64
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))
sys.path.insert(0, str(ROOT / "packages" / "gate2"))
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from cross_source_result_reconciler import (
    parse_mlsopenskill_csv,
    parse_openfootball_json,
    reconcile_results,
    verify_source_blob,
)
from historical_truth_importer import import_historical_rows
from canonical_backfill import build_backfill_from_truth_store
from negbin_challenger import build_training_rows, challenger_specification, fit_dispersion_mle, fit_to_dict


MLSOPENSKILL_BLOB_API = "https://api.github.com/repos/dewanthenmalai/MLSOpenSkill/git/blobs/022c9bc83a3196adc702bf84a64217571b087630"
OPENFOOTBALL_BLOB_API = "https://api.github.com/repos/openfootball/football.json/git/blobs/2896d283601615739418575cbe6b6c9b316a3151"
TRAINING_DATASET_ID = "MLS-2025-CROSS-SOURCE-VERIFIED-CHRONOLOGICAL-TRAIN-V0.1"
HOLDOUT_A = ROOT / "packages" / "gate4" / "data" / "mls-2026-evaluation-holdout-a-v0.1.json"


def _request(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "SPORTS-Decision-Intelligence-NegBin-Challenger/0.1",
            "Accept": "application/vnd.github+json,*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def _github_blob_text(url: str) -> str:
    payload = json.loads(_request(url).decode("utf-8"))
    if payload.get("encoding") != "base64" or not payload.get("content"):
        raise RuntimeError("GITHUB_BLOB_RESPONSE_INVALID")
    return base64.b64decode(payload["content"]).decode("utf-8")


def build_training_report() -> dict:
    source_a = _github_blob_text(MLSOPENSKILL_BLOB_API)
    source_b = _github_blob_text(OPENFOOTBALL_BLOB_API)
    audit_a = verify_source_blob(source_a.encode("utf-8"), "MLSOPENSKILL")
    audit_b = verify_source_blob(source_b.encode("utf-8"), "OPENFOOTBALL")
    if not audit_a["verified"] or not audit_b["verified"]:
        raise RuntimeError("PINNED_TRAINING_SOURCE_VERIFICATION_FAILED")

    reconciliation = reconcile_results(
        parse_mlsopenskill_csv(source_a),
        parse_openfootball_json(source_b),
    )
    truth_store = import_historical_rows(
        reconciliation["verified_rows"],
        dataset_id=TRAINING_DATASET_ID,
    )
    backfill = build_backfill_from_truth_store(truth_store)
    holdout = json.loads(HOLDOUT_A.read_text(encoding="utf-8"))
    forbidden = set(holdout["match_ids"])

    rows = build_training_rows(
        truth_store,
        backfill,
        training_season=2025,
        forbidden_match_ids=forbidden,
    )
    if set(row.match_id for row in rows) & forbidden:
        raise RuntimeError("HOLDOUT_A_MATCH_LEAKAGE_DETECTED")

    fit = fit_dispersion_mle(rows)
    specification = challenger_specification(fit)
    return {
        "report_version": "NEGBIN_CHALLENGER_TRAINING_REPORT_V0_1",
        "training_dataset_id": TRAINING_DATASET_ID,
        "training_season": 2025,
        "source_audit": {
            "mlsopenskill": audit_a,
            "openfootball": audit_b,
        },
        "source_reconciliation": reconciliation["summary"],
        "truth_store_summary": truth_store["summary"],
        "gate2_backfill_summary": backfill["summary"],
        "training": {
            "n": len(rows),
            "date_start": rows[0].date,
            "date_end": rows[-1].date,
            "match_ids": [row.match_id for row in rows],
            "uses_market_odds": False,
            "uses_holdout_a": False,
            "holdout_a_overlap_n": 0,
        },
        "fit": fit_to_dict(fit),
        "challenger_specification": specification,
        "evaluation": {
            "holdout_a_evaluated": False,
            "test_set_b_evaluated": False,
            "performance_claim": "NONE_TRAINING_ONLY",
        },
        "governance": {
            "chronological_gate2_mu_only": True,
            "training_outcomes_from_cross_source_verified_2025_results": True,
            "bookmaker_odds_excluded_from_model_fit": True,
            "holdout_a_match_ids_forbidden": True,
            "holdout_a_metrics_not_used_for_parameter_selection": True,
            "future_test_b_required": True,
            "capital_effect": "NONE",
            "real_money": "NO",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default=str(ROOT / "artifacts" / "negbin-challenger-training-report-v0.1.json"),
    )
    args = parser.parse_args()
    report = build_training_report()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({
        "report_version": report["report_version"],
        "training_dataset_id": report["training_dataset_id"],
        "training": {k: v for k, v in report["training"].items() if k != "match_ids"},
        "fit": report["fit"],
        "evaluation": report["evaluation"],
        "output": str(output),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
