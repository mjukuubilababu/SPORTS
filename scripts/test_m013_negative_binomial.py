from __future__ import annotations

import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate3"))

from m013_negative_binomial import (
    MIN_DISPERSION_TRAIN_N,
    fit_dispersion,
    gate2_model_mean,
    negative_binomial_u35,
    poisson_u35,
    predict_probability,
    walk_forward_predict,
)


def feature(match_id, date, mu=2.8, market_p=0.62, home_n=8, away_n=8):
    return {
        "match_id": match_id,
        "date": date,
        "home": f"H-{match_id}",
        "away": f"A-{match_id}",
        "home_prior_n": home_n,
        "away_prior_n": away_n,
        "post_lineup_lambda": mu,
        "model_u35_prob": poisson_u35(mu),
        "market_u35_prob": market_p,
    }


def truth(match_id, total_goals, market=True):
    home = total_goals // 2
    away = total_goals - home
    return {
        "match_id": match_id,
        "result": {"verified": True},
        "final_score": {"home": home, "away": away},
        "market": {
            "status": "ACCEPTED" if market else "MISSING",
            "u35": 1.70 if market else None,
            "o35": 2.20 if market else None,
        },
    }


def stores(features, totals):
    return (
        {
            "store_version": "CANONICAL_HISTORICAL_TRUTH_STORE_V0_1",
            "dataset_id": "SYNTHETIC-M013-TEST",
            "records": [truth(row["match_id"], totals[row["match_id"]]) for row in features],
        },
        {
            "pipeline_version": "GATE1_TO_GATE2_CANONICAL_BACKFILL_V0_1",
            "source_dataset_id": "SYNTHETIC-M013-TEST",
            "features": features,
        },
    )


def test_market_not_model_input():
    a = feature("x", "2026-01-01", mu=2.75, market_p=0.51)
    b = dict(a)
    b["market_u35_prob"] = 0.91
    assert gate2_model_mean(a) == gate2_model_mean(b)


def test_small_sample_falls_back_to_poisson():
    rows = [(feature(str(i), f"2025-01-{i+1:02d}", mu=2.8), 2 + (i % 2)) for i in range(MIN_DISPERSION_TRAIN_N - 1)]
    state = fit_dispersion(rows)
    assert state.fallback_poisson is True
    test_row = feature("future", "2026-01-01", mu=2.91)
    assert abs(predict_probability(test_row, state) - poisson_u35(2.91)) < 1e-12


def test_overdispersed_training_learns_positive_alpha():
    rows = []
    for i in range(MIN_DISPERSION_TRAIN_N + 20):
        total = 0 if i % 2 == 0 else 7
        rows.append((feature(str(i), f"2025-{1 + i // 28:02d}-{1 + i % 28:02d}", mu=2.8), total))
    state = fit_dispersion(rows)
    assert state.training_n == len(rows)
    assert state.raw_alpha > 0.0
    assert state.alpha > 0.0
    assert state.fallback_poisson is False
    p_nb = negative_binomial_u35(2.8, state.alpha)
    assert 0.0 < p_nb < 1.0
    assert abs(p_nb - poisson_u35(2.8)) > 1e-6


def test_date_batch_blocks_same_day_leakage():
    rows = []
    totals = {}
    for i in range(40):
        match_id = f"train-{i}"
        rows.append(feature(match_id, f"2025-{1 + i // 28:02d}-{1 + i % 28:02d}", mu=2.5 + 0.1 * (i % 6)))
        totals[match_id] = 1 if i % 3 else 6
    rows.extend([
        feature("target-a", "2026-03-01", mu=2.7),
        feature("target-b", "2026-03-01", mu=3.0),
    ])
    totals["target-a"] = 1
    totals["target-b"] = 5
    truth_store, backfill = stores(rows, totals)
    first = walk_forward_predict(truth_store, backfill)

    truth_store_2, backfill_2 = stores(rows, {**totals, "target-a": 9})
    second = walk_forward_predict(truth_store_2, backfill_2)

    f_by_id = {r["match_id"]: r for r in first["predictions"]}
    s_by_id = {r["match_id"]: r for r in second["predictions"]}
    assert f_by_id["target-a"]["training_n"] == f_by_id["target-b"]["training_n"]
    assert abs(f_by_id["target-b"]["alpha"] - s_by_id["target-b"]["alpha"]) < 1e-12
    assert abs(f_by_id["target-b"]["model_probability"] - s_by_id["target-b"]["model_probability"]) < 1e-12


def test_metrics_are_finite_and_diagnostic_only():
    rows = []
    totals = {}
    for i in range(45):
        match_id = f"m-{i}"
        rows.append(feature(match_id, f"2025-{1 + i // 28:02d}-{1 + i % 28:02d}", mu=2.45 + 0.11 * (i % 7), market_p=0.60))
        totals[match_id] = 2 if i % 4 else 5
    truth_store, backfill = stores(rows, totals)
    result = walk_forward_predict(truth_store, backfill)
    assert result["market_used_as_model_input"] is False
    assert result["evaluation_classification"] == "DEVELOPMENT_DIAGNOSTIC_CONSUMED_BENCHMARK"
    assert result["independent_validation_claimed"] is False
    assert result["summary"]["development_market_evaluable_n"] == 45
    assert result["summary"]["independent_validation_n"] == 0
    for row in result["predictions"]:
        assert 0.0 < row["model_probability"] < 1.0
    for value in result["metrics"].values():
        assert value is None or math.isfinite(value)


def main():
    test_market_not_model_input()
    test_small_sample_falls_back_to_poisson()
    test_overdispersed_training_learns_positive_alpha()
    test_date_batch_blocks_same_day_leakage()
    test_metrics_are_finite_and_diagnostic_only()
    print("M013_NEGATIVE_BINOMIAL=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
