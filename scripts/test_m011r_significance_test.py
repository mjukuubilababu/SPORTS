from __future__ import annotations

import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate3"))

from m011r_bayesian_calibrator import MODEL_ID, MODEL_VERSION
from m011r_significance_test import paired_bootstrap_significance


def row(match_id, model_p, market_p, outcome, market_evaluable=True):
    return {
        "match_id": match_id,
        "model_probability": model_p,
        "market_probability": market_p,
        "outcome_u35": outcome,
        "market_evaluable": market_evaluable,
    }


def walk_forward(rows):
    evaluable = [r for r in rows if r["market_evaluable"]]
    return {
        "model_id": MODEL_ID,
        "model_version": MODEL_VERSION,
        "market_used_as_model_input": False,
        "market_used_as_benchmark_only": True,
        "summary": {"market_evaluable_n": len(evaluable)},
        "predictions": rows,
    }


def test_identical_probabilities_have_zero_interval():
    rows = [row(f"m-{i}", 0.65, 0.65, 1 if i % 3 else 0) for i in range(12)]
    result = paired_bootstrap_significance(walk_forward(rows), reps=2000, seed=11)
    for metric in ("delta_brier_vs_market", "delta_logloss_vs_market"):
        assert abs(result[metric]["observed_delta"]) < 1e-15
        assert abs(result[metric]["ci_lower"]) < 1e-15
        assert abs(result[metric]["ci_upper"]) < 1e-15
        assert result[metric]["ci_excludes_zero"] is False


def test_clear_model_advantage_has_positive_interval():
    rows = []
    for i in range(30):
        y = 1 if i % 2 == 0 else 0
        model_p = 0.90 if y == 1 else 0.10
        market_p = 0.60 if y == 1 else 0.40
        rows.append(row(f"m-{i}", model_p, market_p, y))
    result = paired_bootstrap_significance(walk_forward(rows), reps=3000, seed=99)
    assert result["delta_brier_vs_market"]["ci_lower"] > 0.0
    assert result["delta_logloss_vs_market"]["ci_lower"] > 0.0
    assert result["delta_brier_vs_market"]["ci_excludes_zero"] is True
    assert result["delta_logloss_vs_market"]["ci_excludes_zero"] is True


def test_deterministic_seed_and_governance():
    rows = [row(f"m-{i}", 0.55 + 0.01 * (i % 5), 0.58, 1 if i % 4 else 0) for i in range(20)]
    a = paired_bootstrap_significance(walk_forward(rows), reps=2000, seed=123)
    b = paired_bootstrap_significance(walk_forward(rows), reps=2000, seed=123)
    assert a == b
    assert a["evaluation_classification"] == "CONSUMED_DEVELOPMENT_NOT_INDEPENDENT"
    assert a["governance"]["analysis_only"] is True
    assert a["governance"]["independent_validation"] is False
    assert a["governance"]["new_evidence_rows_created"] is False
    assert a["governance"]["model_parameters_changed"] is False
    assert a["governance"]["frozen_rules_changed"] is False
    assert a["governance"]["decision_weight"] == 0.0


def test_non_evaluable_rows_are_excluded():
    rows = [
        row("a", 0.70, 0.60, 1, True),
        row("b", 0.20, None, 0, False),
        row("c", 0.35, 0.45, 0, True),
    ]
    result = paired_bootstrap_significance(walk_forward(rows), reps=1500, seed=5)
    assert result["market_evaluable_n"] == 2
    assert result["match_ids"] == ["a", "c"]


def test_invalid_market_pair_fails_closed():
    rows = [row("bad", 0.70, None, 1, True)]
    try:
        paired_bootstrap_significance(walk_forward(rows), reps=1000, seed=1)
    except ValueError as exc:
        assert str(exc) == "M011R_BOOTSTRAP_INVALID_MARKET_PROBABILITY_bad"
    else:
        raise AssertionError("Expected invalid paired row to fail closed")


def test_outputs_are_finite():
    rows = [row(f"m-{i}", 0.51 + 0.01 * (i % 7), 0.60, 1 if i % 3 else 0) for i in range(25)]
    result = paired_bootstrap_significance(walk_forward(rows), reps=2000, seed=7)
    for metric in ("delta_brier_vs_market", "delta_logloss_vs_market"):
        for key in ("observed_delta", "ci_lower", "ci_upper", "bootstrap_probability_delta_gt_zero", "bootstrap_probability_delta_lt_zero"):
            assert math.isfinite(result[metric][key])


def main():
    test_identical_probabilities_have_zero_interval()
    test_clear_model_advantage_has_positive_interval()
    test_deterministic_seed_and_governance()
    test_non_evaluable_rows_are_excluded()
    test_invalid_market_pair_fails_closed()
    test_outputs_are_finite()
    print("M011R_SIGNIFICANCE_TEST=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
