from __future__ import annotations

from math import isfinite, log
from random import Random
from typing import Dict, List, Sequence, Tuple

from m011r_bayesian_calibrator import EPS, MODEL_ID, MODEL_VERSION


SIGNIFICANCE_TEST_VERSION = "M011R_PAIRED_BOOTSTRAP_SIGNIFICANCE_V0_1"
DEFAULT_BOOTSTRAP_REPS = 20000
DEFAULT_SEED = 20260825
DEFAULT_CONFIDENCE = 0.95
EVALUATION_CLASSIFICATION = "CONSUMED_DEVELOPMENT_NOT_INDEPENDENT"


def _finite_probability(value: object) -> bool:
    return isinstance(value, (int, float)) and isfinite(float(value)) and 0.0 < float(value) < 1.0


def _clip(p: float) -> float:
    return min(max(float(p), EPS), 1.0 - EPS)


def _quantile(sorted_values: Sequence[float], q: float) -> float:
    if not sorted_values:
        raise ValueError("M011R_BOOTSTRAP_EMPTY_DISTRIBUTION")
    if not 0.0 <= q <= 1.0:
        raise ValueError("M011R_BOOTSTRAP_INVALID_QUANTILE")
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    pos = (len(sorted_values) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(sorted_values) - 1)
    frac = pos - lo
    return float(sorted_values[lo] * (1.0 - frac) + sorted_values[hi] * frac)


def _paired_loss_differences(predictions: Sequence[Dict]) -> Tuple[List[float], List[float], List[str]]:
    brier_diffs: List[float] = []
    logloss_diffs: List[float] = []
    match_ids: List[str] = []

    for row in predictions:
        if row.get("market_evaluable") is not True:
            continue
        outcome = row.get("outcome_u35")
        model_p = row.get("model_probability")
        market_p = row.get("market_probability")
        match_id = str(row.get("match_id", ""))

        if outcome not in (0, 1):
            raise ValueError(f"M011R_BOOTSTRAP_INVALID_OUTCOME_{match_id}")
        if not _finite_probability(model_p):
            raise ValueError(f"M011R_BOOTSTRAP_INVALID_MODEL_PROBABILITY_{match_id}")
        if not _finite_probability(market_p):
            raise ValueError(f"M011R_BOOTSTRAP_INVALID_MARKET_PROBABILITY_{match_id}")
        if not match_id:
            raise ValueError("M011R_BOOTSTRAP_MATCH_ID_REQUIRED")

        y = int(outcome)
        mp = float(model_p)
        kp = float(market_p)

        model_brier = (mp - y) ** 2
        market_brier = (kp - y) ** 2
        brier_diffs.append(market_brier - model_brier)

        model_logloss = -(y * log(_clip(mp)) + (1 - y) * log(1.0 - _clip(mp)))
        market_logloss = -(y * log(_clip(kp)) + (1 - y) * log(1.0 - _clip(kp)))
        logloss_diffs.append(market_logloss - model_logloss)
        match_ids.append(match_id)

    if not match_ids:
        raise ValueError("M011R_BOOTSTRAP_NO_MARKET_EVALUABLE_ROWS")
    if len(set(match_ids)) != len(match_ids):
        raise ValueError("M011R_BOOTSTRAP_DUPLICATE_MATCH_ID")
    return brier_diffs, logloss_diffs, match_ids


def _bootstrap_mean_distribution(values: Sequence[float], reps: int, rng: Random) -> List[float]:
    if reps < 1000:
        raise ValueError("M011R_BOOTSTRAP_REPS_MUST_BE_AT_LEAST_1000")
    n = len(values)
    out: List[float] = []
    for _ in range(reps):
        total = 0.0
        for _ in range(n):
            total += values[rng.randrange(n)]
        out.append(total / n)
    out.sort()
    return out


