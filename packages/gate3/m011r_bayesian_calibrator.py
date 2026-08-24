from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime
from math import exp, isfinite, log, log1p, sqrt
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from gate3_engine import brier_score, log_loss


MODEL_ID = "M011R"
MODEL_VERSION = "BAYESIAN_SHRINKAGE_CALIBRATOR_V0_1"
MIN_TRAIN_N = 30
EPS = 1e-9
MAX_ITER = 50
TOL = 1e-8

# Fixed before empirical challenger execution. These priors intentionally shrink
# the challenger toward the identity mapping of Gate2's existing probability.
# Market probabilities/odds are never model inputs.
PRIOR_MEAN = (0.0, 1.0, 0.0, 0.0)
PRIOR_PRECISION = (4.0, 8.0, 12.0, 12.0)


@dataclass(frozen=True)
class CalibratorState:
    training_n: int
    coefficients: Tuple[float, float, float, float]
    evidence_mean: float
    evidence_sd: float
    dispersion_mean: float
    dispersion_sd: float
    iterations: int
    converged: bool
    fallback_identity: bool


@dataclass(frozen=True)
class WalkForwardPrediction:
    match_id: str
    date: str
    home: str
    away: str
    training_n: int
    gate2_probability: float
    model_probability: float
    market_probability: Optional[float]
    outcome_u35: Optional[int]
    home_prior_n: int
    away_prior_n: int
    both_teams_n3: bool
    market_evaluable: bool


def _clip(p: float) -> float:
    return min(max(float(p), EPS), 1.0 - EPS)


def _logit(p: float) -> float:
    p = _clip(p)
    return log(p / (1.0 - p))


def _sigmoid(z: float) -> float:
    if z >= 0:
        e = exp(-z)
        return 1.0 / (1.0 + e)
    e = exp(z)
    return e / (1.0 + e)


def _finite_probability(value: object) -> bool:
    return isinstance(value, (int, float)) and isfinite(float(value)) and 0.0 < float(value) < 1.0


def _component_total(row: Dict, home_key: str, away_key: str) -> Optional[float]:
    h = row.get(home_key)
    a = row.get(away_key)
    if not isinstance(h, (int, float)) or not isinstance(a, (int, float)):
        return None
    if not isfinite(float(h)) or not isfinite(float(a)):
        return None
    return float(h) + float(a)


def gate2_model_features(row: Dict) -> Tuple[float, float, float]:
    """Extract model-only inputs from a Gate2 feature-backfill row.

    Returns (gate2_probability, evidence_maturity, component_dispersion).
    The function deliberately never reads market odds/probabilities or outcomes.
    """
    p = row.get("model_u35_prob")
    if not _finite_probability(p):
        raise ValueError("M011R_GATE2_MODEL_PROBABILITY_REQUIRED")

    home_n = row.get("home_prior_n")
    away_n = row.get("away_prior_n")
    if not isinstance(home_n, int) or not isinstance(away_n, int) or home_n < 0 or away_n < 0:
        raise ValueError("M011R_GATE2_PRIOR_COUNTS_REQUIRED")
    evidence = log1p(min(home_n, away_n))

    totals = [
        _component_total(row, "venue_home_lambda", "venue_away_lambda"),
        _component_total(row, "last10_home_lambda", "last10_away_lambda"),
        _component_total(row, "last5_home_lambda", "last5_away_lambda"),
    ]
    valid = [x for x in totals if x is not None]
    if len(valid) < 2:
        dispersion = 0.0
    else:
        dispersion = max(valid) - min(valid)
    return float(p), evidence, dispersion


def _mean_sd(values: Sequence[float]) -> Tuple[float, float]:
    if not values:
        return 0.0, 1.0
    mean = sum(values) / len(values)
    if len(values) < 2:
        return mean, 1.0
    var = sum((x - mean) ** 2 for x in values) / len(values)
    sd = sqrt(var)
    return mean, sd if sd > 1e-9 else 1.0


def _design(row: Dict, evidence_mean: float, evidence_sd: float,
            dispersion_mean: float, dispersion_sd: float) -> Tuple[float, float, float, float]:
    p, evidence, dispersion = gate2_model_features(row)
    return (
        1.0,
        _logit(p),
        (evidence - evidence_mean) / evidence_sd,
        (dispersion - dispersion_mean) / dispersion_sd,
    )


