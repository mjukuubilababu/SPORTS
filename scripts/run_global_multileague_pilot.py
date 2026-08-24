from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))

from football_data_multileague_adapter import build_gate2_features_by_competition, parse_football_data_csv
from global_competition_registry import iter_competitions, registry_manifest


USER_AGENT = "SPORTS-Decision-Intelligence-Research/0.1"


def fetch_text(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        if getattr(response, "status", 200) != 200:
            raise RuntimeError(f"SOURCE_HTTP_STATUS_{getattr(response, 'status', 'UNKNOWN')}:{url}")
        return response.read()


def main(argv: list[str]) -> int:
    output = Path(argv[1]) if len(argv) > 1 else ROOT / "artifacts" / "global-multileague-real-data-v0.1.json"
    output.parent.mkdir(parents=True, exist_ok=True)

    all_records = []
    source_meta = {}
    for competition in iter_competitions():
        raw = fetch_text(competition.research_url)
        raw_sha = hashlib.sha256(raw).hexdigest()
        text = raw.decode("utf-8-sig")
        records = parse_football_data_csv(text, competition=competition, source_url=competition.research_url)
        all_records.extend(records)
        source_meta[competition.competition_id] = {
            "source_url": competition.research_url,
            "raw_csv_sha256": raw_sha,
            "bytes": len(raw),
            "settled_n": len(records),
            "strict_gate1_eligible_n": sum(1 for row in records if row.strict_gate1_eligible),
            "source_closing_1x2_n": sum(1 for row in records if all(x is not None for x in (row.closing_home_odds, row.closing_draw_odds, row.closing_away_odds))),
            "source_closing_o25_pair_n": sum(1 for row in records if row.closing_over25_odds is not None and row.closing_under25_odds is not None),
            "qualification_scope": "RESEARCH_BACKFILL_ONLY",
        }

    feature_map = build_gate2_features_by_competition(all_records)
    leagues = {}
    for competition_id, meta in sorted(source_meta.items()):
        features = feature_map[competition_id]
        leagues[competition_id] = {
            **meta,
            "gate2_feature_n": len(features),
            "warmup_pass_n": sum(1 for row in features if row["warmup_pass"]),
            "model_probability_n": sum(1 for row in features if row["model_u35_prob"] is not None),
            "market_u35_probability_n": sum(1 for row in features if row["market_u35_prob"] is not None),
        }

    report = {
        "report_version": "GLOBAL_MULTILEAGUE_REAL_DATA_PILOT_V0_1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "registry": registry_manifest(),
        "source": {
            "name": "Football-Data.co.uk",
            "classification": "PUBLIC_RESEARCH_DATASET",
            "season": "2025/26",
        },
        "league_count": len(leagues),
        "total_settled_n": sum(row["settled_n"] for row in leagues.values()),
        "strict_gate1_eligible_n": sum(row["strict_gate1_eligible_n"] for row in leagues.values()),
        "leagues": leagues,
        "governance": {
            "research_backfill_only": True,
            "strict_p002_qualification_granted": False,
            "bookmaker_odds_used_as_model_inputs": False,
            "gate2_history_isolated_by_competition": True,
            "current_live_global_coverage_claimed": False,
            "promotion_claim": "NONE",
            "capital_effect": "NONE",
            "real_money": "NO",
        },
    }
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({
        "league_count": report["league_count"],
        "total_settled_n": report["total_settled_n"],
        "strict_gate1_eligible_n": report["strict_gate1_eligible_n"],
        "leagues": {k: {"settled_n": v["settled_n"], "model_probability_n": v["model_probability_n"]} for k, v in leagues.items()},
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
