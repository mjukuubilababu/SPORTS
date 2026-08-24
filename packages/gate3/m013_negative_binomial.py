from __future__ import annotations

from dataclasses import asdict, dataclass
from math import exp, factorial, isfinite, log
from typing import Dict, List, Optional, Sequence, Tuple

from gate3_engine import brier_score, log_loss


MODEL_ID = "M013"
MODEL_VERSION = "NEGATIVE_BINOMIAL_TOTAL_GOALS_V0_1"
MIN_DISPERSION_TRAIN_N = 30
DISPERSION_PRIOR_STRENGTH = 30.0
MAX_ALPHA = 2.0
EPS = 1e-12

# Preregistered before the first empirical execution of M013.
# Variance parameterization: Var(Y) = mu + alpha * mu^2.
# alpha=0 is the Poisson limit. The dispersion estimate is learned only from
# strictly earlier verified scorelines and is shrunk toward alpha=0.


@dataclass(frozen=True)
class DispersionState:
    training_n: int
    raw_alpha: float
    shrinkage_weight: float
    alpha: float
    fallback_poisson: bool


@dataclass(frozen=True)
class WalkForwardPrediction:
    match_id: str
    date: str
    home: str
    away: str
    training_n: int
    mean_lambda: float
    alpha: float
    distribution: str
    model_probability: float
    market_probability: Optional[float]
    total_goals: Optional[int]
    outcome_u35: Optional[int]
    home_prior_n: int
    away_prior_n: int
    both_teams_n3: bool
    development_market_evaluable: bool


def _finite_positive(value: object) -> bool:
    return isinstance(value, (int, float)) and isfinite(float(value)) and float(value) > 0.0


def _finite_probability(value: object) -> bool:
    return isinstance(value, (int, float)) and isfinite(float(value)) and 0.0 < float(value) < 1.0


def gate2_model_mean(row: Dict) -> float:
    """Return M013's prediction-time mean from Gate2 only.

    Market fields and outcomes are deliberately not read here.
    """
    value = row.get("post_lineup_lambda")
    if not _finite_positive(value):
        raise ValueError("M013_GATE2_POST_LINEUP_LAMBDA_REQUIRED")
    return float(value)


def poisson_u35(mu: float) -> float:
    if not _finite_positive(mu):
        raise ValueError("M013_POSITIVE_MEAN_REQUIRED")
    return sum(exp(-mu) * (mu ** k) / factorial(k) for k in range(4))


def negative_binomial_u35(mu: float, alpha: float) -> float:
    """P(total goals <= 3) under NB2 parameterization.

    Var(Y)=mu+alpha*mu^2. For alpha close to zero, use the Poisson limit.
    """
    if not _finite_positive(mu):
        raise ValueError("M013_POSITIVE_MEAN_REQUIRED")
    if not isinstance(alpha, (int, float)) or not isfinite(float(alpha)) or float(alpha) < 0.0:
        raise ValueError("M013_NONNEGATIVE_ALPHA_REQUIRED")
    alpha = float(alpha)
    if alpha <= EPS:
        return poisson_u35(mu)

    r = 1.0 / alpha
    q = mu / (r + mu)
    log_p0 = r * log(r / (r + mu))
    pk = exp(log_p0)
    total = pk
    for k in range(3):
        pk = pk * ((k + r) / (k + 1.0)) * q
        total += pk
    return min(max(total, EPS), 1.0 - EPS)