def _solve_linear(a: List[List[float]], b: List[float]) -> List[float]:
    n = len(b)
    aug = [list(a[i]) + [float(b[i])] for i in range(n)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(aug[r][col]))
        if abs(aug[pivot][col]) < 1e-12:
            raise ValueError("M011R_SINGULAR_HESSIAN")
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


def fit_calibrator(training_rows: Sequence[Tuple[Dict, int]]) -> CalibratorState:
    usable: List[Tuple[Dict, int]] = []
    evidences: List[float] = []
    dispersions: List[float] = []
    for row, outcome in training_rows:
        if outcome not in (0, 1):
            continue
        try:
            _, evidence, dispersion = gate2_model_features(row)
        except ValueError:
            continue
        usable.append((row, int(outcome)))
        evidences.append(evidence)
        dispersions.append(dispersion)

    evidence_mean, evidence_sd = _mean_sd(evidences)
    dispersion_mean, dispersion_sd = _mean_sd(dispersions)
    n = len(usable)

    if n < MIN_TRAIN_N:
        return CalibratorState(
            training_n=n,
            coefficients=PRIOR_MEAN,
            evidence_mean=evidence_mean,
            evidence_sd=evidence_sd,
            dispersion_mean=dispersion_mean,
            dispersion_sd=dispersion_sd,
            iterations=0,
            converged=True,
            fallback_identity=True,
        )

    xs = [_design(row, evidence_mean, evidence_sd, dispersion_mean, dispersion_sd) for row, _ in usable]
    ys = [outcome for _, outcome in usable]
    beta = list(PRIOR_MEAN)
    converged = False
    iterations = 0

    for iteration in range(1, MAX_ITER + 1):
        gradient = [0.0] * 4
        hessian = [[0.0] * 4 for _ in range(4)]

        for x, y in zip(xs, ys):
            z = sum(beta[j] * x[j] for j in range(4))
            p = _sigmoid(z)
            residual = y - p
            w = max(p * (1.0 - p), 1e-9)
            for j in range(4):
                gradient[j] += x[j] * residual
                for k in range(4):
                    hessian[j][k] += w * x[j] * x[k]

        for j in range(4):
            gradient[j] -= PRIOR_PRECISION[j] * (beta[j] - PRIOR_MEAN[j])
            hessian[j][j] += PRIOR_PRECISION[j]

        delta = _solve_linear(hessian, gradient)
        beta = [beta[j] + delta[j] for j in range(4)]
        iterations = iteration
        if max(abs(v) for v in delta) < TOL:
            converged = True
            break

    return CalibratorState(
        training_n=n,
        coefficients=tuple(beta),
        evidence_mean=evidence_mean,
        evidence_sd=evidence_sd,
        dispersion_mean=dispersion_mean,
        dispersion_sd=dispersion_sd,
        iterations=iterations,
        converged=converged,
        fallback_identity=False,
    )


def predict_probability(row: Dict, state: CalibratorState) -> float:
    x = _design(
        row,
        state.evidence_mean,
        state.evidence_sd,
        state.dispersion_mean,
        state.dispersion_sd,
    )
    z = sum(state.coefficients[j] * x[j] for j in range(4))
    return _clip(_sigmoid(z))


def _verified_outcome(record: Dict) -> Optional[int]:
    result = record.get("result") or {}
    score = record.get("final_score") or {}
    if result.get("verified") is not True:
        return None
    hg = score.get("home")
    ag = score.get("away")
    if not isinstance(hg, int) or not isinstance(ag, int) or hg < 0 or ag < 0:
        return None
    return 1 if hg + ag <= 3 else 0


def _market_probability(record: Dict, feature: Dict) -> Optional[float]:
    market = record.get("market") or {}
    p = feature.get("market_u35_prob")
    if market.get("status") != "ACCEPTED" or not _finite_probability(p):
        return None
    if not isinstance(market.get("u35"), (int, float)) or float(market["u35"]) <= 1.0:
        return None
    if not isinstance(market.get("o35"), (int, float)) or float(market["o35"]) <= 1.0:
        return None
    return float(p)


