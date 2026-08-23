from __future__ import annotations

from dataclasses import asdict, dataclass
from math import isfinite
from typing import Dict, Iterable, List

from gate4_engine import score_model


ADAPTER_VERSION = "GATE3_TO_GATE4_REAL_ROBUSTNESS_ADAPTER_V0_1"
DEFAULT_MIN_N = 100
DEFAULT_MIN_WALKFORWARD_WIN_RATE = 0.60


@dataclass(frozen=True)
class ResearchRow:
    match_id: str
    date: str
    outcome_u35: int
    market_prob: float
    poisson_prob: float


def _prob(value) -> bool:
    return isinstance(value, (int, float)) and isfinite(float(value)) and 0.0 <= float(value) <= 1.0


def rows_from_gate3_report(report: Dict) -> List[ResearchRow]:
    evaluation = report.get("evaluation") if isinstance(report.get("evaluation"), dict) else report
    raw_rows = evaluation.get("rows", [])
    rows: List[ResearchRow] = []
    for raw in raw_rows:
        if raw.get("research_eligible") is not True:
            continue
        if not _prob(raw.get("model_prob")) or not _prob(raw.get("market_prob")):
            raise ValueError("INVALID_RESEARCH_PROBABILITY")
        outcome = raw.get("outcome_u35")
        if outcome not in (0, 1):
            raise ValueError("INVALID_RESEARCH_OUTCOME")
        match_id = str(raw.get("match_id") or "")
        date = str(raw.get("date") or "")
        if not match_id or not date:
            raise ValueError("RESEARCH_IDENTITY_MISSING")
        rows.append(ResearchRow(
            match_id=match_id,
            date=date,
            outcome_u35=int(outcome),
            market_prob=float(raw["market_prob"]),
            poisson_prob=float(raw["model_prob"]),
        ))
    return sorted(rows, key=lambda row: (row.date, row.match_id))


def _score_two(rows: Iterable[ResearchRow]) -> Dict[str, Dict]:
    rows = list(rows)
    y = [row.outcome_u35 for row in rows]
    market = score_model("market", [row.market_prob for row in rows], y)
    poisson = score_model("poisson", [row.poisson_prob for row in rows], y)
    return {"market": asdict(market), "poisson": asdict(poisson)}


def _leader(scores: Dict[str, Dict], incumbent: str = "market") -> str:
    valid = [score for score in scores.values() if score.get("logloss") is not None]
    if not valid:
        return incumbent
    return min(valid, key=lambda score: (score["logloss"], score["brier"] if score["brier"] is not None else 999))["name"]


def walk_forward_two_model(
    rows: Iterable[ResearchRow],
    *,
    min_train: int = 30,
    test_size: int = 20,
) -> List[Dict]:
    rows = sorted(list(rows), key=lambda row: (row.date, row.match_id))
    folds: List[Dict] = []
    start = min_train
    while start < len(rows):
        test = rows[start:start + test_size]
        if not test:
            break
        scores = _score_two(test)
        folds.append({
            "train_n": start,
            "train_end": rows[start - 1].date,
            "test_start": test[0].date,
            "test_end": test[-1].date,
            "n_test": len(test),
            "scores": scores,
            "descriptive_leader": _leader(scores),
        })
        start += test_size
    return folds


def evaluate_gate3_research_for_gate4(
    report: Dict,
    *,
    min_n: int = DEFAULT_MIN_N,
    min_walkforward_win_rate: float = DEFAULT_MIN_WALKFORWARD_WIN_RATE,
) -> Dict:
    rows = rows_from_gate3_report(report)
    scores = _score_two(rows)
    descriptive_leader = _leader(scores)
    n = len(rows)

    market = scores["market"]
    poisson = scores["poisson"]
    pass_n = n >= min_n
    pass_brier = (
        poisson["brier"] is not None and market["brier"] is not None
        and poisson["brier"] < market["brier"]
    )
    pass_logloss = (
        poisson["logloss"] is not None and market["logloss"] is not None
        and poisson["logloss"] < market["logloss"]
    )

    folds = walk_forward_two_model(rows)
    wf_win_rate = (
        sum(1 for fold in folds if fold["descriptive_leader"] == "poisson") / len(folds)
        if folds else None
    )
    pass_walkforward = wf_win_rate is not None and wf_win_rate >= min_walkforward_win_rate

    # Current Gate3 settled rows do not yet carry a verified regime label. Do not
    # fabricate one from outcome, probability or date.
    regime_metadata_available = False
    pass_regime = False

    reasons: List[str] = []
    if not pass_n:
        reasons.append(f"N {n} < {min_n}")
    if not pass_brier:
        reasons.append("Poisson challenger does not beat market on Brier")
    if not pass_logloss:
        reasons.append("Poisson challenger does not beat market on LogLoss")
    if not folds:
        reasons.append("No walk-forward fold: research N is below minimum training requirement")
    elif not pass_walkforward:
        reasons.append(f"Poisson walk-forward win rate {wf_win_rate:.2f} below {min_walkforward_win_rate:.2f}")
    if not regime_metadata_available:
        reasons.append("Verified regime metadata unavailable")
    reasons.append("Negative-binomial challenger unavailable from independent production predictions")
    reasons.append("Ensemble challenger unavailable from independently generated production predictions")

    promote_poisson = all((pass_n, pass_brier, pass_logloss, pass_walkforward, pass_regime))
    state = "PROMOTE_POISSON" if promote_poisson else "BLOCK_PROMOTION"

    return {
        "adapter_version": ADAPTER_VERSION,
        "source_dataset_id": report.get("dataset_id") or report.get("source_dataset_id"),
        "n": n,
        "scores": scores,
        "descriptive_leader": descriptive_leader,
        "incumbent": "market",
        "challenger": "poisson",
        "promotion_state": state,
        "promote_poisson": promote_poisson,
        "checks": {
            "min_n": {"required": min_n, "actual": n, "pass": pass_n},
            "brier_vs_market": pass_brier,
            "logloss_vs_market": pass_logloss,
            "walk_forward": {
                "folds": len(folds),
                "poisson_win_rate": wf_win_rate,
                "required_win_rate": min_walkforward_win_rate,
                "pass": pass_walkforward,
            },
            "regime_consistency": {
                "metadata_available": regime_metadata_available,
                "pass": pass_regime,
            },
        },
        "walk_forward": folds,
        "missing_challengers": ["negative_binomial", "ensemble"],
        "reasons": reasons,
        "governance": {
            "descriptive_leader_is_not_promoted_champion": True,
            "market_remains_incumbent_when_promotion_blocked": True,
            "no_challenger_probability_fabrication": True,
            "no_regime_inference_from_outcome_or_market": True,
            "no_retune_on_evaluation_sample": True,
            "gate4_min_n_unchanged": True,
            "capital_effect": "NONE",
            "real_money": "NO",
        },
    }
