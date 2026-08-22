
from gate6_engine import *
tests={}

p=RiskPolicy()
state=CapitalState(bankroll=1000,peak_bankroll=1000,daily_start_bankroll=1000,weekly_start_bankroll=1000,evidence_ready=False)
cand=BetCandidate("b1","MLS","m1","overs",1.80,.65,.58,.9,.9,.9)

d=size_bet(state,cand,p)
tests["locked_without_evidence"]=d.decision=="NO_BET" and d.mode=="LOCKED"

state.evidence_ready=True
state.mode=CapitalMode.MICRO
d=size_bet(state,cand,p)
tests["micro_allows_bet"]=d.decision=="BET"
tests["micro_cap_enforced"]=d.stake_pct_after_caps<=p.micro_max_stake_pct+1e-12
tests["positive_adjusted_edge"]=d.adjusted_edge_pp>0
tests["kelly_nonnegative"]=d.raw_kelly>=0

# Exposure cap
cand2=BetCandidate("b2","MLS","m2","overs",1.80,.70,.58,1,1,1,current_cluster_exposure=p.correlated_cluster_cap_pct)
d2=size_bet(state,cand2,p)
tests["cluster_cap_blocks"]=d2.decision=="NO_BET"

# Daily DD => defensive
st2=CapitalState(960,1000,1000,1000,evidence_ready=True,mode=CapitalMode.NORMAL)
mode,reasons=determine_mode(st2,p)
tests["daily_dd_defensive"]=mode==CapitalMode.DEFENSIVE

# Total DD => locked
st3=CapitalState(840,1000,1000,1000,evidence_ready=True,mode=CapitalMode.NORMAL)
mode,_=determine_mode(st3,p)
tests["total_dd_locked"]=mode==CapitalMode.LOCKED

# Losing streak lock
st4=CapitalState(1000,1000,1000,1000,evidence_ready=True,mode=CapitalMode.NORMAL,consecutive_losses=10)
mode,_=determine_mode(st4,p)
tests["losing_streak_lock"]=mode==CapitalMode.LOCKED

# Settlement
st5=CapitalState(1000,1000,1000,1000,evidence_ready=True,mode=CapitalMode.MICRO)
register_settlement(st5,10,2.0,False)
tests["loss_settlement"]=abs(st5.bankroll-990)<1e-12 and st5.consecutive_losses==1
register_settlement(st5,10,2.0,True)
tests["win_settlement"]=abs(st5.bankroll-1000)<1e-12 and st5.consecutive_losses==0

# Promotion
evidence={k:True for k in ["historical_validation","calibration","positive_clv","forward_sample","operational_integrity"]}
ok,next_mode,_=can_promote_mode(CapitalMode.MICRO,evidence)
tests["promotion_micro_to_limited"]=ok and next_mode==CapitalMode.LIMITED
bad={**evidence,"positive_clv":False}
ok2,_,_=can_promote_mode(CapitalMode.MICRO,bad)
tests["promotion_blocked_missing_gate"]=not ok2

# Correlation exposure
eff=portfolio_effective_exposure([.01,.01],[[1,1],[1,1]])
tests["perfect_corr_effective_exposure"]=abs(eff-.02)<1e-12
eff2=portfolio_effective_exposure([.01,.01],[[1,0],[0,1]])
tests["uncorrelated_lower_than_sum"]=eff2<.02

# Adjustment shrinks toward market
adj=adjusted_probability(cand)
tests["uncertainty_shrinkage"]=cand.market_prob < adj < cand.model_prob

failed=[k for k,v in tests.items() if not v]
print(tests)
if failed: raise SystemExit("FAILED "+str(failed))
print("GATE6_ACCEPTANCE=PASS")
