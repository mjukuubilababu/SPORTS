from __future__ import annotations

import json
import sys
from pathlib import Path

from canonical_settlement_adapter import build_settled_corpus, evaluate_settled_corpus


if len(sys.argv) != 4:
    raise SystemExit("Usage: python run_canonical_validation.py truth_store.json gate2_backfill.json output.json")

_, truth_path, backfill_path, output_path = sys.argv
truth_store = json.loads(Path(truth_path).read_text(encoding="utf-8"))
backfill = json.loads(Path(backfill_path).read_text(encoding="utf-8"))
corpus = build_settled_corpus(truth_store, backfill)
report = evaluate_settled_corpus(corpus)
Path(output_path).write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({
    "corpus": corpus["summary"],
    "research_n": report["research_model_market_report"]["n"],
    "strict_n": report["strict_p002_validation_report"]["n"],
    "strict_promotion": report["strict_p002_promotion_readiness"]["pass"],
}, indent=2))
