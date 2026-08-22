
from gate3_engine import *
import math

rows = [
    SettledPrediction("m1",0.70,0.60,1,1.80,1.70),
    SettledPrediction("m2",0.65,0.58,1,1.75,1.68),
    SettledPrediction("m3",0.60,0.57,0,1.70,1.72),
    SettledPrediction("m4",0.72,0.61,1,1.82,1.74),
]

tests={}

# Brier manual
model_probs=[.70,.65,.60,.72]
market_probs=[.60,.58,.57,.61]
outcomes=[1,1,0,1]
expected_brier=sum((p-y)**2 for p,y in zip(model_probs,outcomes))/4
tests["brier_exact"] = abs(brier_score(model_probs,outcomes)-expected_brier)<1e-12

# Log loss manual sanity
ll=log_loss(model_probs,outcomes)
tests["logloss_positive"] = ll > 0

# P/L: +0.8 +0.75 -1 +0.82 = 1.37
rep=evaluate(rows, bootstrap_reps=1000, seed=7)
tests["profit_exact"] = abs(rep.profit-1.37)<1e-12
tests["roi_exact"] = abs(rep.roi-(1.37/4))<1e-12
tests["drawdown_exact"] = abs(rep.max_drawdown-1.0)<1e-12
tests["losing_streak_exact"] = rep.longest_losing_streak==1

# CLV should be positive on 3 of 4 and likely mean positive.
tests["clv_count"] = rep.clv_n==4
tests["mean_clv_positive"] = rep.mean_clv_pct > 0

# Bootstrap must be deterministic with seed.
a=bootstrap_ci(rows,"roi",1000,99)
b=bootstrap_ci(rows,"roi",1000,99)
tests["bootstrap_reproducible"] = a==b
tests["bootstrap_bounds_ordered"] = a[0] <= a[1]

# Calibration buckets should account for all rows in >=.5 space.
tests["calibration_n_conserved"] = sum(x.n for x in rep.calibration)==4

# Better-vs-market delta convention: positive means model better.
tests["delta_fields_exist"] = rep.delta_brier_vs_market is not None and rep.delta_logloss_vs_market is not None

# Qualified filter.
rows2=rows+[SettledPrediction("x",0.99,0.50,0,10.0,2.0,qualified=False)]
rep2=evaluate(rows2,bootstrap_reps=100,seed=1)
tests["unqualified_excluded"] = rep2.n==4 and abs(rep2.profit-1.37)<1e-12

failed=[k for k,v in tests.items() if not v]
print(tests)
if failed:
    raise SystemExit("FAILED: "+", ".join(failed))
print("GATE3_ACCEPTANCE=PASS")
