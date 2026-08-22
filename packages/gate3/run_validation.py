
import csv, json, sys
from gate3_engine import SettledPrediction, evaluate, report_to_dict, promotion_readiness

if len(sys.argv) != 3:
    raise SystemExit("Usage: python run_validation.py predictions.csv report.json")

rows=[]
with open(sys.argv[1], newline="", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        rows.append(SettledPrediction(
            match_id=r["match_id"],
            model_prob=float(r["model_prob"]),
            market_prob=float(r["market_prob"]),
            outcome=int(r["outcome"]),
            entry_odds=float(r["entry_odds"]),
            closing_odds=None if not r.get("closing_odds") else float(r["closing_odds"]),
            stake=float(r.get("stake") or 1.0),
            qualified=str(r.get("qualified","true")).lower()=="true",
            pattern_id=r.get("pattern_id") or "P002"
        ))

report=evaluate(rows)
payload={"report":report_to_dict(report),"promotion_readiness":promotion_readiness(report)}
with open(sys.argv[2],"w",encoding="utf-8") as f:
    json.dump(payload,f,indent=2)
print(json.dumps(payload,indent=2))
