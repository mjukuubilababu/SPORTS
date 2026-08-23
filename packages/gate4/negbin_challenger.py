from __future__ import annotations

from dataclasses import asdict, dataclass
from math import exp, isfinite, lgamma, log
from typing import Dict, Iterable, List, Sequence, Set, Tuple


CHALLENGER_FAMILY = "NEGATIVE_BINOMIAL_TOTAL_GOALS_NB2"
CHALLENGER_VERSION = "P002_NEGBIN_CHALLENGER_V0_1"
FIT_METHOD = "MLE_LOG_DISPERSION_GOLDEN_SECTION_V0_1"


@dataclass(frozen=True)
class NBTrainingRow:
    match_id: str
    date: str
    season: int
    mu: float
    total_goals: int


@dataclass(frozen=True)
class DispersionFit:
    model_version: str
    family: str
    fit_method: str
    training_n: int
    dispersion_r: float
    search_lower_r: float
    search_upper_r: float
    boundary_warning: bool
    negbin_mean_nll: float
    poisson_mean_nll: float


def _valid_mu(value) -> bool:
    return isinstance(value, (int, float)) and isfinite(float(value)) and float(value) > 0.0


def nb2_logpmf(k: int, mu: float, dispersion_r: float) -> float:
    if not isinstance(k, int) or k < 0:
        raise ValueError("GOAL_COUNT_MUST_BE_NONNEGATIVE_INTEGER")
    if not _valid_mu(mu):
        raise ValueError("MU_MUST_BE_FINITE_AND_POSITIVE")
    if not _valid_mu(dispersion_r):
        raise ValueError("DISPERSION_R_MUST_BE_FINITE_AND_POSITIVE")
    r = float(dispersion_r)
    m = float(mu)
    return (
        lgamma(k + r) - lgamma(r) - lgamma(k + 1)
        + r * log(r / (r + m))
        + k * log(m / (r + m))
    )


def poisson_logpmf(k: int, mu: float) -> float:
    if not isinstance(k, int) or k < 0:
        raise ValueError("GOAL_COUNT_MUST_BE_NONNEGATIVE_INTEGER")
    if not _valid_mu(mu):
        raise ValueError("MU_MUST_BE_FINITE_AND_POSITIVE")
    m = float(mu)
    return -m + k * log(m) - lgamma(k + 1)


def negbin_u35(mu: float, dispersion_r: float) -> float:
    return sum(exp(nb2_logpmf(k, mu, dispersion_r)) for k in range(4))


def build_training_rows(
    truth_store: Dict,
    gate2_backfill: Dict,
    *,
    training_season: int,
    forbidden_match_ids: Iterable[str] = (),
) -> List[NBTrainingRow]:
    if truth_store.get("store_version") != "CANONICAL_HISTORICAL_TRUTH_STORE_V0_1":
        raise ValueError("UNSUPPORTED_TRUTH_STORE_VERSION")
    if gate2_backfill.get("pipeline_version") != "GATE1_TO_GATE2_CANONICAL_BACKFILL_V0_1":
        raise ValueError("UNSUPPORTED_GATE2_BACKFILL_VERSION")
    if gate2_backfill.get("source_dataset_id") != truth_store.get("dataset_id"):
        raise ValueError("TRAINING_DATASET_ID_MISMATCH")

    forbidden: Set[str] = {str(x) for x in forbidden_match_ids}
    truth = {str(row["match_id"]): row for row in truth_store.get("records", [])}
    output: List[NBTrainingRow] = []

    for feature in gate2_backfill.get("features", []):
        if int(feature.get("season", -1)) != int(training_season):
            continue
        match_id = str(feature.get("match_id") or "")
        if not match_id:
            raise ValueError("TRAINING_MATCH_ID_MISSING")
        if match_id in forbidden:
            raise ValueError(f"FROZEN_MATCH_REUSED_FOR_TRAINING:{match_id}")
        mu = feature.get("pre_lineup_lambda")
        if not _valid_mu(mu):
            continue
        record = truth.get(match_id)
        if record is None:
            raise ValueError("TRAINING_TRUTH_RECORD_MISSING")
        result = record.get("result") or {}
        score = record.get("final_score") or {}
        if result.get("verified") is not True:
            raise ValueError("TRAINING_RESULT_NOT_VERIFIED")
        home = score.get("home")
        away = score.get("away")
        if not isinstance(home, int) or home < 0 or not isinstance(away, int) or away < 0:
            raise ValueError("TRAINING_FINAL_SCORE_INVALID")
        output.append(NBTrainingRow(
            match_id=match_id,
            date=str(feature.get("date") or ""),
            season=int(training_season),
            mu=float(mu),
            total_goals=home + away,
        ))

    output.sort(key=lambda row: (row.date, row.match_id))
    if not output:
        raise ValueError("NO_ELIGIBLE_CHRONOLOGICAL_TRAINING_ROWS")
    if len({row.match_id for row in output}) != len(output):
        raise ValueError("DUPLICATE_TRAINING_MATCH_ID")
    return output


