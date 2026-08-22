
from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import List, Optional, Dict, Tuple
from enum import Enum
import math

class CapitalMode(str, Enum):
    LOCKED = "LOCKED"
    RESEARCH = "RESEARCH"
    PAPER = "PAPER"
    MICRO = "MICRO"
    LIMITED = "LIMITED"
    NORMAL = "NORMAL"
    DEFENSIVE = "DEFENSIVE"

@dataclass
class RiskPolicy:
    kelly_fraction: float = 0.25
    max_stake_pct: float = 0.0125
    micro_max_stake_pct: float = 0.0025
    limited_max_stake_pct: float = 0.0075
    normal_max_stake_pct: float = 0.0125
    defensive_max_stake_pct: float = 0.0025

    daily_exposure_cap_pct: float = 0.04
    same_match_exposure_cap_pct: float = 0.015
    same_league_exposure_cap_pct: float = 0.025
    correlated_cluster_cap_pct: float = 0.02

    daily_drawdown_stop_pct: float = 0.03
    weekly_drawdown_defensive_pct: float = 0.07
    total_drawdown_lock_pct: float = 0.15
    losing_streak_defensive: int = 6
    losing_streak_lock: int = 10

@dataclass
class CapitalState:
    bankroll: float
    peak_bankroll: float
    daily_start_bankroll: float
    weekly_start_bankroll: float
    daily_exposure: float = 0.0
    weekly_exposure: float = 0.0
    consecutive_losses: int = 0
    evidence_ready: bool = False
    mode: CapitalMode = CapitalMode.LOCKED

@dataclass
class BetCandidate:
    bet_id: str
    league: str
    match_id: str
    cluster_id: str
    odds: float
    model_prob: float
    market_prob: float
    confidence_factor: float = 1.0
    pattern_health: float = 1.0
    uncertainty_factor: float = 1.0
    current_same_match_exposure: float = 0.0
    current_same_league_exposure: float = 0.0
    current_cluster_exposure: float = 0.0

@dataclass
class StakeDecision:
    bet_id: str
    raw_edge_pp: float
    adjusted_prob: float
    adjusted_edge_pp: float
    raw_kelly: float
    fractional_kelly: float
    stake_pct_before_caps: float
    stake_pct_after_caps: float
    stake_amount: float
    mode: str
    decision: str
    reasons: List[str]

def decimal_implied_prob(odds: float) -> float:
    if odds <= 1:
        raise ValueError("Decimal odds must be > 1")
    return 1.0 / odds

def adjusted_probability(candidate: BetCandidate) -> float:
    # Conservative shrink toward market based on confidence, health and uncertainty.
    # All factors are [0,1]; lower factors reduce distance from market.
    f = max(0.0, min(1.0,
        candidate.confidence_factor *
        candidate.pattern_health *
        candidate.uncertainty_factor
    ))
    p = candidate.market_prob + f * (candidate.model_prob - candidate.market_prob)
    return max(1e-9, min(1-1e-9, p))

def raw_kelly_fraction(prob: float, odds: float) -> float:
    b = odds - 1.0
    q = 1.0 - prob
    k = (b*prob - q) / b
    return max(0.0, k)

def drawdown_pct(bankroll: float, peak: float) -> float:
    if peak <= 0:
        return 0.0
    return max(0.0, (peak - bankroll) / peak)

def period_drawdown_pct(bankroll: float, start: float) -> float:
    if start <= 0:
        return 0.0
    return max(0.0, (start - bankroll) / start)

def determine_mode(state: CapitalState, policy: RiskPolicy) -> Tuple[CapitalMode, List[str]]:
    reasons=[]
    if not state.evidence_ready:
        return CapitalMode.LOCKED, ["Evidence gate not passed"]

    total_dd=drawdown_pct(state.bankroll,state.peak_bankroll)
    daily_dd=period_drawdown_pct(state.bankroll,state.daily_start_bankroll)
    weekly_dd=period_drawdown_pct(state.bankroll,state.weekly_start_bankroll)

    if total_dd >= policy.total_drawdown_lock_pct:
        return CapitalMode.LOCKED,[f"Total drawdown {total_dd:.2%} >= lock threshold"]
    if state.consecutive_losses >= policy.losing_streak_lock:
        return CapitalMode.LOCKED,[f"Losing streak {state.consecutive_losses} >= lock threshold"]
    if daily_dd >= policy.daily_drawdown_stop_pct:
        return CapitalMode.DEFENSIVE,[f"Daily drawdown {daily_dd:.2%} >= stop threshold"]
    if weekly_dd >= policy.weekly_drawdown_defensive_pct:
        return CapitalMode.DEFENSIVE,[f"Weekly drawdown {weekly_dd:.2%} >= defensive threshold"]
    if state.consecutive_losses >= policy.losing_streak_defensive:
        return CapitalMode.DEFENSIVE,[f"Losing streak {state.consecutive_losses} >= defensive threshold"]

    # Evidence-ready but operational maturity can be set externally.
    if state.mode in (CapitalMode.MICRO, CapitalMode.LIMITED, CapitalMode.NORMAL):
        return state.mode, reasons
    return CapitalMode.MICRO, ["Evidence passed; start/restart at MICRO"]

