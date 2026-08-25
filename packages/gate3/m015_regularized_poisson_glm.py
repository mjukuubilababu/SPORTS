from __future__ import annotations

from dataclasses import asdict, dataclass
from math import exp, factorial, isfinite, log
from typing import Dict, List, Optional, Sequence, Tuple

from gate3_engine import brier_score, log_loss


MODEL_ID = "M015"
MODEL_VERSION = "REGULARIZED_POISSON_GLM_GATE2_COMPONENTS_V0_1"
MIN_TRAIN_N = 30
MAX_ITER = 50
TOL = 1e-8
EPS = 1e-12
MIN_LAMBDA = 0.20
MAX_LAMBDA = 6.00

# Preregistered before the first empirical M015 execution.
# The coefficient prior mirrors Gate2's frozen component weighting in a
# log-linear Poisson model. It is not selected against market outcomes.
PRIOR_MEAN = (0.0, 0.50, 0.30, 0.20)
PRIOR_PRECISION = (4.0, 12.0, 12.0, 12.0)


@dataclass(frozen=True)
class GLMState:
    training_n: int
    coefficients: Tuple[float, float, float, float]
    iterations: int
    converged: bool
    fallback_gate2: bool


@dataclass(frozen=True)
class WalkForwardPrediction:
    match_id: str
    date: str
    home: str
    away: str
    training_n: int
    gate2_lambda: float
    model_lambda: float
    gate2_probability: float
    model_probability: float
    market_probability: Optional[float]
    total_goals: Optional[int]
    outcome_u35: Optional[int]
    home_prior_n: int
    away_prior_n: int
    both_teams_n3: bool
    estimator: str
    development_market_evaluable: bool


def _finite_positive(value: object) -> bool:
    return isinstance(value, (int, float)) and isfinite(float(value)) and float(value) > 0.0


def _finite_probability(value: object) -> bool:
    return isinstance(value, (int, float)) and isfinite(float(value)) and 0.0 < float(value) < 1.0


def _component_total(row: Dict, home_key: str, away_key: str) -> float:
    h = row.get(home_key)
    a = row.get(away_key)
    if not _finite_positive(h) or not _finite_positive(a):
        raise ValueError(f"M015_COMPONENT_REQUIRED_{home_key}_{away_key}")
    total = float(h) + float(a)
    if not _finite_positive(total):
        raise ValueError("M015_POSITIVE_COMPONENT_TOTAL_REQUIRED")
    return total


def gate2_component_totals(row: Dict) -> Tuple[float, float, float]:
    """Extract prediction-time model inputs from Gate2 only.

    Returns (venue_total, last10_total, last5_total). Market fields and outcomes
    are deliberately not read by this function.
    """
    return (
        _component_total(row, "venue_home_lambda", "venue_away_lambda"),
        _component_total(row, "last10_home_lambda", "last10_away_lambda"),
        _component_total(row, "last5_home_lambda", "last5_away_lambda"),
    )


def gate2_model_mean(row: Dict) -> float:
    value = row.get("post_lineup_lambda")
    if not _finite_positive(value):
        raise ValueError("M015_GATE2_POST_LINEUP_LAMBDA_REQUIRED")
    return float(value)


def poisson_u35(mu: float) -> float:
    if not _finite_positive(mu):
        raise ValueError("M015_POSITIVE_MEAN_REQUIRED")
    return sum(exp(-mu) * (mu ** k) / factorial(k) for k in range(4))


def _design(row: Dict) -> Tuple[float, float, float, float]:
    venue, last10, last5 = gate2_component_totals(row)
    return (1.0, log(venue), log(last10), log(last5))


def _solve_linear(a: List[List[float]], b: List[float]) -> List[float]:
    n = len(b)
    aug = [list(a[i]) + [float(b[i])] for i in range(n)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(aug[r][col]))
        if abs(aug[pivot][col]) < 1e-12:
            raise ValueError("M015_SINGULAR_HESSIAN")
        aug[col], aug[pivot] = aug[pivot], aug[col]
        scale = aug[col][col]
        aug[col] = [v / scale for v in aug[col]]
        for r in range(n):
            if r == col:
                continue
            factor = aug[r][col]
            if factor == 0.0:
                continue
            aug[r] = [aug[r][c] - factor * aug[col][c] for c in range(n + 1)]
    return [aug[i][-1] for i in range(n)]


def _bounded_exp(eta: float) -> float:
    return min(MAX_LAMBDA, max(MIN_LAMBDA, exp(min(8.0, max(-8.0, eta)))))