def fit_dispersion(training_rows: Sequence[Tuple[Dict, int]]) -> DispersionState:
    usable: List[Tuple[float, int]] = []
    for row, total_goals in training_rows:
        if not isinstance(total_goals, int) or total_goals < 0:
            continue
        try:
            mu = gate2_model_mean(row)
        except ValueError:
            continue
        usable.append((mu, total_goals))

    n = len(usable)
    if n < MIN_DISPERSION_TRAIN_N:
        return DispersionState(
            training_n=n,
            raw_alpha=0.0,
            shrinkage_weight=0.0,
            alpha=0.0,
            fallback_poisson=True,
        )

    numerator = sum(((y - mu) ** 2) - mu for mu, y in usable)
    denominator = sum(mu * mu for mu, _ in usable)
    raw_alpha = max(0.0, numerator / denominator) if denominator > EPS else 0.0

    # Fixed regularization chosen before empirical execution. It prevents a small
    # historical sample from producing an extreme tail parameter.
    shrinkage_weight = n / (n + DISPERSION_PRIOR_STRENGTH)
    alpha = min(MAX_ALPHA, max(0.0, raw_alpha * shrinkage_weight))
    return DispersionState(
        training_n=n,
        raw_alpha=raw_alpha,
        shrinkage_weight=shrinkage_weight,
        alpha=alpha,
        fallback_poisson=alpha <= EPS,
    )


def predict_probability(row: Dict, state: DispersionState) -> float:
    mu = gate2_model_mean(row)
    return negative_binomial_u35(mu, state.alpha)


def _verified_total_goals(record: Dict) -> Optional[int]:
    result = record.get("result") or {}
    score = record.get("final_score") or {}
    if result.get("verified") is not True:
        return None
    hg = score.get("home")
    ag = score.get("away")
    if not isinstance(hg, int) or not isinstance(ag, int) or hg < 0 or ag < 0:
        return None
    return hg + ag


def _market_probability(record: Dict, feature: Dict) -> Optional[float]:
    market = record.get("market") or {}
    p = feature.get("market_u35_prob")
    if market.get("status") != "ACCEPTED" or not _finite_probability(p):
        return None
    if not _finite_positive(market.get("u35")) or float(market["u35"]) <= 1.0:
        return None
    if not _finite_positive(market.get("o35")) or float(market["o35"]) <= 1.0:
        return None
    return float(p)


