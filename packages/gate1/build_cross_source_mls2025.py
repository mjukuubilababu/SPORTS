from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

from cross_source_result_reconciler import (
    SOURCE_REGISTRY,
    build_truth_store_from_source_texts,
    verify_source_blob,
)


if len(sys.argv) not in (2, 3):
    raise SystemExit("Usage: python build_cross_source_mls2025.py truth_store_output.json [audit_output.json]")


def download(source_key: str) -> bytes:
    url = SOURCE_REGISTRY[source_key]["url"]
    request = urllib.request.Request(url, headers={"User-Agent": "SPORTS-canonical-historical-corpus/0.1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read()
    verification = verify_source_blob(payload, source_key)
    if verification["verified"] is not True:
        raise RuntimeError(f"SOURCE_BLOB_SHA_MISMATCH:{source_key}")
    return payload


source_a = download("MLSOPENSKILL")
source_b = download("OPENFOOTBALL")

payload = build_truth_store_from_source_texts(
    source_a.decode("utf-8-sig"),
    source_b.decode("utf-8"),
    dataset_id="MLS-2025-CROSS-SOURCE-REAL-RESULTS-V0.1",
)

store = payload["truth_store"]
Path(sys.argv[1]).write_text(json.dumps(store, indent=2), encoding="utf-8")

if len(sys.argv) == 3:
    audit = {
        "source_audit": payload["source_audit"],
        "reconciliation": payload["reconciliation"],
        "truth_store_summary": store["summary"],
    }
    Path(sys.argv[2]).write_text(json.dumps(audit, indent=2), encoding="utf-8")

print(json.dumps({
    "reconciliation": payload["reconciliation"]["summary"],
    "truth_store": store["summary"],
}, indent=2))
