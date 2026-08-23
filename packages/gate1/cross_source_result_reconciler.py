from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Tuple

from gate1_engine import normalize_team
from historical_truth_importer import HistoricalTruthInput, import_historical_rows


RECONCILER_VERSION = "CROSS_SOURCE_RESULT_RECONCILER_V0_1"
VERIFICATION_METHOD = "CROSS_SOURCE_TEAM_SCORE_DATE_TOLERANCE_V0_1"
DATE_TOLERANCE_DAYS = 1

SOURCE_REGISTRY = {
    "MLSOPENSKILL": {
        "source": "MLSOpenSkill",
        "url": "https://raw.githubusercontent.com/dewanthenmalai/MLSOpenSkill/main/mls-2025.csv",
        "git_blob_sha1": "022c9bc83a3196adc702bf84a64217571b087630",
        "date_semantics": "UTC_DATETIME",
    },
    "OPENFOOTBALL": {
        "source": "OpenFootball football.json",
        "url": "https://raw.githubusercontent.com/openfootball/football.json/master/2025/mls.json",
        "git_blob_sha1": "2896d283601615739418575cbe6b6c9b316a3151",
        "date_semantics": "SOURCE_LOCAL_MATCH_DATE",
    },
}

SOURCE_A_TEAM_ALIASES = {
    "LAFC": "Los Angeles FC",
    "MIN": "Minnesota United FC",
    "MIA": "Inter Miami CF",
    "NYC": "New York City FC",
    "ATL": "Atlanta United FC",
    "MTL": "CF Montreal",
    "CIN": "FC Cincinnati",
    "RBNY": "New York Red Bulls",
    "CLB": "Columbus Crew",
    "CHI": "Chicago Fire",
    "DC": "DC United",
    "TOR": "Toronto FC",
    "ORL": "Orlando City",
    "PHI": "Philadelphia Union",
    "ATX": "Austin FC",
    "SKC": "Sporting Kansas City",
    "HOU": "Houston Dynamo",
    "DAL": "FC Dallas",
    "NSH": "Nashville SC",
    "NE": "New England Revolution",
    "STL": "St Louis City",
    "COL": "Colorado Rapids",
    "SJ": "San Jose Earthquakes",
    "RSL": "Real Salt Lake",
    "SEA": "Seattle Sounders",
    "CLT": "Charlotte FC",
    "POR": "Portland Timbers",
    "VAN": "Vancouver Whitecaps",
    "LA": "Los Angeles Galaxy",
    "SD": "San Diego FC",
}

SOURCE_B_TEAM_ALIASES = {
    "D.C. United": "DC United",
    "CF Montréal": "CF Montreal",
    "New York RB": "New York Red Bulls",
    "St. Louis City SC": "St Louis City",
    "Minnesota United FC": "Minnesota United FC",
    "Seattle Sounders": "Seattle Sounders",
    "Vancouver Whitecaps": "Vancouver Whitecaps",
}


@dataclass(frozen=True)
class SourceResult:
    source_key: str
    source_row_id: str
    source_date: str
    home_team: str
    away_team: str
    home_goals: int
    away_goals: int
    round_name: str = ""

    @property
    def pair(self) -> Tuple[str, str]:
        return (self.home_team, self.away_team)

    @property
    def score(self) -> Tuple[int, int]:
        return (self.home_goals, self.away_goals)


def git_blob_sha1(payload: bytes) -> str:
    header = f"blob {len(payload)}\0".encode("utf-8")
    return hashlib.sha1(header + payload).hexdigest()


def verify_source_blob(payload: bytes, source_key: str) -> Dict[str, object]:
    config = SOURCE_REGISTRY[source_key]
    actual = git_blob_sha1(payload)
    expected = config["git_blob_sha1"]
    return {
        "source_key": source_key,
        "expected_git_blob_sha1": expected,
        "actual_git_blob_sha1": actual,
        "verified": actual == expected,
    }


def _team(value: str, aliases: Dict[str, str]) -> str:
    expanded = aliases.get(value.strip(), value.strip())
    return normalize_team(expanded)


def _parse_score(value: str) -> Optional[Tuple[int, int]]:
    match = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*", value or "")
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def parse_mlsopenskill_csv(text: str) -> List[SourceResult]:
    rows: List[SourceResult] = []
    for raw in csv.DictReader(io.StringIO(text)):
        score = _parse_score(raw.get("Result", ""))
        if score is None:
            continue
        observed = datetime.strptime(raw["Date"], "%d/%m/%Y %H:%M")
        rows.append(SourceResult(
            source_key="MLSOPENSKILL",
            source_row_id=str(raw.get("Match Number") or ""),
            source_date=observed.date().isoformat(),
            home_team=_team(raw["Home Team"], SOURCE_A_TEAM_ALIASES),
            away_team=_team(raw["Away Team"], SOURCE_A_TEAM_ALIASES),
            home_goals=score[0],
            away_goals=score[1],
            round_name=str(raw.get("Round Number") or ""),
        ))
    return rows


def _openfootball_score(raw_score) -> Optional[Tuple[int, int]]:
    if isinstance(raw_score, list) and len(raw_score) == 2:
        return int(raw_score[0]), int(raw_score[1])
    if isinstance(raw_score, dict):
        ft = raw_score.get("ft")
        if isinstance(ft, list) and len(ft) == 2:
            return int(ft[0]), int(ft[1])
    return None


