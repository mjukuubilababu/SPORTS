from __future__ import annotations

import json
import sys
from pathlib import Path

from canonical_backfill import build_backfill_from_truth_store


if len(sys.argv) != 3:
    raise SystemExit("Usage: python run_canonical_backfill.py gate1_truth_store.json output.json")

_, input_path, output_path = sys.argv
store = json.loads(Path(input_path).read_text(encoding="utf-8"))
report = build_backfill_from_truth_store(store)
Path(output_path).write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report["summary"], indent=2))
