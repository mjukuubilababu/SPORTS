from __future__ import annotations

import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate3"))

from m011r_bayesian_calibrator import (
    MIN_TRAIN_N,
    fit_calibrator,
    gate2_model_features,
    predict_probability,
    walk_forward_predict,
)


def feature(match_id, date, p=0.72, market_p=0.62, home_n=8, away_n=8):
    return {
        "match_id": match_id,
        "date": date,
        "home": f"H-{match_id}",
        "away": f"A-{match_id}",
        "home_prior_n": home_n,
        "away_prior_n": away_n,
        "model_u35_prob": p,
        "market_u35_prob": market_p,
        "venue_home_lambda": 1.40,
        "venue_away_lambda": 1.35,
        "last10_home_lambda": 1.45,
        "last10_away_lambda": 1.30,
        "last5_home_lambda": 1.50,
        "last5_away_lambda": 1.35,
    }


def truth(match_id, outcome, market=True):
    score = {"home": 1, "away": 1} if outcome == 1 else {"home": 3, "away": 2}
    return {
        "match_id": match_id,
        "result": {"verified": True},
        "final_score": score,
        "market": {
            "status": "ACCEPTED" if market else "MISSING",
            "u35": 1.70 if market else None,
            "o35": 2.20 if market else None,
        },
    }


def stores(features, outcomes):
    return (
        {
            "store_version": "CANONICAL_HISTORICAL_TRUTH_STORE_V0_1",
            "dataset_id": "SYNTHETIC-M011R-TEST",
            "records": [truth(row["match_id"], outcomes[row["match_id"]]) for row in features],
        },
        {
            "pipeline_version": "GATE1_TO_GATE2_CANONICAL_BACKFILL_V0_1",
            "source_dataset_id": "SYNTHETIC-M011R-TEST",
            "features": features,
        },
    )


def test_market_not_model_input():
    a = feature("x", "2026-01-01", market_p=0.51)
    b = dict(a)
    b["market_u35_prob"] = 0.91
    assert gate2_model_features(a) == gate2_model_features(b)


def test_small_sample_falls_back_to_identity():
    rows = [(feature(str(i), f"2025-01-{i+1:02d}", p=0.68), i % 2) for i in range(MIN_TRAIN_N - 1)]
    state = fit_calibrator(rows)
    assert state.fallback_identity is True
    test_row = feature("future", "2026-01-01", p=0.731)
    assert abs(predict_probability(test_row, state) - 0.731) < 1e-9


def test_date_batch_blocks_same_day_leakage():
    rows = []
    outcomes = {}
    for i in range(35):
        match_id = f"train-{i}"
        rows.append(feature(match_id, f"2025-{1 + i // 28:02d}-{1 + i % 28:02d}", p=0.58 + 0.01 * (i % 8)))
        outcomes[match_id] = 1 if i % 3 else 0
    rows.extend([
        feature("target-a", "2026-03-01", p=0.74),
        feature("target-b", "2026-03-01", p=0.69),
    ])
    outcomes["target-a"] = 1
    outcomes["target-b"] = 0
    truth_store, backfill = stores(rows, outcomes)
    first = walk_forward_predict(truth_store, backfill)

    truth_store_2, backfill_2 = stores(rows, {**outcomes, "target-a": 0})
    second = walk_forward_predict(truth_store_2, backfill_2)

    f_by_id = {r["match_id"]: r for r in first["predictions"]}
    s_by_id = {r["match_id"]: r for r in second["predictions"]}
    assert f_by_id["target-a"]["training_n"] == f_by_id["target-b"]["training_n"]
    assert abs(f_by_id["target-b"]["model_probability"] - s_by_id["target-b"]["model_probability"]) < 1e-12


def test_metrics_are_finite_and_normalized():
    rows = []
    outcomes = {}
    for i in range(45):
        match_id = f"m-{i}"
        rows.append(feature(match_id, f"2025-{1 + i // 28:02d}-{1 + i % 28:02d}", p=0.56 + 0.025 * (i % 7), market_p=0.60))
        outcomes[match_id] = 1 if i % 4 else 0
    truth_store, backfill = stores(rows, outcomes)
    result = walk_forward_predict(truth_store, backfill)
    assert result["market_used_as_model_input"] is False
    assert result["summary"]["market_evaluable_n"] == 45
    for row in result["predictions"]:
        assert 0.0 < row["model_probability"] < 1.0
    for value in result["metrics"].values():
        assert value is None or math.isfinite(value)


def main():
    test_market_not_model_input()
    test_small_sample_falls_back_to_identity()
    test_date_batch_blocks_same_day_leakage()
    test_metrics_are_finite_and_normalized()
    print("M011R_BAYESIAN_CALIBRATOR=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
