
from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import List, Optional, Dict, Tuple, Iterable
import math, random, statistics

EPS = 1e-12

@dataclass
class SettledPrediction:
    match_id: str
    model_prob: float          # probability of selected outcome (e.g. U3.5)
    market_prob: float         # de-vig market probability for same outcome
    outcome: int               # 1 if selected outcome happened, else 0
    entry_odds: float          # execution or reference price used for P/L
    closing_odds: Optional[float] = None
    stake: float = 1.0
    qualified: bool = True
    pattern_id: str = "P002"

@dataclass
class CalibrationBucket:
    low: float
    high: float
    n: int
    avg_pred: Optional[float]
    hit_rate: Optional[float]
    calibration_error: Optional[float]

@dataclass
class ValidationReport:
    n: int
    wins: int
    hit_rate: Optional[float]
    profit: float
    roi: Optional[float]
    avg_entry_odds: Optional[float]

    brier_model: Optional[float]
    brier_market: Optional[float]
    delta_brier_vs_market: Optional[float]

    logloss_model: Optional[float]
    logloss_market: Optional[float]
    delta_logloss_vs_market: Optional[float]

    mean_clv_pct: Optional[float]
    positive_clv_rate: Optional[float]
    clv_n: int

    max_drawdown: float
    longest_losing_streak: int

    bootstrap_roi_ci95: Tuple[Optional[float], Optional[float]]
    bootstrap_hit_rate_ci95: Tuple[Optional[float], Optional[float]]

    expected_calibration_error: Optional[float]
    calibration: List[CalibrationBucket]

def _clip_prob(p: float) -> float:
    return min(max(float(p), EPS), 1.0 - EPS)

def brier_score(probs: List[float], outcomes: List[int]) -> Optional[float]:
    if not probs:
        return None
    return sum((p-y)**2 for p,y in zip(probs,outcomes))/len(probs)

def log_loss(probs: List[float], outcomes: List[int]) -> Optional[float]:
    if not probs:
        return None
    vals=[]
    for p,y in zip(probs,outcomes):
        p=_clip_prob(p)
        vals.append(-(y*math.log(p)+(1-y)*math.log(1-p)))
    return sum(vals)/len(vals)

def profit_for(p: SettledPrediction) -> float:
    if p.outcome == 1:
        return p.stake*(p.entry_odds-1.0)
    return -p.stake

def equity_curve(rows: List[SettledPrediction]) -> List[float]:
    eq=[]
    total=0.0
    for r in rows:
        total += profit_for(r)
        eq.append(total)
    return eq

def max_drawdown(rows: List[SettledPrediction]) -> float:
    peak=0.0
    worst=0.0
    total=0.0
    for r in rows:
        total += profit_for(r)
        peak=max(peak,total)
        worst=max(worst, peak-total)
    return worst

def longest_losing_streak(rows: List[SettledPrediction]) -> int:
    best=cur=0
    for r in rows:
        if r.outcome == 0:
            cur += 1
            best=max(best,cur)
        else:
            cur=0
    return best

def closing_line_value_pct(entry_odds: float, closing_odds: float) -> float:
    # Positive when entry price is better than closing price for the same selection.
    return (entry_odds/closing_odds - 1.0)*100.0

def calibration_buckets(
    probs: List[float],
    outcomes: List[int],
    edges: Optional[List[Tuple[float,float]]] = None
) -> List[CalibrationBucket]:
    if edges is None:
        edges=[(0.50,0.55),(0.55,0.60),(0.60,0.65),(0.65,0.70),
               (0.70,0.75),(0.75,0.80),(0.80,0.90),(0.90,1.0000001)]
    out=[]
    for low,high in edges:
        idx=[i for i,p in enumerate(probs) if low <= p < high]
        if not idx:
            out.append(CalibrationBucket(low,high,0,None,None,None))
            continue
        avgp=sum(probs[i] for i in idx)/len(idx)
        hit=sum(outcomes[i] for i in idx)/len(idx)
        out.append(CalibrationBucket(low,high,len(idx),avgp,hit,abs(avgp-hit)))
    return out

def expected_calibration_error(buckets: List[CalibrationBucket]) -> Optional[float]:
    n=sum(b.n for b in buckets)
    if n == 0:
        return None
    return sum((b.n/n)*(b.calibration_error or 0.0) for b in buckets)

