
from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import List, Dict, Optional, Tuple, Iterable, Callable
from collections import defaultdict
from datetime import datetime
import math

EPS = 1e-12

@dataclass
class ModelPrediction:
    match_id: str
    date: str
    season: int
    regime: str
    outcome_u35: int
    market_prob: float
    poisson_prob: float
    negbin_prob: float
    ensemble_prob: float
    entry_odds: Optional[float] = None
    feature_values: Optional[Dict[str,float]] = None

@dataclass
class ModelScore:
    name: str
    n: int
    brier: Optional[float]
    logloss: Optional[float]
    hit_rate_at_50: Optional[float]
    calibration_error: Optional[float]

@dataclass
class WalkForwardFold:
    train_end: str
    test_start: str
    test_end: str
    n_test: int
    scores: Dict[str, ModelScore]
    champion: str

@dataclass
class StabilityResult:
    threshold_name: str
    base_threshold: float
    neighbors: List[float]
    base_n: int
    neighbor_n: Dict[float,int]
    neighbor_roi: Dict[float,Optional[float]]
    stable: bool
    reason: str

@dataclass
class RegimeResult:
    regime: str
    n: int
    champion: str
    scores: Dict[str, ModelScore]

@dataclass
class ChallengerDecision:
    incumbent: str
    challenger: str
    pass_brier: bool
    pass_logloss: bool
    pass_walkforward_majority: bool
    pass_regime_consistency: bool
    pass_min_n: bool
    promote: bool
    reasons: List[str]


def _clip(p: float) -> float:
    return min(max(float(p), EPS), 1.0-EPS)

def brier(probs: List[float], y: List[int]) -> Optional[float]:
    if not probs:
        return None
    return sum((p-t)**2 for p,t in zip(probs,y))/len(probs)

def logloss(probs: List[float], y: List[int]) -> Optional[float]:
    if not probs:
        return None
    return sum(-(t*math.log(_clip(p))+(1-t)*math.log(1-_clip(p))) for p,t in zip(probs,y))/len(probs)

def calibration_error(probs: List[float], y: List[int], bins: int=5) -> Optional[float]:
    if not probs:
        return None
    buckets=[[] for _ in range(bins)]
    for p,t in zip(probs,y):
        idx=min(int(_clip(p)*bins),bins-1)
        buckets[idx].append((p,t))
    n=len(probs)
    ece=0.0
    for bucket in buckets:
        if not bucket:
            continue
        avgp=sum(x[0] for x in bucket)/len(bucket)
        hit=sum(x[1] for x in bucket)/len(bucket)
        ece += (len(bucket)/n)*abs(avgp-hit)
    return ece

def hit_rate_at_50(probs: List[float], y: List[int]) -> Optional[float]:
    if not probs:
        return None
    return sum(int((p>=0.5)==bool(t)) for p,t in zip(probs,y))/len(probs)

def score_model(name: str, probs: List[float], y: List[int]) -> ModelScore:
    return ModelScore(name,len(y),brier(probs,y),logloss(probs,y),hit_rate_at_50(probs,y),calibration_error(probs,y))

def model_prob(rows: List[ModelPrediction], model: str) -> List[float]:
    attr={"market":"market_prob","poisson":"poisson_prob","negbin":"negbin_prob","ensemble":"ensemble_prob"}[model]
    return [getattr(r,attr) for r in rows]

def compare_models(rows: Iterable[ModelPrediction]) -> Dict[str,ModelScore]:
    rows=list(rows)
    y=[r.outcome_u35 for r in rows]
    return {m:score_model(m,model_prob(rows,m),y) for m in ("market","poisson","negbin","ensemble")}

def choose_champion(scores: Dict[str,ModelScore], incumbent: str="market") -> str:
    valid=[s for s in scores.values() if s.logloss is not None]
    if not valid:
        return incumbent
    return min(valid,key=lambda s:(s.logloss,s.brier if s.brier is not None else 999)).name

def walk_forward(rows: Iterable[ModelPrediction], min_train: int=30, test_size: int=20, incumbent: str="market") -> List[WalkForwardFold]:
    rows=sorted(list(rows), key=lambda r: datetime.fromisoformat(r.date[:10]))
    folds=[]
    start=min_train
    while start < len(rows):
        test=rows[start:start+test_size]
        if not test:
            break
        scores=compare_models(test)
        folds.append(WalkForwardFold(rows[start-1].date,test[0].date,test[-1].date,len(test),scores,choose_champion(scores,incumbent)))
        start += test_size
    return folds

def regime_analysis(rows: Iterable[ModelPrediction]) -> List[RegimeResult]:
    groups=defaultdict(list)
    for r in rows:
        groups[r.regime].append(r)
    out=[]
    for regime,grp in sorted(groups.items()):
        scores=compare_models(grp)
        out.append(RegimeResult(regime,len(grp),choose_champion(scores),scores))
    return out

