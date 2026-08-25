from __future__ import annotations

import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate3"))

from m015_regularized_poisson_glm import (
    MIN_TRAIN_N,
    fit_glm,
    gate2_component_totals,
    predict_mean,
    walk_forward_predict,
)


def feature(match_id, date, market_p=0.62, home_n=8, away_n=8, shift=0.0):
    return {
        "match_id": match_id,
        "date": date,
        "home": f"H-{match_id}",
        "away": f"A-{match_id}",
        "home_prior_n": home_n,
        "away_prior_n": away_n,
        "venue_home_lambda": 1.35 + shift,
        "venue_away_lambda": 1.20,
        "last10_home_lambda": 1.40 + shift,
        "last10_away_lambda": 1.25,
        "last5_home_lambda": 1.45 + shift,
        "last5_away_lambda": 1.30,
        "post_lineup_lambda": 2.60 + shift,
        "model_u35_prob": 0.73,
        "market_u35_prob": market_p,
    }


def truth(row, total_goals, market=True):
    hg = total_goals // 2
    ag = total_goals - hg
    return {
        "match_id": row["match_id"],
        "home_team": row["home"],
        "away_team": row["away"],
        "result": {"verified": True},
        "final_score": {"home": hg, "away": ag},
        "market": {
            "status": "ACCEPTED" if market else "MISSING",
            "u35": 1.70 if market else None,
            "o35": 2.20 if market else None,
        },
    }


def stores(features, totals):
    dataset_id = "SYNTHETIC-M015-TEST"
    return (
        {
            "store_version": "CANONICAL_HISTORICAL_TRUTH_STORE_V0_1",
            "dataset_id": dataset_id,
            "records": [truth(row, totals[row["match_id"]]) for row in features],
        },
        {
            "pipeline_version": "GATE1_TO_GATE2_CANONICAL_BACKFILL_V0_1",
            "source_dataset_id": dataset_id,
            "features": features,
        },
    )


def test_market_not_model_input():
    a = feature("x", "2026-01-01", market_p=0.51)
    b = dict(a)
    b["market_u35_prob"] = 0.91
    assert gate2_component_totals(a) == gate2_component_totals(b)


def test_small_sample_falls_back_to_gate2():
    rows = []
    for i in range(MIN_TRAIN_N - 1):
        row = feature(str(i), f"2025-01-{i+1:02d}", shift=0.01 * (i % 4))
        rows.append((row, 2 + (i % 3)))
    state = fit_glm(rows)
    assert state.fallback_gate2 is True
    target = feature("future", "2026-01-01", shift=0.17)
    assert abs(predict_mean(target, state) - target["post_lineup_lambda"]) < 1e-12


def test_date_batch_blocks_same_day_leakage():
    rows = []
    totals = {}
    for i in range(40):
        match_id = f"train-{i}"
        row = feature(match_id, f"2025-{1 + i // 28:02d}-{1 + i % 28:02d}", shift=0.02 * (i % 5))
        rows.append(row)
        totals[match_id] = 1 + (i % 5)
    a = feature("target-a", "2026-03-01", shift=0.10)
    b = feature("target-b", "2026-03-01", shift=0.20)
    rows.extend([a, b])
    totals["target-a"] = 2
    totals["target-b"] = 5

    truth_store, backfill = stores(rows, totals)
    first = walk_forward_predict(truth_store, backfill)

    totals2 = dict(totals)
    totals2["target-a"] = 7
    truth_store2, backfill2 = stores(rows, totals2)
    second = walk_forward_predict(truth_store2, backfill2)

    f = {r["match_id"]: r for r in first["predictions"]}
    s = {r["match_id"]: r for r in second["predictions"]}
    assert f["target-a"]["training_n"] == f["target-b"]["training_n"]
    assert abs(f["target-b"]["model_lambda"] - s["target-b"]["model_lambda"]) < 1e-12
    assert abs(f["target-b"]["model_probability"] - s["target-b"]["model_probability"]) < 1e-12


def test_metrics_finite_and_probabilities_normalized():
    rows = []
    totals = {}
    for i in range(50):
        match_id = f"m-{i}"
        row = feature(match_id, f"2025-{1 + i // 28:02d}-{1 + i % 28:02d}", shift=0.015 * (i % 6))
        rows.append(row)
        totals[match_id] = 1 + (i % 6)
    truth_store, backfill = stores(rows, totals)
    result = walk_forward_predict(truth_store, backfill)
    assert result["market_used_as_model_input"] is False
    assert result["summary"]["development_market_evaluable_n"] == 50
    assert result["summary"]["independent_validation_n"] == 0
    for row in result["predictions"]:
        assert 0.0 < row["model_probability"] < 1.0
        assert 0.0 < row["gate2_probability"] < 1.0
        assert math.isfinite(row["model_lambda"])
    for value in result["metrics"].values():
        assert value is None or math.isfinite(value)


def main():
    test_market_not_model_input()
    test_small_sample_falls_back_to_gate2()
    test_date_batch_blocks_same_day_leakage()
    test_metrics_finite_and_probabilities_normalized()
    print("M015_REGULARIZED_POISSON_GLM=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
