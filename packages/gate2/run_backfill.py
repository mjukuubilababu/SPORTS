
import csv, json, sys
from gate2_engine import Match, build_features, feature_row_to_dict

if len(sys.argv) != 3:
    raise SystemExit("Usage: python run_backfill.py input.csv output.json")

rows=[]
with open(sys.argv[1], newline="", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        def fnum(x):
            return None if x in ("",None) else float(x)
        rows.append(Match(
            date=r["date"], season=int(r["season"]), league=r["league"],
            home=r["home"], away=r["away"], hg=int(r["hg"]), ag=int(r["ag"]),
            o25=fnum(r.get("o25")), o35=fnum(r.get("o35")), u35=fnum(r.get("u35")),
            quote_verified=str(r.get("quote_verified","")).lower()=="true",
            lineup_state=r.get("lineup_state","UNKNOWN") or "UNKNOWN",
            attacking_upgrade=str(r.get("attacking_upgrade","")).lower()=="true"
        ))

features=[feature_row_to_dict(x) for x in build_features(rows)]
with open(sys.argv[2],"w",encoding="utf-8") as f:
    json.dump(features,f,indent=2)
print(f"Wrote {len(features)} feature rows")