def flat_roi(rows: List[ModelPrediction], selector: Callable[[ModelPrediction],bool]) -> Tuple[int,Optional[float]]:
    selected=[r for r in rows if selector(r) and r.entry_odds is not None]
    if not selected:
        return 0,None
    profit=sum((r.entry_odds-1.0) if r.outcome_u35==1 else -1.0 for r in selected)
    return len(selected), profit/len(selected)

def threshold_stability(rows, threshold_name, base_threshold, neighbors, selector_factory, min_neighbor_n_ratio=0.5):
    base_n,base_roi=flat_roi(rows,selector_factory(base_threshold))
    neighbor_n={}; neighbor_roi={}; stable=True; reasons=[]
    for t in neighbors:
        n,roi=flat_roi(rows,selector_factory(t))
        neighbor_n[t]=n; neighbor_roi[t]=roi
        if base_n>0 and n < max(1,int(base_n*min_neighbor_n_ratio)):
            stable=False; reasons.append(f"{t}: sample collapses ({n} vs base {base_n})")
        if roi is None or roi <= 0:
            stable=False; reasons.append(f"{t}: non-positive ROI")
    if base_n==0:
        stable=False; reasons.append("base threshold has zero sample")
    if base_roi is None or base_roi <= 0:
        stable=False; reasons.append("base threshold non-positive ROI")
    return StabilityResult(threshold_name,base_threshold,neighbors,base_n,neighbor_n,neighbor_roi,stable,"; ".join(reasons) if reasons else "Stable across tested neighbors")

def ablation_ensemble(base_probs: Dict[str,List[float]], y: List[int], weights: Dict[str,float], dropped_feature: Optional[str]=None) -> ModelScore:
    active={k:v for k,v in weights.items() if k != dropped_feature}
    total=sum(active.values())
    if total <= 0:
        raise ValueError("No active weights")
    probs=[]
    for i in range(len(y)):
        probs.append(sum((w/total)*base_probs[k][i] for k,w in active.items()))
    name="ensemble_full" if dropped_feature is None else f"ensemble_without_{dropped_feature}"
    return score_model(name,probs,y)

def ablation_report(base_probs,y,weights):
    out={"full":ablation_ensemble(base_probs,y,weights,None)}
    for feature in weights:
        out[f"without_{feature}"]=ablation_ensemble(base_probs,y,weights,feature)
    return out

def challenger_decision(rows, challenger, incumbent="market", min_n=100, min_walkforward_win_rate=0.60, min_regime_win_rate=0.60):
    scores=compare_models(rows)
    inc=scores[incumbent]; ch=scores[challenger]; reasons=[]
    pass_n=len(rows)>=min_n
    if not pass_n: reasons.append(f"N {len(rows)} < {min_n}")
    pass_brier=(ch.brier is not None and inc.brier is not None and ch.brier < inc.brier)
    if not pass_brier: reasons.append("Challenger does not beat incumbent on Brier")
    pass_ll=(ch.logloss is not None and inc.logloss is not None and ch.logloss < inc.logloss)
    if not pass_ll: reasons.append("Challenger does not beat incumbent on LogLoss")
    folds=walk_forward(rows,min_train=max(30,min_n//3),test_size=max(10,min_n//5),incumbent=incumbent)
    wf_win=(sum(1 for f in folds if f.champion==challenger)/len(folds)) if folds else 0.0
    pass_wf=wf_win>=min_walkforward_win_rate
    if not pass_wf: reasons.append(f"Walk-forward win rate {wf_win:.2f} below {min_walkforward_win_rate:.2f}")
    regimes=[r for r in regime_analysis(rows) if r.n>=10]
    reg_win=(sum(1 for r in regimes if r.champion==challenger)/len(regimes)) if regimes else 0.0
    pass_reg=reg_win>=min_regime_win_rate
    if not pass_reg: reasons.append(f"Regime win rate {reg_win:.2f} below {min_regime_win_rate:.2f}")
    promote=all((pass_n,pass_brier,pass_ll,pass_wf,pass_reg))
    return ChallengerDecision(incumbent,challenger,pass_brier,pass_ll,pass_wf,pass_reg,pass_n,promote,reasons)

def poisson_u35(mu: float) -> float:
    return sum(math.exp(-mu)*(mu**k)/math.factorial(k) for k in range(4))

def negbin_u35(mu: float, dispersion_r: float) -> float:
    if mu <= 0 or dispersion_r <= 0:
        raise ValueError("mu and dispersion_r must be >0")
    r=dispersion_r
    p=r/(r+mu)
    total=0.0
    for k in range(4):
        # log choose(k+r-1,k) + k log(1-p) + r log(p)
        logpmf=(math.lgamma(k+r)-math.lgamma(r)-math.lgamma(k+1)
                + k*math.log1p(-p) + r*math.log(p))
        total += math.exp(logpmf)
    return total

def report_to_dict(obj):
    if isinstance(obj,list):
        return [report_to_dict(x) for x in obj]
    if hasattr(obj,"__dataclass_fields__"):
        return asdict(obj)
    if isinstance(obj,dict):
        return {k:report_to_dict(v) for k,v in obj.items()}
    return obj
