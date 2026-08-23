from __future__ import annotations

import json
import sys
from pathlib import Path

from historical_market_join import join_historical_markets, parse_footiqo_odds_csv


if len(sys.argv) != 4:
    raise SystemExit("Usage: python join_historical_markets.py truth_store.json footiqo_odds.csv output.json")

_, truth_path, odds_path, output_path = sys.argv
truth_store = json.loads(Path(truth_path).read_text(encoding="utf-8"))
odds_text = Path(odds_path).read_text(encoding="utf-8-sig")
observations = parse_footiqo_odds_csv(
    odds_text,
    source_url="https://footiqo.com/database/leagues/usa-mls/",
)
joined = join_historical_markets(truth_store, observations)
Path(output_path).write_text(json.dumps(joined, indent=2), encoding="utf-8")
print(json.dumps(joined["market_join"]["summary"], indent=2))
