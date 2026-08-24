from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Dict, Iterable


REGISTRY_VERSION = "GLOBAL_COMPETITION_REGISTRY_V0_1"


@dataclass(frozen=True)
class Competition:
    competition_id: str
    country: str
    name: str
    tier: int
    season_format: str
    football_data_code: str
    research_season: str
    research_url: str
    source: str = "FOOTBALL_DATA_CO_UK"
    source_class: str = "PUBLIC_RESEARCH_DATASET"
    bookmaker_odds_are_model_inputs: bool = False


_COMPETITIONS = (
    Competition("EPL", "ENG", "Premier League", 1, "AUG_MAY", "E0", "2025/26", "https://www.football-data.co.uk/mmz4281/2526/E0.csv"),
    Competition("LA_LIGA", "ESP", "La Liga", 1, "AUG_MAY", "SP1", "2025/26", "https://www.football-data.co.uk/mmz4281/2526/SP1.csv"),
    Competition("SERIE_A", "ITA", "Serie A", 1, "AUG_MAY", "I1", "2025/26", "https://www.football-data.co.uk/mmz4281/2526/I1.csv"),
    Competition("BUNDESLIGA", "DEU", "Bundesliga", 1, "AUG_MAY", "D1", "2025/26", "https://www.football-data.co.uk/mmz4281/2526/D1.csv"),
    Competition("LIGUE_1", "FRA", "Ligue 1", 1, "AUG_MAY", "F1", "2025/26", "https://www.football-data.co.uk/mmz4281/2526/F1.csv"),
)

COMPETITIONS: Dict[str, Competition] = {row.competition_id: row for row in _COMPETITIONS}
BY_FOOTBALL_DATA_CODE: Dict[str, Competition] = {row.football_data_code: row for row in _COMPETITIONS}


def get_competition(competition_id: str) -> Competition:
    try:
        return COMPETITIONS[competition_id]
    except KeyError as exc:
        raise ValueError(f"UNKNOWN_COMPETITION_{competition_id}") from exc


def competition_for_code(code: str) -> Competition:
    try:
        return BY_FOOTBALL_DATA_CODE[code]
    except KeyError as exc:
        raise ValueError(f"UNKNOWN_FOOTBALL_DATA_CODE_{code}") from exc


def registry_manifest() -> dict:
    return {
        "version": REGISTRY_VERSION,
        "competition_count": len(COMPETITIONS),
        "competitions": [asdict(row) for row in _COMPETITIONS],
        "governance": {
            "same_contract_across_competitions": True,
            "competition_history_isolated": True,
            "bookmaker_odds_as_model_input": False,
            "pilot_current_live_coverage_claimed": False,
            "pilot_scope": "2025_26_PUBLIC_HISTORICAL_RESEARCH",
        },
    }


def iter_competitions() -> Iterable[Competition]:
    return iter(_COMPETITIONS)
