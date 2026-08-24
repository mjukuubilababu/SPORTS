from __future__ import annotations

from dataclasses import asdict, dataclass
from math import exp, factorial, isfinite
from typing import Dict, List, Optional, Sequence, Tuple

from gate3_engine import brier_score, log_loss


MODEL_ID = "M014"
MODEL_VERSION = "HIERARCHICAL_ATTACK_DEFENCE_PARTIAL_POOLING_V0_1"
MIN_HIERARCHICAL_TRAIN_N = 30
TEAM_PRIOR_MATCHES = 5.0
HIERARCHICAL_BLEND_WEIGHT = 0.50
EPS = 1e-12

# Preregistered before first empirical M014 execution.
# Purpose: isolate mean-lambda estimation from the M013 distribution-family test.
# Distribution remains Poisson. Team venue attack/defence rates are partially
# pooled toward strictly-prior global home/away scoring means, then blended
# 50/50 with Gate2's pre-match post_lineup_lambda. Market data is benchmark-only.


@dataclass(frozen=True)
class TrainingMatch:
    home: str
    away: str
    home_goals: int
    away_goals: int


@dataclass(frozen=True)
class HierarchyState:
    training_n: int
    global_home_mean: float
    global_away_mean: float
    fallback_gate2: bool


@dataclass(frozen=True)
class WalkForwardPrediction:
    match_id: str
    date: str
    home: str
    away: str
    training_n: int
    gate2_lambda: float
    hierarchical_lambda: Optional[float]
    model_lambda: float
    model_probability: float
    gate2_probability: float
    market_probability: Optional[float]
    home_home_n: int
    away_away_n: int
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


def gate2_model_mean(row: Dict) -> float:
    """Prediction-time Gate2 anchor. Market and outcome fields are not read."""
    value = row.get("post_lineup_lambda")
    if not _finite_positive(value):
        raise ValueError("M014_GATE2_POST_LINEUP_LAMBDA_REQUIRED")
    return float(value)


def poisson_u35(mu: float) -> float:
    if not _finite_positive(mu):
        raise ValueError("M014_POSITIVE_MEAN_REQUIRED")
    p = sum(exp(-mu) * (mu ** k) / factorial(k) for k in range(4))
    return min(max(p, EPS), 1.0 - EPS)


def fit_hierarchy(training: Sequence[TrainingMatch]) -> HierarchyState:
    usable = [
        m for m in training
        if isinstance(m.home_goals, int)
        and isinstance(m.away_goals, int)
        and m.home_goals >= 0
        and m.away_goals >= 0
    ]
    n = len(usable)
    if n < MIN_HIERARCHICAL_TRAIN_N:
        return HierarchyState(
            training_n=n,
            global_home_mean=0.0,
            global_away_mean=0.0,
            fallback_gate2=True,
        )

    home_mean = sum(m.home_goals for m in usable) / n
    away_mean = sum(m.away_goals for m in usable) / n
    if home_mean <= EPS or away_mean <= EPS:
        return HierarchyState(
            training_n=n,
            global_home_mean=home_mean,
            global_away_mean=away_mean,
            fallback_gate2=True,
        )
    return HierarchyState(
        training_n=n,
        global_home_mean=home_mean,
        global_away_mean=away_mean,
        fallback_gate2=False,
    )


def _pooled_rate(goal_sum: int, n: int, prior_mean: float) -> float:
    if n < 0 or goal_sum < 0 or not _finite_positive(prior_mean):
        raise ValueError("M014_INVALID_POOLING_INPUT")
    return (float(goal_sum) + TEAM_PRIOR_MATCHES * prior_mean) / (float(n) + TEAM_PRIOR_MATCHES)


def _team_venue_components(
    home: str,
    away: str,
    state: HierarchyState,
    training: Sequence[TrainingMatch],
) -> Tuple[float, float, int, int]:
    if state.fallback_gate2:
        raise ValueError("M014_HIERARCHY_NOT_READY")

    home_rows = [m for m in training if m.home == home]
    away_rows = [m for m in training if m.away == away]

    home_attack = _pooled_rate(
        sum(m.home_goals for m in home_rows),
        len(home_rows),
        state.global_home_mean,
    )
    home_defence_concede = _pooled_rate(
        sum(m.away_goals for m in home_rows),
        len(home_rows),
        state.global_away_mean,
    )
    away_attack = _pooled_rate(
        sum(m.away_goals for m in away_rows),
        len(away_rows),
        state.global_away_mean,
    )
    away_defence_concede = _pooled_rate(
        sum(m.home_goals for m in away_rows),
        len(away_rows),
        state.global_home_mean,
    )

    # Standard multiplicative attack x opponent-defence construction, normalized
    # by the global scoring baseline. Partial pooling prevents zero/extreme rates.
    home_mu = (home_attack * away_defence_concede) / state.global_home_mean
    away_mu = (away_attack * home_defence_concede) / state.global_away_mean
    total = home_mu + away_mu
    if not _finite_positive(total):
        raise ValueError("M014_NONPOSITIVE_HIERARCHICAL_LAMBDA")
    return total, home_mu, len(home_rows), len(away_rows)


