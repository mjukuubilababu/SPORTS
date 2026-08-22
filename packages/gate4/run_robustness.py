
import csv,json,sys
from gate4_engine import *
if len(sys.argv)!=3:
    raise SystemExit("Usage: python run_robustness.py input.csv report.json")
rows=[]
with open(sys.argv[1],newline="",encoding="utf-8") as f:
    for r in csv.DictReader(f):
        rows.append(ModelPrediction(
            match_id=r["match_id"],date=r["date"],season=int(r["season"]),regime=r.get("regime") or "unknown",
            outcome_u35=int(r["outcome_u35"]),market_prob=float(r["market_prob"]),poisson_prob=float(r["poisson_prob"]),
            negbin_prob=float(r["negbin_prob"]),ensemble_prob=float(r["ensemble_prob"]),
            entry_odds=None if not r.get("entry_odds") else float(r["entry_odds"])
        ))
scores=compare_models(rows)
payload={
    "scores":{k:report_to_dict(v) for k,v in scores.items()},
    "champion":choose_champion(scores),
    "walk_forward":report_to_dict(walk_forward(rows)),
    "regimes":report_to_dict(regime_analysis(rows)),
    "ensemble_vs_market":report_to_dict(challenger_decision(rows,"ensemble","market"))
}
with open(sys.argv[2],"w",encoding="utf-8") as f: json.dump(payload,f,indent=2)
print(json.dumps(payload,indent=2))