def _metric_summary(values: Sequence[float], distribution: Sequence[float], confidence: float) -> Dict:
    alpha = 1.0 - confidence
    lower = _quantile(distribution, alpha / 2.0)
    upper = _quantile(distribution, 1.0 - alpha / 2.0)
    observed = sum(values) / len(values)
    gt_zero = sum(1 for value in distribution if value > 0.0) / len(distribution)
    lt_zero = sum(1 for value in distribution if value < 0.0) / len(distribution)
    eq_zero = 1.0 - gt_zero - lt_zero
    return {
        "observed_delta": observed,
        "ci_lower": lower,
        "ci_upper": upper,
        "ci_excludes_zero": bool(lower > 0.0 or upper < 0.0),
        "direction": "M011R_BETTER" if observed > 0.0 else "MARKET_BETTER" if observed < 0.0 else "TIE",
        "bootstrap_probability_delta_gt_zero": gt_zero,
        "bootstrap_probability_delta_lt_zero": lt_zero,
        "bootstrap_probability_delta_eq_zero": eq_zero,
    }


def paired_bootstrap_significance(
    walk_forward: Dict,
    *,
    reps: int = DEFAULT_BOOTSTRAP_REPS,
    seed: int = DEFAULT_SEED,
    confidence: float = DEFAULT_CONFIDENCE,
) -> Dict:
    if walk_forward.get("model_id") != MODEL_ID:
        raise ValueError("M011R_BOOTSTRAP_MODEL_ID_MISMATCH")
    if walk_forward.get("model_version") != MODEL_VERSION:
        raise ValueError("M011R_BOOTSTRAP_MODEL_VERSION_MISMATCH")
    if walk_forward.get("market_used_as_model_input") is not False:
        raise ValueError("M011R_BOOTSTRAP_MARKET_INPUT_GOVERNANCE_VIOLATION")
    if walk_forward.get("market_used_as_benchmark_only") is not True:
        raise ValueError("M011R_BOOTSTRAP_MARKET_BENCHMARK_GOVERNANCE_REQUIRED")
    if not 0.5 < confidence < 1.0:
        raise ValueError("M011R_BOOTSTRAP_INVALID_CONFIDENCE")

    predictions = walk_forward.get("predictions")
    if not isinstance(predictions, list):
        raise ValueError("M011R_BOOTSTRAP_PREDICTIONS_REQUIRED")

    brier_diffs, logloss_diffs, match_ids = _paired_loss_differences(predictions)
    summary = walk_forward.get("summary") or {}
    if summary.get("market_evaluable_n") != len(match_ids):
        raise ValueError("M011R_BOOTSTRAP_MARKET_EVALUABLE_N_MISMATCH")

    rng = Random(seed)
    brier_distribution = _bootstrap_mean_distribution(brier_diffs, reps, rng)
    logloss_distribution = _bootstrap_mean_distribution(logloss_diffs, reps, rng)

    result = {
        "test_version": SIGNIFICANCE_TEST_VERSION,
        "model_id": MODEL_ID,
        "model_version": MODEL_VERSION,
        "evaluation_classification": EVALUATION_CLASSIFICATION,
        "resampling_method": "PAIRED_NONPARAMETRIC_BOOTSTRAP_PERCENTILE_CI",
        "resampling_unit": "MARKET_EVALUABLE_MATCH_PAIR",
        "delta_definition": "MARKET_LOSS_MINUS_M011R_LOSS_POSITIVE_MEANS_M011R_BETTER",
        "bootstrap_reps": reps,
        "seed": seed,
        "confidence": confidence,
        "market_evaluable_n": len(match_ids),
        "match_ids": match_ids,
        "delta_brier_vs_market": _metric_summary(brier_diffs, brier_distribution, confidence),
        "delta_logloss_vs_market": _metric_summary(logloss_diffs, logloss_distribution, confidence),
        "governance": {
            "analysis_only": True,
            "consumed_development_rows_only": True,
            "independent_validation": False,
            "new_evidence_rows_created": False,
            "model_refit_during_bootstrap": False,
            "model_parameters_changed": False,
            "frozen_rules_changed": False,
            "promotion_gate_changed": False,
            "automatic_promotion": False,
            "decision_weight": 0.0,
            "capital_effect": "NONE",
            "real_money": "NO",
        },
    }
    return result