def predict_mean(
    row: Dict,
    state: HierarchyState,
    training: Sequence[TrainingMatch],
) -> Tuple[float, Optional[float], str, int, int]:
    gate2_mu = gate2_model_mean(row)
    if state.fallback_gate2:
        return gate2_mu, None, "GATE2_FALLBACK", 0, 0

    hierarchical_mu, _, home_home_n, away_away_n = _team_venue_components(
        str(row.get("home", "")),
        str(row.get("away", "")),
        state,
        training,
    )
    model_mu = (
        (1.0 - HIERARCHICAL_BLEND_WEIGHT) * gate2_mu
        + HIERARCHICAL_BLEND_WEIGHT * hierarchical_mu
    )
    if not _finite_positive(model_mu):
        raise ValueError("M014_NONPOSITIVE_MODEL_LAMBDA")
    return model_mu, hierarchical_mu, "HIERARCHICAL_BLEND", home_home_n, away_away_n


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
        raise ValueError("M014_HOME_IDENTITY_MISMATCH")
    if str(record.get("away_team", "")) != str(feature.get("away", "")):
        raise ValueError("M014_AWAY_IDENTITY_MISMATCH")


def walk_forward_predict(truth_store: Dict, gate2_backfill: Dict) -> Dict:
    if truth_store.get("store_version") != "CANONICAL_HISTORICAL_TRUTH_STORE_V0_1":
        raise ValueError("M014_UNSUPPORTED_TRUTH_STORE_VERSION")
    if gate2_backfill.get("pipeline_version") != "GATE1_TO_GATE2_CANONICAL_BACKFILL_V0_1":
        raise ValueError("M014_REQUIRES_GATE2_BACKFILL")
    if gate2_backfill.get("source_dataset_id") != truth_store.get("dataset_id"):
        raise ValueError("M014_DATASET_ID_MISMATCH")

    truth_by_id = {r["match_id"]: r for r in truth_store.get("records", [])}
    features = sorted(
        gate2_backfill.get("features", []),
        key=lambda r: (str(r.get("date", "")), str(r.get("match_id", ""))),
    )

    training: List[TrainingMatch] = []
    predictions: List[WalkForwardPrediction] = []

    i = 0
    while i < len(features):
        date = str(features[i].get("date", ""))
        batch: List[Dict] = []
        while i < len(features) and str(features[i].get("date", "")) == date:
            batch.append(features[i])
            i += 1

        # Critical anti-hindsight rule: all predictions on one date share the same
        # state built only from earlier dates. Same-date scores are appended later.
        state = fit_hierarchy(training)
        additions: List[TrainingMatch] = []

        for feature in batch:
            match_id = str(feature.get("match_id", ""))
            record = truth_by_id.get(match_id)
            if record is None:
                raise ValueError(f"M014_TRUTH_RECORD_MISSING_{match_id}")
            _assert_exact_identity(record, feature)
            score = _verified_score(record)

            try:
                gate2_mu = gate2_model_mean(feature)
                model_mu, hierarchical_mu, estimator, home_home_n, away_away_n = predict_mean(
                    feature, state, training
                )
            except ValueError:
                if score is not None:
                    additions.append(TrainingMatch(
                        home=str(feature.get("home", "")),
                        away=str(feature.get("away", "")),
                        home_goals=score[0],
                        away_goals=score[1],
                    ))
                continue

            model_p = poisson_u35(model_mu)
            gate2_p = poisson_u35(gate2_mu)
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
                hierarchical_lambda=hierarchical_mu,
                model_lambda=model_mu,
                model_probability=model_p,
                gate2_probability=gate2_p,
                market_probability=market_p,
                home_home_n=home_home_n,
                away_away_n=away_away_n,
                total_goals=total_goals,
                outcome_u35=outcome,
                home_prior_n=home_prior_n,
                away_prior_n=away_prior_n,
                both_teams_n3=(home_prior_n >= 3 and away_prior_n >= 3),
                estimator=estimator,
                development_market_evaluable=evaluable,
            ))

            if score is not None:
                additions.append(TrainingMatch(
                    home=str(feature.get("home", "")),
                    away=str(feature.get("away", "")),
                    home_goals=score[0],
                    away_goals=score[1],
                ))

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
            "min_hierarchical_train_n": MIN_HIERARCHICAL_TRAIN_N,
            "team_prior_matches": TEAM_PRIOR_MATCHES,
            "hierarchical_blend_weight": HIERARCHICAL_BLEND_WEIGHT,
            "distribution": "POISSON",
            "team_strength_scope": "VENUE_SPECIFIC_ATTACK_DEFENCE",
        },
        "summary": {
            "gate2_feature_rows": len(features),
            "model_predictions": len(predictions),
            "development_market_evaluable_n": len(eval_rows),
            "independent_validation_n": 0,
            "both_teams_n3_development_n": len(both_n3),
            "outcome_u35_1_n": sum(outcomes),
            "outcome_u35_0_n": len(outcomes) - sum(outcomes),
            "hierarchical_prediction_n": sum(1 for p in predictions if p.estimator == "HIERARCHICAL_BLEND"),
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
            "gate2_post_lineup_lambda_is_prediction_time_anchor": True,
            "team_attack_defence_parameters_use_verified_goals_from_strictly_prior_dates_only": True,
            "same_date_outcomes_cannot_train_same_date_predictions": True,
            "future_rows_cannot_train_past_predictions": True,
            "truth_and_gate2_team_identity_must_match_exactly": True,
            "bookmaker_odds_do_not_enter_model": True,
            "market_is_development_benchmark_only": True,
            "consumed_benchmark_cannot_be_claimed_as_independent_validation": True,
            "paper_only_until_new_independent_evidence_and_existing_gates_pass": True,
        },
    }