def walk_forward_predict(truth_store: Dict, gate2_backfill: Dict) -> Dict:
    if truth_store.get("store_version") != "CANONICAL_HISTORICAL_TRUTH_STORE_V0_1":
        raise ValueError("M011R_UNSUPPORTED_TRUTH_STORE_VERSION")
    if gate2_backfill.get("pipeline_version") != "GATE1_TO_GATE2_CANONICAL_BACKFILL_V0_1":
        raise ValueError("M011R_REQUIRES_GATE2_BACKFILL")
    if gate2_backfill.get("source_dataset_id") != truth_store.get("dataset_id"):
        raise ValueError("M011R_DATASET_ID_MISMATCH")

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

        # Critical anti-leakage rule: one state for the whole date batch.
        # Outcomes from this date are appended only after every match on the date is predicted.
        state = fit_calibrator(training)
        batch_training_additions: List[Tuple[Dict, int]] = []

        for feature in batch:
            match_id = str(feature.get("match_id", ""))
            record = truth_by_id.get(match_id)
            if record is None:
                raise ValueError(f"M011R_TRUTH_RECORD_MISSING_{match_id}")
            outcome = _verified_outcome(record)

            try:
                gate2_p, _, _ = gate2_model_features(feature)
                model_p = predict_probability(feature, state)
            except ValueError:
                if outcome is not None:
                    # A result may later train the model only if Gate2 model features exist.
                    pass
                continue

            market_p = _market_probability(record, feature)
            home_n = int(feature.get("home_prior_n", 0))
            away_n = int(feature.get("away_prior_n", 0))
            evaluable = market_p is not None and outcome is not None
            predictions.append(WalkForwardPrediction(
                match_id=match_id,
                date=date,
                home=str(feature.get("home", "")),
                away=str(feature.get("away", "")),
                training_n=state.training_n,
                gate2_probability=gate2_p,
                model_probability=model_p,
                market_probability=market_p,
                outcome_u35=outcome,
                home_prior_n=home_n,
                away_prior_n=away_n,
                both_teams_n3=(home_n >= 3 and away_n >= 3),
                market_evaluable=evaluable,
            ))
            if outcome is not None:
                batch_training_additions.append((feature, outcome))

        training.extend(batch_training_additions)

    eval_rows = [p for p in predictions if p.market_evaluable]
    model_probs = [p.model_probability for p in eval_rows]
    market_probs = [float(p.market_probability) for p in eval_rows]
    outcomes = [int(p.outcome_u35) for p in eval_rows]
    both_n3 = [p for p in eval_rows if p.both_teams_n3]

    bm = brier_score(model_probs, outcomes)
    bk = brier_score(market_probs, outcomes)
    lm = log_loss(model_probs, outcomes)
    lk = log_loss(market_probs, outcomes)

    return {
        "model_id": MODEL_ID,
        "model_version": MODEL_VERSION,
        "source_dataset_id": truth_store.get("dataset_id"),
        "gate2_pipeline_version": gate2_backfill.get("pipeline_version"),
        "walk_forward_semantics": "DATE_BATCHED_STRICTLY_PRIOR_DATES_ONLY",
        "market_used_as_model_input": False,
        "market_used_as_benchmark_only": True,
        "hyperparameters_selected_on_evaluation_sample": False,
        "fixed_prior_mean": list(PRIOR_MEAN),
        "fixed_prior_precision": list(PRIOR_PRECISION),
        "min_training_n_before_map_fit": MIN_TRAIN_N,
        "summary": {
            "gate2_feature_rows": len(features),
            "model_predictions": len(predictions),
            "market_evaluable_n": len(eval_rows),
            "both_teams_n3_n": len(both_n3),
            "outcome_u35_1_n": sum(outcomes),
            "outcome_u35_0_n": len(outcomes) - sum(outcomes),
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
            "gate2_output_is_only_model_feature_source": True,
            "truth_join_occurs_for_training_after_prediction_date_batch": True,
            "same_date_outcomes_cannot_train_same_date_predictions": True,
            "future_rows_cannot_train_past_predictions": True,
            "bookmaker_odds_do_not_enter_design_matrix": True,
            "market_is_champion_benchmark_only": True,
            "paper_only_until_all_existing_gates_pass": True,
        },
    }
