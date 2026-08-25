from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))

from api_football_live_provider import (
    EVENT_OBSERVATION_VERSION,
    event_to_dict,
    parse_response,
    parse_response_with_events,
)


def fixture(events):
    return {
        "fixture": {
            "id": 1001,
            "date": "2026-08-24T19:00:00+00:00",
            "status": {"long": "Second Half", "short": "2H", "elapsed": 72, "extra": None},
        },
        "league": {"id": 39, "season": 2026, "round": "Regular Season - 1"},
        "teams": {
            "home": {"id": 10, "name": "Alpha FC"},
            "away": {"id": 20, "name": "Beta FC"},
        },
        "goals": {"home": 2, "away": 1},
        "events": events,
    }


def main() -> int:
    observed_at = "2026-08-24T20:32:10Z"
    source_url = "https://v3.football.api-sports.io/fixtures?live=39"
    events = [
        {
            "time": {"elapsed": 12, "extra": None},
            "team": {"id": 10, "name": "Alpha FC"},
            "player": {"id": 101, "name": "A. Forward"},
            "assist": {"id": 102, "name": "A. Creator"},
            "type": "Goal",
            "detail": "Normal Goal",
            "comments": None,
        },
        {
            "time": {"elapsed": 34, "extra": None},
            "team": {"id": 20, "name": "Beta FC"},
            "player": {"id": 201, "name": "B. Mid"},
            "assist": {"id": None, "name": None},
            "type": "Card",
            "detail": "Red Card",
            "comments": "Serious foul",
        },
        {
            "time": {"elapsed": 46, "extra": None},
            "team": {"id": 20, "name": "Beta FC"},
            "player": {"id": 202, "name": "B. Old"},
            "assist": {"id": 203, "name": "B. New"},
            "type": "subst",
            "detail": "Substitution 1",
            "comments": None,
        },
        {
            "time": {"elapsed": 60, "extra": None},
            "team": {"id": 20, "name": "Beta FC"},
            "player": {"id": 204, "name": "B. Penalty"},
            "assist": {"id": None, "name": None},
            "type": "Goal",
            "detail": "Missed Penalty",
            "comments": None,
        },
        {
            "time": {"elapsed": 71, "extra": 1},
            "team": {"id": 10, "name": "Alpha FC"},
            "player": {"id": None, "name": None},
            "assist": {"id": None, "name": None},
            "type": "VAR",
            "detail": "Goal Disallowed",
            "comments": None,
        },
        {
            "time": {"elapsed": 72, "extra": None},
            "team": {"id": 10, "name": "Alpha FC"},
            "player": {"id": None, "name": None},
            "assist": {"id": None, "name": None},
            "type": "Cooling Break",
            "detail": "Hydration",
            "comments": None,
        },
    ]
    payload = {"errors": [], "response": [fixture(events)]}

    old_rows = parse_response(payload, observed_at=observed_at, source_url=source_url)
    snapshots, normalized = parse_response_with_events(payload, observed_at=observed_at, source_url=source_url)
    assert snapshots == old_rows
    assert len(normalized) == 6
    assert len({row.event_observation_id for row in normalized}) == 6

    goal = normalized[0]
    assert goal.observation_version == EVENT_OBSERVATION_VERSION
    assert goal.fixture_id == "EPL-API_FOOTBALL-1001"
    assert goal.provider_fixture_id == 1001
    assert goal.side == "HOME"
    assert goal.event_type == "GOAL"
    assert goal.event_detail == "NORMAL_GOAL"
    assert goal.goal_effect == "SCORE"
    assert goal.timeline_eligible is True
    assert goal.player_id == 101
    assert goal.assist_player_id == 102
    assert len(goal.source_fixture_sha256) == 64
    assert len(goal.source_event_sha256) == 64

    card = normalized[1]
    assert card.side == "AWAY"
    assert card.event_type == "CARD"
    assert card.card_effect == "DISMISSAL"
    assert card.comments == "Serious foul"

    substitution = normalized[2]
    assert substitution.event_type == "SUBSTITUTION"
    assert substitution.player_name == "B. Old"
    assert substitution.assist_player_name == "B. New"

    missed = normalized[3]
    assert missed.event_type == "GOAL"
    assert missed.goal_effect == "NO_SCORE"
    assert missed.timeline_eligible is True

    var = normalized[4]
    assert var.event_type == "VAR"
    assert var.extra_minute == 1
    assert var.event_detail == "GOAL_DISALLOWED"

    unknown = normalized[5]
    assert unknown.event_type == "OTHER"
    assert unknown.raw_type == "Cooling Break"
    assert unknown.timeline_eligible is False
    assert "EVENT_TYPE_UNMAPPED" in unknown.reasons
    assert event_to_dict(unknown)["reasons"] == ["EVENT_TYPE_UNMAPPED"]

    payload_missing_team = {"errors": [], "response": [fixture([{
        "time": {"elapsed": 20, "extra": None},
        "team": {"id": None, "name": None},
        "player": {"id": None, "name": None},
        "assist": {"id": None, "name": None},
        "type": "Card",
        "detail": "Yellow Card",
        "comments": None,
    }])]}
    _, retained = parse_response_with_events(payload_missing_team, observed_at=observed_at, source_url=source_url)
    assert len(retained) == 1
    assert retained[0].side == "UNKNOWN"
    assert retained[0].timeline_eligible is False
    assert "EVENT_TEAM_ID_MISSING" in retained[0].reasons

    payload_no_events = {"errors": [], "response": [fixture(None)]}
    _, no_events = parse_response_with_events(payload_no_events, observed_at=observed_at, source_url=source_url)
    assert no_events == []

    print("API_FOOTBALL_GAME_EVENTS=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
