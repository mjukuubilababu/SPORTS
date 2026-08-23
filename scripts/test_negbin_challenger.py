from __future__ import annotations

import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from negbin_challenger import (
    NBTrainingRow,
    build_training_rows,
    challenger_specification,
    fit_dispersion_mle,
    nb2_logpmf,
    negbin_u35,
)


def expect_error(fn, fragment: str) -> None:
    try:
        fn()
    except ValueError as exc:
        assert fragment in str(exc), (fragment, str(exc))
    else:
        raise AssertionError(f"Expected ValueError containing {fragment}")


def main() -> int:
    p = sum(math.exp(nb2_logpmf(k, 3.0, 2.0)) for k in range(50))
    assert abs(p - 1.0) < 1e-8

    p_low_mu = negbin_u35(2.0, 2.5)
    p_high_mu = negbin_u35(4.0, 2.5)
    assert 0.0 < p_high_mu < p_low_mu < 1.0

    poisson_u35 = sum(math.exp(-3.0) * 3.0 ** k / math.factorial(k) for k in range(4))
    near_poisson = negbin_u35(3.0, 1_000_000.0)
    assert abs(near_poisson - poisson_u35) < 1e-5

    counts = [0, 1, 2, 2, 3, 3, 4, 5, 6, 8] * 4
    rows = [
        NBTrainingRow(
            match_id=f"TRAIN-{i:03d}",
            date=f"2025-01-{(i % 28) + 1:02d}",
            season=2025,
            mu=3.0,
            total_goals=count,
        )
        for i, count in enumerate(counts)
    ]
    fit = fit_dispersion_mle(rows, lower_r=0.05, upper_r=500.0, iterations=120)
    assert fit.training_n == 40
    assert 0.05 <= fit.dispersion_r <= 500.0
    assert math.isfinite(fit.negbin_mean_nll)
    assert fit.negbin_mean_nll <= fit.poisson_mean_nll + 1e-8

    spec = challenger_specification(fit)
    assert spec["market_odds_as_model_input"] is False
    assert spec["holdout_a_used_for_training_or_tuning"] is False
    assert spec["mean_source"] == "GATE2_PRE_LINEUP_LAMBDA_UNCHANGED"

    fake_store = {
        "store_version": "CANONICAL_HISTORICAL_TRUTH_STORE_V0_1",
        "dataset_id": "TRAIN-DATA",
        "records": [{
            "match_id": "FROZEN-001",
            "result": {"verified": True},
            "final_score": {"home": 2, "away": 1},
        }],
    }
    fake_backfill = {
        "pipeline_version": "GATE1_TO_GATE2_CANONICAL_BACKFILL_V0_1",
        "source_dataset_id": "TRAIN-DATA",
        "features": [{
            "match_id": "FROZEN-001",
            "date": "2025-01-01",
            "season": 2025,
            "pre_lineup_lambda": 2.8,
        }],
    }
    expect_error(
        lambda: build_training_rows(
            fake_store,
            fake_backfill,
            training_season=2025,
            forbidden_match_ids=["FROZEN-001"],
        ),
        "FROZEN_MATCH_REUSED_FOR_TRAINING",
    )

    expect_error(lambda: fit_dispersion_mle(rows[:29]), "TRAINING_N_BELOW_MINIMUM")

    print("NEGBIN_CHALLENGER=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