def fit_glm(training_rows: Sequence[Tuple[Dict, int]]) -> GLMState:
    usable: List[Tuple[Tuple[float, float, float, float], int]] = []
    for row, total_goals in training_rows:
        if not isinstance(total_goals, int) or total_goals < 0:
            continue
        try:
            x = _design(row)
        except ValueError:
            continue
        usable.append((x, total_goals))

    n = len(usable)
    if n < MIN_TRAIN_N:
        return GLMState(
            training_n=n,
            coefficients=PRIOR_MEAN,
            iterations=0,
            converged=True,
            fallback_gate2=True,
        )

    beta = list(PRIOR_MEAN)
    converged = False
    iterations = 0

    for iteration in range(1, MAX_ITER + 1):
        gradient = [0.0] * 4
        hessian = [[0.0] * 4 for _ in range(4)]

        for x, y in usable:
            eta = sum(beta[j] * x[j] for j in range(4))
            mu = _bounded_exp(eta)
            residual = y - mu
            for j in range(4):
                gradient[j] += x[j] * residual
                for k in range(4):
                    hessian[j][k] += mu * x[j] * x[k]

        for j in range(4):
            gradient[j] -= PRIOR_PRECISION[j] * (beta[j] - PRIOR_MEAN[j])
            hessian[j][j] += PRIOR_PRECISION[j]

        delta = _solve_linear(hessian, gradient)
        beta = [beta[j] + delta[j] for j in range(4)]
        iterations = iteration
        if max(abs(v) for v in delta) < TOL:
            converged = True
            break

    return GLMState(
        training_n=n,
        coefficients=tuple(beta),
        iterations=iterations,
        converged=converged,
        fallback_gate2=False,
    )


def predict_mean(row: Dict, state: GLMState) -> float:
    gate2_mu = gate2_model_mean(row)
    if state.fallback_gate2:
        return gate2_mu
    x = _design(row)
    eta = sum(state.coefficients[j] * x[j] for j in range(4))
    return _bounded_exp(eta)


def _verified_score(record: Dict) -> Optional[Tuple[int, int]]:
    result = record.get("result") or {}
    score = record.get("final_score") or {}
    if result.get("verified") is not True:
        return None
    hg = score.get("home")
    ag = score.get("away")
    if not isinstance(hg, int) or not isinstance(ag, int) or hg < 0 or ag < 0:
        return None
    return hg, ag


def _market_probability(record: Dict, feature: Dict) -> Optional[float]:
    market = record.get("market") or {}
    p = feature.get("market_u35_prob")
    if market.get("status") != "ACCEPTED" or not _finite_probability(p):
        return None
    u35 = market.get("u35")
    o35 = market.get("o35")
    if not _finite_positive(u35) or float(u35) <= 1.0:
        return None
    if not _finite_positive(o35) or float(o35) <= 1.0:
        return None
    return float(p)


def _assert_exact_identity(record: Dict, feature: Dict) -> None:
    if str(record.get("home_team", "")) != str(feature.get("home", "")):
        raise ValueError("M015_HOME_IDENTITY_MISMATCH")
    if str(record.get("away_team", "")) != str(feature.get("away", "")):
        raise ValueError("M015_AWAY_IDENTITY_MISMATCH")


