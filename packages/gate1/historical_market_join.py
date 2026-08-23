from __future__ import annotations

import copy
import csv
import io
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Tuple

from gate1_engine import OddsRecord, QuoteType, normalize_date, normalize_team, validate_truth_record


JOIN_VERSION = "HISTORICAL_CLOSING_MARKET_JOIN_V0_1"
DATE_TOLERANCE_DAYS = 1


@dataclass(frozen=True)
class HistoricalMarketObservation:
    observation_id: str
    match_date: str
    season: int
    league: str
    home_team: str
    away_team: str
    source: str
    provider: str
    source_url: str
    quote_type: QuoteType
    o25: Optional[float] = None
    u25: Optional[float] = None
    o35: Optional[float] = None
    u35: Optional[float] = None

    @property
    def pair(self) -> Tuple[str, str]:
        return (self.home_team, self.away_team)

    @property
    def odds_key(self) -> Tuple:
        return (self.o25, self.u25, self.o35, self.u35, self.source, self.provider)


def _first(row: Dict[str, str], *names: str) -> str:
    for name in names:
        if name in row and row[name] not in (None, ""):
            return str(row[name]).strip()
    return ""


def _float(row: Dict[str, str], *names: str) -> Optional[float]:
    value = _first(row, *names)
    return None if value == "" else float(value)


def _season(row: Dict[str, str], match_date: str) -> int:
    value = _first(row, "Season", "season")
    if value:
        return int(float(value))
    return datetime.fromisoformat(normalize_date(match_date)).year


def parse_footiqo_odds_csv(text: str, *, source_url: str) -> List[HistoricalMarketObservation]:
    observations: List[HistoricalMarketObservation] = []
    for index, row in enumerate(csv.DictReader(io.StringIO(text)), start=1):
        match_date = _first(row, "matchDate", "Match Date", "date", "Date")
        home = _first(row, "homeTeam", "Home Team", "home", "Home")
        away = _first(row, "awayTeam", "Away Team", "away", "Away")
        if not match_date or not home or not away:
            continue
        o25 = _float(row, "O25", "Over 2.5 Goals", "o25")
        u25 = _float(row, "U25", "Under 2.5 Goals", "u25")
        o35 = _float(row, "O35", "Over 3.5 Goals", "o35")
        u35 = _float(row, "U35", "Under 3.5 Goals", "u35")
        if all(value is None for value in (o25, u25, o35, u35)):
            continue
        observations.append(HistoricalMarketObservation(
            observation_id=_first(row, "id", "ID") or f"FOOTIQO-{index}",
            match_date=normalize_date(match_date),
            season=_season(row, match_date),
            league=_first(row, "League", "league") or "MLS",
            home_team=normalize_team(home),
            away_team=normalize_team(away),
            source="Footiqo",
            provider="1xBet",
            source_url=source_url,
            quote_type=QuoteType.CLOSING,
            o25=o25,
            u25=u25,
            o35=o35,
            u35=u35,
        ))
    return observations


def _date_distance_days(a: str, b: str) -> int:
    return abs((datetime.fromisoformat(normalize_date(a)).date() - datetime.fromisoformat(normalize_date(b)).date()).days)


def _market_payload(observation: HistoricalMarketObservation, decision) -> Dict:
    target_line_available = bool(
        observation.o35 is not None and observation.u35 is not None
        and observation.o35 > 1 and observation.u35 > 1
    )
    market_join_eligible = decision.status.value == "ACCEPTED" and target_line_available
    return {
        "status": decision.status.value,
        "market_join_eligible": market_join_eligible,
        "validation_n_eligible": bool(decision.validation_n_eligible),
        "price_gate": decision.price_gate,
        "reasons": list(decision.reasons),
        "source": observation.source,
        "provider": observation.provider,
        "source_url": observation.source_url,
        "source_match_date": observation.match_date,
        "quote_type": observation.quote_type.value,
        "observation_id": observation.observation_id,
        "o25": observation.o25,
        "u25": observation.u25,
        "o35": observation.o35,
        "u35": observation.u35,
        "target_line_o35_u35_available": target_line_available,
    }


