from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))

from api_football_live_provider import (
    event_to_dict,
    fetch_live_with_events,
    live_model_input,
    snapshot_to_dict,
)


DEFAULT_COMPETITIONS = ["EPL", "LA_LIGA", "SERIE_A", "BUNDESLIGA", "LIGUE_1"]


def parse_args():
    parser = argparse.ArgumentParser(description="Fetch documented API-Football live snapshots for canonical competitions.")
    parser.add_argument("output", nargs="?", default=str(ROOT / "artifacts" / "api-football-live-snapshot-v0.1.json"))
    parser.add_argument(
        "--competitions",
        default=",".join(DEFAULT_COMPETITIONS),
        help="Comma-separated canonical competition IDs.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    api_key = os.environ.get("APISPORTS_KEY", "").strip()
    if not api_key:
        raise SystemExit("APISPORTS_KEY_REQUIRED")

    competitions = [item.strip() for item in args.competitions.split(",") if item.strip()]
    rows, events, observed_at = fetch_live_with_events(api_key=api_key, competition_ids=competitions)

    live_rows = [row for row in rows if row.state == "LIVE_IN_PLAY"]
    output = {
        "capability": "API_FOOTBALL_LIVE_PROVIDER_V0_1",
        "observed_at": observed_at,
        "competitions_requested": competitions,
        "rows_n": len(rows),
        "live_in_play_n": len(live_rows),
        "snapshots": [snapshot_to_dict(row) for row in rows],
        "live_model_inputs": [live_model_input(row) for row in live_rows],
        "game_event_observation_version": "API_FOOTBALL_GAME_EVENT_OBSERVATION_V0_1",
        "events_n": len(events),
        "events": [event_to_dict(row) for row in events],
        "governance": {
            "provider_prediction_used": False,
            "bookmaker_data_used": False,
            "api_key_persisted": False,
            "silent_rate_multiplier_derivation": False,
            "events_share_existing_live_fixture_identity": True,
            "events_do_not_silently_change_live_rate_multipliers": True,
            "unmapped_events_retained_not_dropped": True,
            "real_money": "NO",
        },
    }

    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(path),
        "rows_n": len(rows),
        "live_in_play_n": len(live_rows),
        "events_n": len(events),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