def walk_forward_predict(truth_store: Dict, gate2_backfill: Dict) -> Dict:
    if truth_store.get("store_version") != "CANONICAL_HISTORICAL_TRUTH_STORE_V0_1":
        raise ValueError("M015_UNSUPPORTED_TRUTH_STORE_VERSION")
    if gate2_backfill.get("pipeline_version") != "GATE1_TO_GATE2_CANONICAL_BACKFILL_V0_1":
        raise ValueError("M015_REQUIRES_GATE2_BACKFILL")
    if gate2_backfill.get("source_dataset_id") != truth_store.get("dataset_id"):
        raise ValueError("M015_DATASET_ID_MISMATCH")

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

        # One fit per date. Same-date outcomes are appended only after all
        # predictions on the date are complete.
        state = fit_glm(training)
        additions: List[Tuple[Dict, int]] = []

        for feature in batch:
            match_id = str(feature.get("match_id", ""))
            record = truth_by_id.get(match_id)
            if record is None:
                raise ValueError(f"M015_TRUTH_RECORD_MISSING_{match_id}")
            _assert_exact_identity(record, feature)
            score = _verified_score(record)

            try:
                gate2_mu = gate2_model_mean(feature)
                gate2_component_totals(feature)
                model_mu = predict_mean(feature, state)
            except ValueError:
                continue

            gate2_p = poisson_u35(gate2_mu)
            model_p = poisson_u35(model_mu)
            market_p = _market_probability(record, feature)
            total_goals = (score[0] + score[1]) if score is not None else None
            outcome = (
                1 if total_goals is not None and total_goals <= 3
                else (0 if total_goals is not None else None)
            )
            home_prior_n = int(feature.get("home_prior_n", 0))
            away_prior_n = int(feature.get("away_prior_n", 0))
            evaluable = market_p is not None and outcome is not None

            predictions.append(WalkForwardPrediction(
                match_id=match_id,
                date=date,
                home=str(feature.get("home", "")),
                away=str(feature.get("away", "")),
                training_n=state.training_n,
                gate2_lambda=gate2_mu,
                model_lambda=model_mu,
                gate2_probability=gate2_p,
                model_probability=model_p,
                market_probability=market_p,
                total_goals=total_goals,
                outcome_u35=outcome,
                home_prior_n=home_prior_n,
                away_prior_n=away_prior_n,
                both_teams_n3=(home_prior_n >= 3 and away_prior_n >= 3),
                estimator="GATE2_FALLBACK" if state.fallback_gate2 else "REGULARIZED_POISSON_GLM",
                development_market_evaluable=evaluable,
            ))

            if score is not None:
                additions.append((feature, score[0] + score[1]))

        training.extend(additions)

    eval_rows = [p for p in predictions if p.development_market_evaluable]
    model_probs = [p.model_probability for p in eval_rows]
    gate2_probs = [p.gate2_probability for p in eval_rows]
    market_probs = [float(p.market_probability) for p in eval_rows]
    outcomes = [int(p.outcome_u35) for p in eval_rows]
    both_n3 = [p for p in eval_rows if p.both_teams_n3]

    bm = brier_score(model_probs, outcomes)
    bg = brier_score(gate2_probs, outcomes)
    bk = brier_score(market_probs, outcomes)
    lm = log_loss(model_probs, outcomes)
    lg = log_loss(gate2_probs, outcomes)
    lk = log_loss(market_probs, outcomes)

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
            "min_train_n": MIN_TRAIN_N,
            "max_iter": MAX_ITER,
            "prior_mean": list(PRIOR_MEAN),
            "prior_precision": list(PRIOR_PRECISION),
            "min_lambda": MIN_LAMBDA,
            "max_lambda": MAX_LAMBDA,
            "distribution": "POISSON",
            "design": "intercept + log(venue_total) + log(last10_total) + log(last5_total)",
        },
        "summary": {
            "gate2_feature_rows": len(features),
            "model_predictions": len(predictions),
            "development_market_evaluable_n": len(eval_rows),
            "independent_validation_n": 0,
            "both_teams_n3_development_n": len(both_n3),
            "outcome_u35_1_n": sum(outcomes),
            "outcome_u35_0_n": len(outcomes) - sum(outcomes),
            "glm_prediction_n": sum(1 for p in predictions if p.estimator == "REGULARIZED_POISSON_GLM"),
            "gate2_fallback_prediction_n": sum(1 for p in predictions if p.estimator == "GATE2_FALLBACK"),
        },
        "metrics": {
            "brier_model": bm,
            "brier_gate2": bg,
            "brier_market": bk,
            "delta_brier_vs_gate2": (bg - bm) if bm is not None and bg is not None else None,
            "delta_brier_vs_market": (bk - bm) if bm is not None and bk is not None else None,
            "logloss_model": lm,
            "logloss_gate2": lg,
            "logloss_market": lk,
            "delta_logloss_vs_gate2": (lg - lm) if lm is not None and lg is not None else None,
            "delta_logloss_vs_market": (lk - lm) if lm is not None and lk is not None else None,
        },
        "predictions": [asdict(p) for p in predictions],
        "governance": {
            "gate2_components_are_only_prediction_time_model_inputs": True,
            "verified_goal_counts_train_only_strictly_later_predictions": True,
            "same_date_outcomes_cannot_train_same_date_predictions": True,
            "future_rows_cannot_train_past_predictions": True,
            "bookmaker_odds_do_not_enter_model": True,
            "market_is_development_benchmark_only": True,
            "consumed_benchmark_cannot_be_claimed_as_independent_validation": True,
            "paper_only_until_new_independent_evidence_and_existing_gates_pass": True,
        },
    }
