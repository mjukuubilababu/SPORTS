from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from canonical_gate3_adapter import evaluate_gate3_research_for_gate4, rows_from_gate3_report


def row(i, model, market, outcome, eligible=True):
    return {
        "match_id": f"m{i}",
        "date": f"2026-01-{i:02d}",
        "model_prob": model,
        "market_prob": market,
        "outcome_u35": outcome,
        "research_eligible": eligible,
    }


report = {
    "dataset_id": "TEST-REAL-CORPUS",
    "evaluation": {
        "rows": [
            row(1, 0.80, 0.60, 0),
            row(2, 0.70, 0.65, 1),
            row(3, 0.75, 0.70, 1),
            row(4, 0.55, 0.60, 1, eligible=False),
        ]
    },
}

rows = rows_from_gate3_report(report)
assert len(rows) == 3
result = evaluate_gate3_research_for_gate4(report)
assert result["n"] == 3
assert result["promotion_state"] == "BLOCK_PROMOTION"
assert result["promote_poisson"] is False
assert result["checks"]["min_n"]["required"] == 100
assert result["checks"]["min_n"]["pass"] is False
assert result["checks"]["walk_forward"]["folds"] == 0
assert result["checks"]["regime_consistency"]["metadata_available"] is False
assert result["missing_challengers"] == ["negative_binomial", "ensemble"]
assert result["governance"]["market_remains_incumbent_when_promotion_blocked"] is True

# A descriptive leader must not bypass the sample gate even if Poisson scores better.
good_rows = []
for i in range(1, 21):
    outcome = 1 if i % 2 else 0
    model = 0.80 if outcome else 0.20
    market = 0.60 if outcome else 0.40
    good_rows.append({
        "match_id": f"g{i}",
        "date": f"2026-02-{((i-1)%20)+1:02d}",
        "model_prob": model,
        "market_prob": market,
        "outcome_u35": outcome,
        "research_eligible": True,
    })
good = evaluate_gate3_research_for_gate4({"dataset_id": "GOOD-SMALL", "evaluation": {"rows": good_rows}})
assert good["descriptive_leader"] == "poisson"
assert good["checks"]["brier_vs_market"] is True
assert good["checks"]["logloss_vs_market"] is True
assert good["promote_poisson"] is False
assert "N 20 < 100" in good["reasons"]

# Invalid probabilities fail closed.
bad = {"dataset_id": "BAD", "evaluation": {"rows": [row(1, 1.2, 0.5, 1)]}}
try:
    rows_from_gate3_report(bad)
    raise AssertionError("invalid probability should fail")
except ValueError as exc:
    assert str(exc) == "INVALID_RESEARCH_PROBABILITY"

print("GATE3_GATE4_REAL_ROBUSTNESS=PASS")
