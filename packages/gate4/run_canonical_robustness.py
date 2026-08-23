from __future__ import annotations

import json
import sys
from pathlib import Path

from canonical_gate3_adapter import evaluate_gate3_research_for_gate4


if len(sys.argv) != 3:
    raise SystemExit("Usage: python run_canonical_robustness.py gate3_research_report.json gate4_report.json")

source = Path(sys.argv[1])
target = Path(sys.argv[2])
report = json.loads(source.read_text(encoding="utf-8"))
payload = evaluate_gate3_research_for_gate4(report)
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
print(json.dumps(payload, indent=2))