def parse_openfootball_json(text: str) -> List[SourceResult]:
    payload = json.loads(text)
    rows: List[SourceResult] = []
    for index, raw in enumerate(payload.get("matches", []), start=1):
        score = _openfootball_score(raw.get("score"))
        if score is None:
            continue
        rows.append(SourceResult(
            source_key="OPENFOOTBALL",
            source_row_id=str(index),
            source_date=datetime.fromisoformat(raw["date"]).date().isoformat(),
            home_team=_team(raw["team1"], SOURCE_B_TEAM_ALIASES),
            away_team=_team(raw["team2"], SOURCE_B_TEAM_ALIASES),
            home_goals=score[0],
            away_goals=score[1],
            round_name=str(raw.get("round") or ""),
        ))
    return rows


def _date_distance_days(a: str, b: str) -> int:
    return abs((datetime.fromisoformat(a).date() - datetime.fromisoformat(b).date()).days)


def reconcile_results(source_a: Iterable[SourceResult], source_b: Iterable[SourceResult]) -> Dict:
    a_rows = list(source_a)
    b_rows = list(source_b)
    b_by_pair: Dict[Tuple[str, str], List[SourceResult]] = {}
    for row in b_rows:
        b_by_pair.setdefault(row.pair, []).append(row)

    matched: List[HistoricalTruthInput] = []
    quarantine: List[Dict] = []
    consumed_b = set()

    for left in a_rows:
        candidates = [
            right for right in b_by_pair.get(left.pair, [])
            if _date_distance_days(left.source_date, right.source_date) <= DATE_TOLERANCE_DAYS
        ]
        if not candidates:
            quarantine.append({
                "reason": "NO_CROSS_SOURCE_MATCH",
                "source_a": left.__dict__,
            })
            continue

        candidates.sort(key=lambda right: (_date_distance_days(left.source_date, right.source_date), right.source_date, right.source_row_id))
        score_matches = [right for right in candidates if right.score == left.score]
        if not score_matches:
            quarantine.append({
                "reason": "CROSS_SOURCE_SCORE_DISAGREEMENT",
                "source_a": left.__dict__,
                "source_b_candidates": [right.__dict__ for right in candidates],
            })
            continue

        right = score_matches[0]
        b_key = (right.source_row_id, right.source_date, right.home_team, right.away_team)
        if b_key in consumed_b:
            quarantine.append({
                "reason": "CROSS_SOURCE_TARGET_ALREADY_CONSUMED",
                "source_a": left.__dict__,
                "source_b": right.__dict__,
            })
            continue
        consumed_b.add(b_key)

        matched.append(HistoricalTruthInput(
            match_date=right.source_date,
            season=2025,
            league="MLS",
            home_team=right.home_team,
            away_team=right.away_team,
            home_goals=right.home_goals,
            away_goals=right.away_goals,
            result_source=SOURCE_REGISTRY["OPENFOOTBALL"]["source"],
            result_source_url=SOURCE_REGISTRY["OPENFOOTBALL"]["url"],
            result_verified=True,
            result_source_match_date=right.source_date,
            result_crosscheck_source=SOURCE_REGISTRY["MLSOPENSKILL"]["source"],
            result_crosscheck_source_url=SOURCE_REGISTRY["MLSOPENSKILL"]["url"],
            result_crosscheck_match_date=left.source_date,
            result_verification_method=VERIFICATION_METHOD,
        ))

    unmatched_b = [
        row for row in b_rows
        if (row.source_row_id, row.source_date, row.home_team, row.away_team) not in consumed_b
    ]

    return {
        "reconciler_version": RECONCILER_VERSION,
        "date_tolerance_days": DATE_TOLERANCE_DAYS,
        "summary": {
            "source_a_scored_rows": len(a_rows),
            "source_b_scored_rows": len(b_rows),
            "cross_source_verified": len(matched),
            "source_a_quarantined": len(quarantine),
            "source_b_unmatched": len(unmatched_b),
        },
        "verified_rows": matched,
        "quarantine": quarantine,
        "unmatched_source_b": [row.__dict__ for row in unmatched_b],
    }


def build_truth_store_from_source_texts(source_a_csv: str, source_b_json: str, *, dataset_id: str) -> Dict:
    reconciliation = reconcile_results(
        parse_mlsopenskill_csv(source_a_csv),
        parse_openfootball_json(source_b_json),
    )
    store = import_historical_rows(reconciliation["verified_rows"], dataset_id=dataset_id)
    return {
        "source_audit": {
            "MLSOPENSKILL": SOURCE_REGISTRY["MLSOPENSKILL"],
            "OPENFOOTBALL": SOURCE_REGISTRY["OPENFOOTBALL"],
        },
        "reconciliation": {
            "reconciler_version": reconciliation["reconciler_version"],
            "date_tolerance_days": reconciliation["date_tolerance_days"],
            "summary": reconciliation["summary"],
            "quarantine": reconciliation["quarantine"],
            "unmatched_source_b": reconciliation["unmatched_source_b"],
        },
        "truth_store": store,
    }