def _total_nll(rows: Sequence[NBTrainingRow], r: float) -> float:
    return -sum(nb2_logpmf(row.total_goals, row.mu, r) for row in rows)


def fit_dispersion_mle(
    rows: Sequence[NBTrainingRow],
    *,
    lower_r: float = 0.05,
    upper_r: float = 500.0,
    iterations: int = 160,
) -> DispersionFit:
    rows = list(rows)
    if len(rows) < 30:
        raise ValueError(f"TRAINING_N_BELOW_MINIMUM:{len(rows)}<30")
    if not (0 < lower_r < upper_r):
        raise ValueError("INVALID_DISPERSION_SEARCH_BOUNDS")
    if iterations < 40:
        raise ValueError("INSUFFICIENT_OPTIMIZATION_ITERATIONS")

    # Optimize log(r) so positivity is guaranteed and very large r can represent
    # the Poisson limit without a special-case branch.
    lo = log(lower_r)
    hi = log(upper_r)
    phi = (1 + 5 ** 0.5) / 2
    c = hi - (hi - lo) / phi
    d = lo + (hi - lo) / phi
    fc = _total_nll(rows, exp(c))
    fd = _total_nll(rows, exp(d))

    for _ in range(iterations):
        if fc <= fd:
            hi, d, fd = d, c, fc
            c = hi - (hi - lo) / phi
            fc = _total_nll(rows, exp(c))
        else:
            lo, c, fc = c, d, fd
            d = lo + (hi - lo) / phi
            fd = _total_nll(rows, exp(d))

    r_hat = exp((lo + hi) / 2)
    nb_nll = _total_nll(rows, r_hat)
    poisson_nll = -sum(poisson_logpmf(row.total_goals, row.mu) for row in rows)
    boundary_warning = r_hat <= lower_r * 1.05 or r_hat >= upper_r * 0.95

    return DispersionFit(
        model_version=CHALLENGER_VERSION,
        family=CHALLENGER_FAMILY,
        fit_method=FIT_METHOD,
        training_n=len(rows),
        dispersion_r=r_hat,
        search_lower_r=lower_r,
        search_upper_r=upper_r,
        boundary_warning=boundary_warning,
        negbin_mean_nll=nb_nll / len(rows),
        poisson_mean_nll=poisson_nll / len(rows),
    )


def challenger_specification(fit: DispersionFit) -> Dict:
    return {
        "challenger_id": "P002-NEGBIN-CHALLENGER-V0.1",
        "model_version": fit.model_version,
        "family": fit.family,
        "target": "UNDER_3_5_REGULATION_90",
        "mean_source": "GATE2_PRE_LINEUP_LAMBDA_UNCHANGED",
        "distribution": "NB2_MEAN_MU_VARIANCE_MU_PLUS_MU_SQUARED_OVER_R",
        "dispersion_fit_method": fit.fit_method,
        "dispersion_r": fit.dispersion_r,
        "dispersion_search_bounds": [fit.search_lower_r, fit.search_upper_r],
        "probability_function": "SUM_NB2_PMF_K_0_TO_3",
        "market_odds_as_model_input": False,
        "lineup_adjustment_in_training_mu": False,
        "holdout_a_used_for_training_or_tuning": False,
        "post_registration_parameter_change": "REQUIRES_NEW_MODEL_VERSION_AND_REGISTRATION",
    }


def fit_to_dict(fit: DispersionFit) -> Dict:
    return asdict(fit)
