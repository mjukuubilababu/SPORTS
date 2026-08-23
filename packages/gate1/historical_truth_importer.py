from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Dict, Iterable, List, Optional, Tuple

from gate1_engine import OddsRecord, QuoteType, canonical_match_id, normalize_date, normalize_team, validate_truth_record


STORE_VERSION = "CANONICAL_HISTORICAL_TRUTH_STORE_V0_1"
DATA_NATURE = "REAL_HISTORICAL_TRUTH"
CANONICAL_DATE_POLICY = "VENUE_LOCAL_MATCH_DATE"


@dataclass
class HistoricalTruthInput:
    match_date: str
    season: int
    league: str
    home_team: str
    away_team: str
    home_goals: int
    away_goals: int
    result_source: str
    result_source_url: str
    result_verified: bool
    o25: Optional[float] = None
    u25: Optional[float] = None
    o35: Optional[float] = None
    u35: Optional[float] = None
    market_source: str = ""
    market_provider: str = ""
    market_source_url: str = ""
    market_source_match_date: str = ""
    quote_type: str = "UNKNOWN"
    market_observed_at: str = ""


def _has_market(row: HistoricalTruthInput) -> bool:
    return any(x is not None for x in (row.o25, row.u25, row.o35, row.u35))


def _valid_score(value: int) -> bool:
    return isinstance(value, int) and value >= 0


def _quote_type(value: str) -> QuoteType:
    try:
        return QuoteType(str(value or "UNKNOWN").upper())
    except ValueError:
        return QuoteType.UNKNOWN


def canonicalize_historical_row(row: HistoricalTruthInput) -> Dict:
    reasons: List[str] = []
    canonical_date = normalize_date(row.match_date)
    home = normalize_team(row.home_team)
    away = normalize_team(row.away_team)

    identity_record = OddsRecord(
        match_date=canonical_date,
        league=row.league,
        season=row.season,
        home_team=home,
        away_team=away,
    )
    match_id = canonical_match_id(identity_record)

    result_verified = bool(
        row.result_verified
        and row.result_source.strip()
        and row.result_source_url.strip()
        and _valid_score(row.home_goals)
        and _valid_score(row.away_goals)
    )
    if not row.result_verified:
        reasons.append("RESULT_NOT_VERIFIED")
    if not row.result_source.strip() or not row.result_source_url.strip():
        reasons.append("RESULT_PROVENANCE_MISSING")
    if not _valid_score(row.home_goals) or not _valid_score(row.away_goals):
        reasons.append("FINAL_SCORE_INVALID")

    market = {
        "status": "MISSING",
        "validation_n_eligible": False,
        "price_gate": "PENDING",
        "reasons": ["MARKET_NOT_SUPPLIED"],
        "source": None,
        "provider": None,
        "source_url": None,
        "source_match_date": None,
        "quote_type": None,
        "observed_at": None,
        "o25": row.o25,
        "u25": row.u25,
        "o35": row.o35,
        "u35": row.u35,
    }

    if _has_market(row):
        odds = OddsRecord(
            match_date=canonical_date,
            league=row.league,
            season=row.season,
            home_team=home,
            away_team=away,
            o25=row.o25,
            u25=row.u25,
            o35=row.o35,
            u35=row.u35,
            source=row.market_source,
            provider=row.market_provider,
            source_url=row.market_source_url,
            quote_type=_quote_type(row.quote_type),
            observed_at=row.market_observed_at or None,
            match_id=match_id,
        )
        decision = validate_truth_record(odds)
        market = {
            "status": decision.status.value,
            "validation_n_eligible": bool(decision.validation_n_eligible and result_verified),
            "price_gate": decision.price_gate,
            "reasons": list(decision.reasons),
            "source": row.market_source or None,
            "provider": row.market_provider or None,
            "source_url": row.market_source_url or None,
            "source_match_date": normalize_date(row.market_source_match_date) if row.market_source_match_date else None,
            "quote_type": odds.quote_type.value,
            "observed_at": row.market_observed_at or None,
            "o25": row.o25,
            "u25": row.u25,
            "o35": row.o35,
            "u35": row.u35,
        }

    gate2_backfill_eligible = result_verified
    status = "ACCEPTED" if gate2_backfill_eligible else "QUARANTINED"

    return {
        "match_id": match_id,
        "status": status,
        "canonical_match_date": canonical_date,
        "canonical_date_policy": CANONICAL_DATE_POLICY,
        "season": int(row.season),
        "league": str(row.league).upper(),
        "home_team": home,
        "away_team": away,
        "final_score": {"home": row.home_goals, "away": row.away_goals},
        "result": {
            "verified": result_verified,
            "source": row.result_source or None,
            "source_url": row.result_source_url or None,
        },
        "market": market,
        "gate2_backfill_eligible": gate2_backfill_eligible,
        "gate1_validation_n_eligible": bool(market["validation_n_eligible"]),
        "reasons": sorted(set(reasons)),
    }


