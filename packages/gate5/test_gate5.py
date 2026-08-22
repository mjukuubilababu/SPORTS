
from gate5_engine import *
tests={}
p=dict(match_id="m1",pattern_id="P002",created_at="2026-08-20T01:00:00+03:00",
kickoff_at="2026-08-20T01:10:00+03:00",selection="U3.5",model_prob=.64,market_prob=.59,
reference_odds=1.70,lambda_total=3.02,raw_edge_pp=5.0,lineup_gate="PASS",
quote_source="Book",quote_type="SNAPSHOT",rule_version="P002-v1")
s=freeze_signal(p)
tests["immutable_hash"]=verify_immutable(s)
tests["pre_kickoff_only"]=True
try:
 freeze_signal({**p,"created_at":p["kickoff_at"]}); tests["pre_kickoff_only"]=False
except ValueError: pass
r=paper_execute(s,"2026-08-20T01:03:00+03:00",1.72)
tests["fresh_quote"]=r.status=="PAPER_EXECUTED"
tests["slippage"]=abs(r.slippage_pct-(1.72/1.70-1)*100)<1e-9
attach_close(r,1.65)
tests["clv_positive"]=r.clv_pct>0
settle(r,1)
tests["settlement"]=r.status=="WIN"
st=paper_execute(s,"2026-08-20T01:06:00+03:00",1.68,max_quote_age_seconds=300)
tests["stale_detected"]=st.status=="STALE_QUOTE"
rep=batch_report([r,st])
tests["batch_report"]=rep["n_records"]==2 and rep["n_settled"]==1
d=drift_check({"lambda_mean":3.0},{"lambda_mean":3.3})
tests["drift_alert"]=d["pass"] is False
g=forward_promotion_gate({"n_settled":30,"roi":.05,"mean_clv_pct":1.0,"stale_quote_rate":0.0},{"pass":True})
tests["promotion_pass"]=g["pass"] is True
g2=forward_promotion_gate({"n_settled":29,"roi":.05,"mean_clv_pct":1.0,"stale_quote_rate":0.0},{"pass":True})
tests["min_n_blocks"]=g2["pass"] is False
failed=[k for k,v in tests.items() if not v]
print(tests)
if failed: raise SystemExit("FAILED "+str(failed))
print("GATE5_ACCEPTANCE=PASS")