def _percentile(sorted_vals: List[float], q: float) -> float:
    if not sorted_vals:
        raise ValueError("empty")
    if len(sorted_vals)==1:
        return sorted_vals[0]
    pos=(len(sorted_vals)-1)*q
    lo=int(math.floor(pos)); hi=int(math.ceil(pos))
    if lo==hi:
        return sorted_vals[lo]
    w=pos-lo
    return sorted_vals[lo]*(1-w)+sorted_vals[hi]*w

def bootstrap_ci(
    rows: List[SettledPrediction],
    metric: str,
    reps: int = 5000,
    seed: int = 42
) -> Tuple[Optional[float], Optional[float]]:
    if not rows:
        return (None,None)
    rng=random.Random(seed)
    vals=[]
    n=len(rows)
    for _ in range(reps):
        sample=[rows[rng.randrange(n)] for _ in range(n)]
        if metric=="roi":
            stake=sum(r.stake for r in sample)
            vals.append(sum(profit_for(r) for r in sample)/stake if stake else 0.0)
        elif metric=="hit_rate":
            vals.append(sum(r.outcome for r in sample)/n)
        else:
            raise ValueError("Unsupported bootstrap metric")
    vals.sort()
    return (_percentile(vals,0.025), _percentile(vals,0.975))

def evaluate(
    predictions: Iterable[SettledPrediction],
    bootstrap_reps: int = 5000,
    seed: int = 42
) -> ValidationReport:
    rows=[r for r in predictions if r.qualified]
    n=len(rows)
    wins=sum(r.outcome for r in rows)
    total_stake=sum(r.stake for r in rows)
    profit=sum(profit_for(r) for r in rows)
    hit=wins/n if n else None
    roi=profit/total_stake if total_stake else None
    avg_odds=sum(r.entry_odds for r in rows)/n if n else None

    mp=[r.model_prob for r in rows]
    mkp=[r.market_prob for r in rows]
    y=[r.outcome for r in rows]

    bm=brier_score(mp,y)
    bk=brier_score(mkp,y)
    lm=log_loss(mp,y)
    lk=log_loss(mkp,y)

    clvs=[closing_line_value_pct(r.entry_odds,r.closing_odds)
          for r in rows if r.closing_odds is not None]
    mean_clv=sum(clvs)/len(clvs) if clvs else None
    pos_clv=sum(1 for x in clvs if x>0)/len(clvs) if clvs else None

    buckets=calibration_buckets(mp,y)
    ece=expected_calibration_error(buckets)

    return ValidationReport(
        n=n, wins=wins, hit_rate=hit, profit=profit, roi=roi, avg_entry_odds=avg_odds,
        brier_model=bm, brier_market=bk,
        delta_brier_vs_market=(bk-bm) if bm is not None and bk is not None else None,
        logloss_model=lm, logloss_market=lk,
        delta_logloss_vs_market=(lk-lm) if lm is not None and lk is not None else None,
        mean_clv_pct=mean_clv, positive_clv_rate=pos_clv, clv_n=len(clvs),
        max_drawdown=max_drawdown(rows), longest_losing_streak=longest_losing_streak(rows),
        bootstrap_roi_ci95=bootstrap_ci(rows,"roi",bootstrap_reps,seed),
        bootstrap_hit_rate_ci95=bootstrap_ci(rows,"hit_rate",bootstrap_reps,seed+1),
        expected_calibration_error=ece, calibration=buckets
    )

def promotion_readiness(
    report: ValidationReport,
    min_n: int = 30,
    require_positive_roi: bool = True,
    require_positive_clv: bool = True,
    require_model_better_than_market: bool = True,
) -> Dict[str, object]:
    checks = {}
    checks["n_gate"] = report.n >= min_n
    checks["roi_gate"] = (report.roi is not None and report.roi > 0) if require_positive_roi else True
    checks["clv_gate"] = (
        report.mean_clv_pct is not None and report.mean_clv_pct > 0
    ) if require_positive_clv else True
    checks["brier_vs_market_gate"] = (
        report.delta_brier_vs_market is not None and report.delta_brier_vs_market > 0
    ) if require_model_better_than_market else True
    checks["logloss_vs_market_gate"] = (
        report.delta_logloss_vs_market is not None and report.delta_logloss_vs_market > 0
    ) if require_model_better_than_market else True
    checks["bootstrap_roi_lower_bound_positive"] = (
        report.bootstrap_roi_ci95[0] is not None and report.bootstrap_roi_ci95[0] > 0
    )
    return {
        "checks": checks,
        "pass": all(checks.values())
    }

def report_to_dict(report: ValidationReport) -> Dict:
    d=asdict(report)
    return d