def _quality_rank(record: Dict) -> Tuple[int, int]:
    return (
        1 if record.get("gate1_validation_n_eligible") else 0,
        1 if record.get("market", {}).get("status") == "ACCEPTED" else 0,
    )


def import_historical_rows(rows: Iterable[HistoricalTruthInput], *, dataset_id: str) -> Dict:
    if not dataset_id:
        raise ValueError("DATASET_ID_REQUIRED")

    canonical = [canonicalize_historical_row(row) for row in rows]
    grouped: Dict[str, List[Dict]] = {}
    for record in canonical:
        grouped.setdefault(record["match_id"], []).append(record)

    records: List[Dict] = []
    conflicts: List[Dict] = []
    exact_duplicates = 0

    for match_id, group in sorted(grouped.items()):
        score_set = {(x["final_score"]["home"], x["final_score"]["away"]) for x in group}
        if len(score_set) > 1:
            conflicts.append({
                "match_id": match_id,
                "reason": "CONFLICTING_FINAL_SCORE",
                "observations": group,
            })
            continue

        group_sorted = sorted(group, key=_quality_rank, reverse=True)
        chosen = dict(group_sorted[0])
        chosen["duplicate_observations"] = max(0, len(group) - 1)
        chosen["supporting_result_sources"] = sorted({
            x["result"]["source"] for x in group if x.get("result", {}).get("source")
        })
        chosen["supporting_market_sources"] = sorted({
            x["market"]["source"] for x in group if x.get("market", {}).get("source")
        })
        exact_duplicates += max(0, len(group) - 1)
        records.append(chosen)

    summary = {
        "rows_received": len(canonical),
        "canonical_matches": len(records),
        "exact_or_same-score_duplicates_collapsed": exact_duplicates,
        "conflicting_matches_quarantined": len(conflicts),
        "gate2_backfill_eligible": sum(1 for x in records if x["gate2_backfill_eligible"]),
        "gate1_validation_n_eligible": sum(1 for x in records if x["gate1_validation_n_eligible"]),
        "market_missing": sum(1 for x in records if x["market"]["status"] == "MISSING"),
    }

    return {
        "store_version": STORE_VERSION,
        "dataset_id": dataset_id,
        "data_nature": DATA_NATURE,
        "canonical_date_policy": CANONICAL_DATE_POLICY,
        "summary": summary,
        "records": records,
        "quarantine": conflicts,
        "governance": {
            "result_provenance_required": True,
            "verified_result_required_for_gate2": True,
            "market_provenance_independent_from_result_provenance": True,
            "source_reported_market_date_preserved": True,
            "canonical_identity_uses_venue_local_match_date": True,
            "conflicting_final_scores_quarantined": True,
            "gate1_validation_eligibility_does_not_imply_gate3_validation": True,
        },
    }


def input_from_mapping(row: Dict[str, str]) -> HistoricalTruthInput:
    def opt_float(name: str) -> Optional[float]:
        value = row.get(name)
        return None if value in (None, "") else float(value)

    return HistoricalTruthInput(
        match_date=row["match_date"],
        season=int(row["season"]),
        league=row["league"],
        home_team=row["home_team"],
        away_team=row["away_team"],
        home_goals=int(row["home_goals"]),
        away_goals=int(row["away_goals"]),
        result_source=row["result_source"],
        result_source_url=row["result_source_url"],
        result_verified=str(row.get("result_verified", "false")).lower() == "true",
        o25=opt_float("o25"),
        u25=opt_float("u25"),
        o35=opt_float("o35"),
        u35=opt_float("u35"),
        market_source=row.get("market_source", ""),
        market_provider=row.get("market_provider", ""),
        market_source_url=row.get("market_source_url", ""),
        market_source_match_date=row.get("market_source_match_date", ""),
        quote_type=row.get("quote_type", "UNKNOWN"),
        market_observed_at=row.get("market_observed_at", ""),
    )