def mode_stake_cap(mode: CapitalMode, policy: RiskPolicy) -> float:
    return {
        CapitalMode.MICRO: policy.micro_max_stake_pct,
        CapitalMode.LIMITED: policy.limited_max_stake_pct,
        CapitalMode.NORMAL: policy.normal_max_stake_pct,
        CapitalMode.DEFENSIVE: policy.defensive_max_stake_pct,
        CapitalMode.PAPER: 0.0,
        CapitalMode.RESEARCH: 0.0,
        CapitalMode.LOCKED: 0.0
    }[mode]

def size_bet(state: CapitalState, candidate: BetCandidate, policy: Optional[RiskPolicy]=None) -> StakeDecision:
    policy=policy or RiskPolicy()
    mode, mode_reasons = determine_mode(state,policy)
    reasons=list(mode_reasons)

    market_p=candidate.market_prob
    raw_edge=(candidate.model_prob-market_p)*100.0
    adj_p=adjusted_probability(candidate)
    adj_edge=(adj_p-market_p)*100.0

    rk=raw_kelly_fraction(adj_p,candidate.odds)
    fk=rk*policy.kelly_fraction
    stake_pct=fk

    if adj_edge <= 0:
        reasons.append("Adjusted edge <= 0")
        return StakeDecision(candidate.bet_id,raw_edge,adj_p,adj_edge,rk,fk,stake_pct,0.0,0.0,mode.value,"NO_BET",reasons)

    if mode in (CapitalMode.LOCKED,CapitalMode.PAPER,CapitalMode.RESEARCH):
        reasons.append(f"Capital mode {mode.value} does not allow real stake")
        return StakeDecision(candidate.bet_id,raw_edge,adj_p,adj_edge,rk,fk,stake_pct,0.0,0.0,mode.value,"NO_BET",reasons)

    cap=mode_stake_cap(mode,policy)
    stake_pct=min(stake_pct,cap,policy.max_stake_pct)

    # Portfolio exposure caps.
    remaining_daily=max(0.0,policy.daily_exposure_cap_pct-state.daily_exposure)
    remaining_match=max(0.0,policy.same_match_exposure_cap_pct-candidate.current_same_match_exposure)
    remaining_league=max(0.0,policy.same_league_exposure_cap_pct-candidate.current_same_league_exposure)
    remaining_cluster=max(0.0,policy.correlated_cluster_cap_pct-candidate.current_cluster_exposure)
    stake_pct=min(stake_pct,remaining_daily,remaining_match,remaining_league,remaining_cluster)

    if remaining_daily <= 0: reasons.append("Daily exposure cap reached")
    if remaining_match <= 0: reasons.append("Same-match exposure cap reached")
    if remaining_league <= 0: reasons.append("Same-league exposure cap reached")
    if remaining_cluster <= 0: reasons.append("Correlated-cluster exposure cap reached")

    if stake_pct <= 0:
        return StakeDecision(candidate.bet_id,raw_edge,adj_p,adj_edge,rk,fk,fk,0.0,0.0,mode.value,"NO_BET",reasons)

    amount=state.bankroll*stake_pct
    return StakeDecision(candidate.bet_id,raw_edge,adj_p,adj_edge,rk,fk,fk,stake_pct,amount,mode.value,"BET",reasons)

def register_settlement(state: CapitalState, stake_amount: float, odds: float, won: bool) -> CapitalState:
    if won:
        state.bankroll += stake_amount*(odds-1.0)
        state.consecutive_losses=0
    else:
        state.bankroll -= stake_amount
        state.consecutive_losses += 1
    state.peak_bankroll=max(state.peak_bankroll,state.bankroll)
    return state

def can_promote_mode(current: CapitalMode, evidence: Dict[str,bool]) -> Tuple[bool, CapitalMode, List[str]]:
    required=["historical_validation","calibration","positive_clv","forward_sample","operational_integrity"]
    failed=[k for k in required if not evidence.get(k,False)]
    if failed:
        return False,current,[f"Missing gate: {x}" for x in failed]

    progression={
        CapitalMode.LOCKED:CapitalMode.MICRO,
        CapitalMode.MICRO:CapitalMode.LIMITED,
        CapitalMode.LIMITED:CapitalMode.NORMAL,
        CapitalMode.NORMAL:CapitalMode.NORMAL,
        CapitalMode.DEFENSIVE:CapitalMode.MICRO,
        CapitalMode.PAPER:CapitalMode.MICRO,
        CapitalMode.RESEARCH:CapitalMode.PAPER,
    }
    return True,progression[current],["All promotion evidence gates passed"]

def portfolio_effective_exposure(stakes: List[float], corr: List[List[float]]) -> float:
    # sqrt(w' C w), a conservative volatility-like effective exposure metric.
    n=len(stakes)
    if len(corr)!=n or any(len(row)!=n for row in corr):
        raise ValueError("Correlation matrix shape mismatch")
    v=0.0
    for i in range(n):
        for j in range(n):
            v += stakes[i]*corr[i][j]*stakes[j]
    return math.sqrt(max(0.0,v))
