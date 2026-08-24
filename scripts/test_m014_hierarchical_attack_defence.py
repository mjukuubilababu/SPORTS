from __future__ import annotations

import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate3"))

from m014_hierarchical_attack_defence import (
    MIN_HIERARCHICAL_TRAIN_N,
    TrainingMatch,
    _pooled_rate,
    fit_hierarchy,
    predict_mean,
    walk_forward_predict,
)


def feature(match_id, date, home, away, mu=2.8, market_p=0.62, home_n=8, away_n=8):
    return {
        "match_id": match_id,
        "date": date,
        "home": home,
        "away": away,
        "home_prior_n": home_n,
        "away_prior_n": away_n,
        "post_lineup_lambda": mu,
        "model_u35_prob": 0.69,
        "market_u35_prob": market_p,
    }


def truth(match_id, home, away, hg, ag, market=True):
    return {
        "match_id": match_id,
        "home_team": home,
        "away_team": away,
        "result": {"verified": True},
        "final_score": {"home": hg, "away": ag},
        "market": {
            "status": "ACCEPTED" if market else "MISSING",
            "u35": 1.70 if market else None,
            "o35": 2.20 if market else None,
        },
    }


def stores(features, score_map):
    records = []
    for row in features:
        hg, ag = score_map[row["match_id"]]
        records.append(truth(row["match_id"], row["home"], row["away"], hg, ag))
    return (
        {
            "store_version": "CANONICAL_HISTORICAL_TRUTH_STORE_V0_1",
            "dataset_id": "SYNTHETIC-M014-TEST",
            "records": records,
        },
        {
            "pipeline_version": "GATE1_TO_GATE2_CANONICAL_BACKFILL_V0_1",
            "source_dataset_id": "SYNTHETIC-M014-TEST",
            "features": features,
        },
    )


def test_market_not_prediction_input():
    training = [
        TrainingMatch("H", "A", 2, 1)
        for _ in range(MIN_HIERARCHICAL_TRAIN_N)
    ]
    state = fit_hierarchy(training)
    a = feature("x", "2026-01-01", "H", "A", mu=2.7, market_p=0.51)
    b = dict(a)
    b["market_u35_prob"] = 0.91
    assert predict_mean(a, state, training) == predict_mean(b, state, training)


def test_partial_pooling_shrinks_extreme_rate():
    pooled = _pooled_rate(goal_sum=6, n=1, prior_mean=1.5)
    assert 1.5 < pooled < 6.0


def test_small_sample_falls_back_to_gate2():
    training = [
        TrainingMatch(f"H{i}", f"A{i}", 1, 1)
        for i in range(MIN_HIERARCHICAL_TRAIN_N - 1)
    ]
    state = fit_hierarchy(training)
    assert state.fallback_gate2 is True
    row = feature("future", "2026-01-01", "H", "A", mu=2.731)
    model_mu, hierarchical_mu, estimator, _, _ = predict_mean(row, state, training)
    assert estimator == "GATE2_FALLBACK"
    assert hierarchical_mu is None
    assert abs(model_mu - 2.731) < 1e-12


def test_date_batch_blocks_same_day_leakage():
    rows = []
    scores = {}
    homes = ["Alpha", "Beta", "Gamma", "Delta"]
    aways = ["Echo", "Foxtrot", "Golf", "Hotel"]
    for i in range(36):
        match_id = f"train-{i}"
        home = homes[i % len(homes)]
        away = aways[(i + 1) % len(aways)]
        rows.append(feature(
            match_id,
            f"2025-{1 + i // 28:02d}-{1 + i % 28:02d}",
            home,
            away,
            mu=2.55 + 0.05 * (i % 5),
        ))
        scores[match_id] = (1 + (i % 3), i % 2)

    rows.extend([
        feature("target-a", "2026-03-01", "Alpha", "Echo", mu=2.72),
        feature("target-b", "2026-03-01", "Beta", "Foxtrot", mu=2.68),
    ])
    scores["target-a"] = (1, 1)
    scores["target-b"] = (2, 1)

    truth_store, backfill = stores(rows, scores)
    first = walk_forward_predict(truth_store, backfill)

    changed = dict(scores)
    changed["target-a"] = (6, 2)
    truth_store_2, backfill_2 = stores(rows, changed)
    second = walk_forward_predict(truth_store_2, backfill_2)

    f = {r["match_id"]: r for r in first["predictions"]}
    s = {r["match_id"]: r for r in second["predictions"]}
    assert f["target-a"]["training_n"] == f["target-b"]["training_n"]
    assert abs(f["target-b"]["model_probability"] - s["target-b"]["model_probability"]) < 1e-12


def test_metrics_are_finite_and_normalized():
    rows = []
    scores = {}
    homes = ["A", "B", "C", "D", "E"]
    aways = ["F", "G", "H", "I", "J"]
    for i in range(45):
        match_id = f"m-{i}"
        rows.append(feature(
            match_id,
            f"2025-{1 + i // 28:02d}-{1 + i % 28:02d}",
            homes[i % 5],
            aways[(i + 2) % 5],
            mu=2.45 + 0.08 * (i % 6),
            market_p=0.60,
        ))
        scores[match_id] = (1 + (i % 3), i % 2)

    truth_store, backfill = stores(rows, scores)
    result = walk_forward_predict(truth_store, backfill)
    assert result["market_used_as_model_input"] is False
    assert result["summary"]["development_market_evaluable_n"] == 45
    assert result["summary"]["independent_validation_n"] == 0
    for row in result["predictions"]:
        assert 0.0 < row["model_probability"] < 1.0
    for value in result["metrics"].values():
        assert value is None or math.isfinite(value)


def test_identity_mismatch_fails_closed():
    rows = [feature("x", "2026-01-01", "Home", "Away")]
    truth_store, backfill = stores(rows, {"x": (1, 0)})
    truth_store["records"][0]["home_team"] = "Different"
    try:
        walk_forward_predict(truth_store, backfill)
    except ValueError as exc:
        assert str(exc) == "M014_HOME_IDENTITY_MISMATCH"
    else:
        raise AssertionError("identity mismatch must fail closed")


def main():
    test_market_not_prediction_input()
    test_partial_pooling_shrinks_extreme_rate()
    test_small_sample_falls_back_to_gate2()
    test_date_batch_blocks_same_day_leakage()
    test_metrics_are_finite_and_normalized()
    test_identity_mismatch_fails_closed()
    print("M014_HIERARCHICAL_ATTACK_DEFENCE=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