def walk_forward_predict(truth_store: Dict, gate2_backfill: Dict) -> Dict:
    if truth_store.get("store_version") != "CANONICAL_HISTORICAL_TRUTH_STORE_V0_1":
        raise ValueError("M013_UNSUPPORTED_TRUTH_STORE_VERSION")
    if gate2_backfill.get("pipeline_version") != "GATE1_TO_GATE2_CANONICAL_BACKFILL_V0_1":
        raise ValueError("M013_REQUIRES_GATE2_BACKFILL")
    if gate2_backfill.get("source_dataset_id") != truth_store.get("dataset_id"):
        raise ValueError("M013_DATASET_ID_MISMATCH")

    truth_by_id = {r["match_id"]: r for r in truth_store.get("records", [])}
    features = sorted(
        gate2_backfill.get("features", []),
        key=lambda r: (str(r.get("date", "")), str(r.get("match_id", ""))),
    )

    training: List[Tuple[Dict, int]] = []
    predictions: List[WalkForwardPrediction] = []

    i = 0
    while i < len(features):
        date = str(features[i].get("date", ""))
        batch: List[Dict] = []
        while i < len(features) and str(features[i].get("date", "")) == date:
            batch.append(features[i])
            i += 1

        # One state for the whole date. Same-date results are unavailable to every
        # prediction in this batch and are appended only after all predictions.
        state = fit_dispersion(training)
        additions: List[Tuple[Dict, int]] = []

        for feature in batch:
            match_id = str(feature.get("match_id", ""))
            record = truth_by_id.get(match_id)
            if record is None:
                raise ValueError(f"M013_TRUTH_RECORD_MISSING_{match_id}")
            total_goals = _verified_total_goals(record)

            try:
                mu = gate2_model_mean(feature)
                model_p = predict_probability(feature, state)
            except ValueError:
                continue

            market_p = _market_probability(record, feature)
            outcome = 1 if total_goals is not None and total_goals <= 3 else (0 if total_goals is not None else None)
            home_n = int(feature.get("home_prior_n", 0))
            away_n = int(feature.get("away_prior_n", 0))
            evaluable = market_p is not None and outcome is not None
            predictions.append(WalkForwardPrediction(
                match_id=match_id,
                date=date,
                home=str(feature.get("home", "")),
                away=str(feature.get("away", "")),
                training_n=state.training_n,
                mean_lambda=mu,
                alpha=state.alpha,
                distribution="POISSON_FALLBACK" if state.fallback_poisson else "NEGATIVE_BINOMIAL",
                model_probability=model_p,
                market_probability=market_p,
                total_goals=total_goals,
                outcome_u35=outcome,
                home_prior_n=home_n,
                away_prior_n=away_n,
                both_teams_n3=(home_n >= 3 and away_n >= 3),
                development_market_evaluable=evaluable,
            ))
            if total_goals is not None:
                additions.append((feature, total_goals))

        training.extend(additions)

    eval_rows = [p for p in predictions if p.development_market_evaluable]
    model_probs = [p.model_probability for p in eval_rows]
    market_probs = [float(p.market_probability) for p in eval_rows]
    outcomes = [int(p.outcome_u35) for p in eval_rows]
    both_n3 = [p for p in eval_rows if p.both_teams_n3]

    bm = brier_score(model_probs, outcomes)
    bk = brier_score(market_probs, outcomes)
    lm = log_loss(model_probs, outcomes)
    lk = log_loss(market_probs, outcomes)

    alphas = [p.alpha for p in predictions]
    return {
        "model_id": MODEL_ID,
        "model_version": MODEL_VERSION,
        "source_dataset_id": truth_store.get("dataset_id"),
        "gate2_pipeline_version": gate2_backfill.get("pipeline_version"),
        "walk_forward_semantics": "DATE_BATCHED_STRICTLY_PRIOR_DATES_ONLY",
        "evaluation_classification": "DEVELOPMENT_DIAGNOSTIC_CONSUMED_BENCHMARK",
        "independent_validation_claimed": False,
        "market_used_as_model_input": False,
        "market_used_as_benchmark_only": True,
        "hyperparameters_selected_on_evaluation_sample": False,
        "preregistered_parameters": {
            "min_dispersion_train_n": MIN_DISPERSION_TRAIN_N,
            "dispersion_prior_strength": DISPERSION_PRIOR_STRENGTH,
            "max_alpha": MAX_ALPHA,
            "variance_parameterization": "mu + alpha * mu^2",
            "prior_target_alpha": 0.0,
        },
        "summary": {
            "gate2_feature_rows": len(features),
            "model_predictions": len(predictions),
            "development_market_evaluable_n": len(eval_rows),
            "independent_validation_n": 0,
            "both_teams_n3_development_n": len(both_n3),
            "outcome_u35_1_n": sum(outcomes),
            "outcome_u35_0_n": len(outcomes) - sum(outcomes),
            "negative_binomial_prediction_n": sum(1 for p in predictions if p.distribution == "NEGATIVE_BINOMIAL"),
            "poisson_fallback_prediction_n": sum(1 for p in predictions if p.distribution == "POISSON_FALLBACK"),
            "max_walk_forward_alpha": max(alphas) if alphas else 0.0,
        },
        "metrics": {
            "brier_model": bm,
            "brier_market": bk,
            "delta_brier_vs_market": (bk - bm) if bm is not None and bk is not None else None,
            "logloss_model": lm,
            "logloss_market": lk,
            "delta_logloss_vs_market": (lk - lm) if lm is not None and lk is not None else None,
        },
        "predictions": [asdict(p) for p in predictions],
        "governance": {
            "gate2_post_lineup_lambda_is_only_prediction_time_model_input": True,
            "dispersion_uses_verified_goals_from_strictly_prior_dates_only": True,
            "same_date_outcomes_cannot_train_same_date_predictions": True,
            "future_rows_cannot_train_past_predictions": True,
            "bookmaker_odds_do_not_enter_model": True,
            "market_is_development_benchmark_only": True,
            "consumed_benchmark_cannot_be_claimed_as_independent_validation": True,
            "paper_only_until_new_independent_evidence_and_existing_gates_pass": True,
        },
    }