def join_historical_markets(truth_store: Dict, observations: Iterable[HistoricalMarketObservation]) -> Dict:
    if truth_store.get("store_version") != "CANONICAL_HISTORICAL_TRUTH_STORE_V0_1":
        raise ValueError("UNSUPPORTED_TRUTH_STORE_VERSION")
    if truth_store.get("data_nature") != "REAL_HISTORICAL_TRUTH":
        raise ValueError("TRUTH_STORE_DATA_NATURE_INVALID")

    output = copy.deepcopy(truth_store)
    obs_rows = list(observations)
    by_pair: Dict[Tuple[str, str], List[HistoricalMarketObservation]] = {}
    for observation in obs_rows:
        if str(observation.league).upper() != "MLS":
            continue
        by_pair.setdefault(observation.pair, []).append(observation)

    quarantine: List[Dict] = []
    joined = 0
    target_line_ready = 0
    validation_n = 0

    for record in output.get("records", []):
        pair = (normalize_team(record["home_team"]), normalize_team(record["away_team"]))
        candidates = [
            observation for observation in by_pair.get(pair, [])
            if int(observation.season) == int(record["season"])
            and _date_distance_days(observation.match_date, record["canonical_match_date"]) <= DATE_TOLERANCE_DAYS
        ]
        if not candidates:
            continue

        candidates.sort(key=lambda x: (_date_distance_days(x.match_date, record["canonical_match_date"]), x.match_date, x.observation_id))
        closest_distance = _date_distance_days(candidates[0].match_date, record["canonical_match_date"])
        closest = [x for x in candidates if _date_distance_days(x.match_date, record["canonical_match_date"]) == closest_distance]
        distinct = {x.odds_key for x in closest}
        if len(distinct) > 1:
            quarantine.append({
                "match_id": record["match_id"],
                "reason": "CONFLICTING_CLOSING_MARKET_OBSERVATIONS",
                "observations": [x.__dict__ | {"quote_type": x.quote_type.value} for x in closest],
            })
            continue

        observation = closest[0]
        odds_record = OddsRecord(
            match_date=record["canonical_match_date"],
            league=record["league"],
            season=int(record["season"]),
            home_team=record["home_team"],
            away_team=record["away_team"],
            o25=observation.o25,
            u25=observation.u25,
            o35=observation.o35,
            u35=observation.u35,
            source=observation.source,
            provider=observation.provider,
            source_url=observation.source_url,
            quote_type=observation.quote_type,
            match_id=record["match_id"],
        )
        decision = validate_truth_record(odds_record)
        market = _market_payload(observation, decision)
        record["market"] = market
        record["gate1_validation_n_eligible"] = bool(market["validation_n_eligible"] and record.get("result", {}).get("verified"))
        joined += 1
        target_line_ready += int(market["market_join_eligible"])
        validation_n += int(record["gate1_validation_n_eligible"])

    output["market_join"] = {
        "join_version": JOIN_VERSION,
        "date_tolerance_days": DATE_TOLERANCE_DAYS,
        "source_semantics": "FOOTIQO_1XBET_CLOSING_ODDS",
        "summary": {
            "truth_records": len(output.get("records", [])),
            "market_observations_received": len(obs_rows),
            "records_joined_to_closing_market": joined,
            "target_line_o35_u35_ready": target_line_ready,
            "gate1_validation_n_eligible": validation_n,
            "market_conflicts_quarantined": len(quarantine),
        },
        "quarantine": quarantine,
        "governance": {
            "join_uses_identity_not_final_score": True,
            "closing_semantics_required": True,
            "market_source_independent_from_result_sources": True,
            "market_odds_never_inferred_from_result": True,
            "p002_price_gate_preserved": True,
            "gate2_can_use_target_line_market_without_implying_p002_qualification": True,
        },
    }
    output["summary"]["gate1_validation_n_eligible"] = validation_n
    output["summary"]["market_missing"] = sum(1 for x in output.get("records", []) if x.get("market", {}).get("status") == "MISSING")
    return output
