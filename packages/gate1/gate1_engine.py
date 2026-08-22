
from __future__ import annotations
from dataclasses import dataclass, asdict
from datetime import datetime
from enum import Enum
from hashlib import sha256
from typing import Optional, Iterable, Dict, List, Tuple
import re


class QuoteType(str, Enum):
    CLOSING = "CLOSING"
    BOOKMAKER_SNAPSHOT = "BOOKMAKER_SNAPSHOT"
    OPENER = "OPENER"
    UNKNOWN = "UNKNOWN"


class SourceRole(str, Enum):
    PRIMARY_CLOSING = "PRIMARY_CLOSING"
    SECONDARY_CROSSCHECK = "SECONDARY_CROSSCHECK"
    PREFILTER_ONLY = "PREFILTER_ONLY"


class RecordStatus(str, Enum):
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    QUARANTINED = "QUARANTINED"


@dataclass(frozen=True)
class SourcePolicy:
    source: str
    role: SourceRole
    closing_semantics_confirmed: bool
    provider: str
    notes: str


@dataclass
class OddsRecord:
    match_date: str
    league: str
    season: int
    home_team: str
    away_team: str
    o25: Optional[float] = None
    u25: Optional[float] = None
    o35: Optional[float] = None
    u35: Optional[float] = None
    source: str = ""
    provider: str = ""
    source_url: str = ""
    quote_type: QuoteType = QuoteType.UNKNOWN
    observed_at: Optional[str] = None
    match_id: Optional[str] = None


@dataclass
class TruthDecision:
    match_id: str
    status: RecordStatus
    price_gate: str
    validation_n_eligible: bool
    reasons: List[str]
    record: OddsRecord


TEAM_ALIASES = {
    "la galaxy": "los angeles galaxy",
    "los angeles galaxy": "los angeles galaxy",
    "lafc": "los angeles fc",
    "los angeles fc": "los angeles fc",
    "inter miami cf": "inter miami",
    "inter miami": "inter miami",
    "ny red bulls": "new york red bulls",
    "new york rb": "new york red bulls",
    "new york red bulls": "new york red bulls",
    "cf montreal": "cf montreal",
    "montreal": "cf montreal",
    "st. louis city": "st louis city",
    "st louis city sc": "st louis city",
    "st louis city": "st louis city",
    "sporting kansas city": "sporting kansas city",
    "sporting kc": "sporting kansas city",
    "sj earthquakes": "san jose earthquakes",
    "san jose": "san jose earthquakes",
    "san jose earthquakes": "san jose earthquakes",
    "fc dallas": "fc dallas",
    "dallas": "fc dallas",
    "dc united": "dc united",
    "d.c. united": "dc united",
    "new england revolution": "new england revolution",
    "ne revolution": "new england revolution",
    "vancouver whitecaps fc": "vancouver whitecaps",
    "vancouver whitecaps": "vancouver whitecaps",
}


SOURCE_REGISTRY: Dict[str, SourcePolicy] = {
    "Footiqo": SourcePolicy(
        source="Footiqo",
        role=SourceRole.PRIMARY_CLOSING,
        closing_semantics_confirmed=True,
        provider="1xBet",
        notes="Historical odds page explicitly describes odds as closing odds and states 1xBet source."
    ),
    "OddsPortal": SourcePolicy(
        source="OddsPortal",
        role=SourceRole.SECONDARY_CROSSCHECK,
        closing_semantics_confirmed=True,
        provider="Multi-book",
        notes="Historical results documentation defines closing odds as final price before match begins."
    ),
    "BetExplorer": SourcePolicy(
        source="BetExplorer",
        role=SourceRole.SECONDARY_CROSSCHECK,
        closing_semantics_confirmed=False,
        provider="Multi-book",
        notes="Archive useful for cross-check; do not promote to validation N without explicit closing semantics for extracted row."
    ),
    "SportsbookReview": SourcePolicy(
        source="SportsbookReview",
        role=SourceRole.PREFILTER_ONLY,
        closing_semantics_confirmed=False,
        provider="Multi-book",
        notes="Can expose opener/bookmaker snapshots and odds history; extracted snapshot is not automatically closing."
    ),
    "BetMGM": SourcePolicy(
        source="BetMGM",
        role=SourceRole.PREFILTER_ONLY,
        closing_semantics_confirmed=False,
        provider="BetMGM",
        notes="Archived pre-match market evidence; not counted as closing unless separately verified."
    ),
    "FOX Sports": SourcePolicy(
        source="FOX Sports",
        role=SourceRole.PREFILTER_ONLY,
        closing_semantics_confirmed=False,
        provider="Listed sportsbook market",
        notes="Snapshot/reference market only unless timestamped closing semantics are separately confirmed."
    ),
}


P002_PRICE_RULE = {
    "market": "Under 3.5",
    "o25_max": 1.60,
    "u35_min": 1.55,
    "u35_max": 1.75,
    "locked": True,
    "locked_at": "2026-08-20T02:52:00+03:00",
}


def _norm_text(value: str) -> str:
    value = value.strip().lower()
    value = value.replace("&", "and")
    value = re.sub(r"[^a-z0-9 ]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def normalize_team(team: str) -> str:
    t = _norm_text(team)
    return TEAM_ALIASES.get(t, t)


def normalize_date(value: str) -> str:
    value = value.strip()
    fmts = (
        "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y",
        "%Y-%m-%dT%H:%M:%S", "%d-%m-%y %H:%M", "%d/%m/%Y %H:%M"
    )
    for fmt in fmts:
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            pass
    # Accept ISO datetime with timezone.
    try:
        return datetime.fromisoformat(value).date().isoformat()
    except ValueError:
        raise ValueError(f"Unsupported date format: {value}")


def canonical_match_id(record: OddsRecord) -> str:
    d = normalize_date(record.match_date)
    home = normalize_team(record.home_team)
    away = normalize_team(record.away_team)
    raw = f"{record.league.lower()}|{record.season}|{d}|{home}|{away}"
    digest = sha256(raw.encode("utf-8")).hexdigest()[:12]
    return f"{record.league.upper()}-{record.season}-{d}-{digest}"


def price_gate(record: OddsRecord) -> Tuple[str, List[str]]:
    reasons = []
    if record.o25 is None or record.u35 is None:
        return "PENDING", ["Missing exact O2.5 and/or U3.5 price."]
    if record.o25 > P002_PRICE_RULE["o25_max"]:
        reasons.append(f"O2.5 {record.o25:.3f} > {P002_PRICE_RULE['o25_max']:.2f}.")
    if not (P002_PRICE_RULE["u35_min"] <= record.u35 <= P002_PRICE_RULE["u35_max"]):
        reasons.append(
            f"U3.5 {record.u35:.3f} outside "
            f"{P002_PRICE_RULE['u35_min']:.2f}-{P002_PRICE_RULE['u35_max']:.2f}."
        )
    return ("PASS" if not reasons else "FAIL"), reasons


def validate_truth_record(record: OddsRecord) -> TruthDecision:
    reasons: List[str] = []
    record.match_id = record.match_id or canonical_match_id(record)

    if record.league.upper() != "MLS":
        reasons.append("Wrong league.")
    if record.season < 2000 or record.season > 2100:
        reasons.append("Invalid season.")

    policy = SOURCE_REGISTRY.get(record.source)
    if not policy:
        reasons.append("Unknown/unregistered source.")
        policy = SourcePolicy(record.source, SourceRole.PREFILTER_ONLY, False, record.provider, "Unregistered")

    gate, gate_reasons = price_gate(record)

    # Validation-N eligibility is deliberately stricter than ordinary acceptance.
    closing_ok = (
        record.quote_type == QuoteType.CLOSING
        and policy.closing_semantics_confirmed
        and policy.role in (SourceRole.PRIMARY_CLOSING, SourceRole.SECONDARY_CROSSCHECK)
    )

    if record.o25 is not None and record.o25 <= 1.0:
        reasons.append("Invalid O2.5 decimal odds.")
    if record.u35 is not None and record.u35 <= 1.0:
        reasons.append("Invalid U3.5 decimal odds.")

    if reasons:
        status = RecordStatus.QUARANTINED
    else:
        status = RecordStatus.ACCEPTED

    eligible = bool(status == RecordStatus.ACCEPTED and closing_ok and gate == "PASS")
    if not closing_ok:
        reasons.append("Not closing-confirmed under registered source policy; excluded from validation N.")
    reasons.extend(gate_reasons)

    return TruthDecision(
        match_id=record.match_id,
        status=status,
        price_gate=gate,
        validation_n_eligible=eligible,
        reasons=reasons,
        record=record,
    )


def deduplicate(records: Iterable[OddsRecord]) -> Tuple[List[OddsRecord], List[OddsRecord]]:
    seen = {}
    unique, duplicates = [], []
    for r in records:
        mid = r.match_id or canonical_match_id(r)
        # Provider + quote type makes same match from two sources a cross-check, not duplicate.
        key = (mid, r.source, r.provider, r.quote_type.value)
        if key in seen:
            duplicates.append(r)
        else:
            seen[key] = True
            r.match_id = mid
            unique.append(r)
    return unique, duplicates


def devig_two_way(over_odds: float, under_odds: float) -> Tuple[float, float]:
    if over_odds <= 1 or under_odds <= 1:
        raise ValueError("Decimal odds must be > 1.")
    po, pu = 1/over_odds, 1/under_odds
    s = po + pu
    return po/s, pu/s


def gate1_acceptance_tests() -> Dict[str, bool]:
    tests = {}
    a = OddsRecord(
        match_date="2026-02-22", league="MLS", season=2026,
        home_team="Vancouver Whitecaps", away_team="Real Salt Lake",
        o25=1.46, o35=2.21, u35=1.73,
        source="Footiqo", provider="1xBet", quote_type=QuoteType.CLOSING
    )
    d = validate_truth_record(a)
    tests["closing_primary_can_enter_validation_n"] = d.validation_n_eligible is True

    b = OddsRecord(
        match_date="2025-06-26", league="MLS", season=2025,
        home_team="Dallas", away_team="SJ Earthquakes",
        o25=1.50, o35=2.25, u35=1.55,
        source="BetMGM", provider="BetMGM", quote_type=QuoteType.BOOKMAKER_SNAPSHOT
    )
    d2 = validate_truth_record(b)
    tests["snapshot_cannot_enter_validation_n"] = d2.validation_n_eligible is False
    tests["snapshot_can_still_pass_price_gate"] = d2.price_gate == "PASS"

    c = OddsRecord(
        match_date="2025-06-26", league="MLS", season=2025,
        home_team="Dallas", away_team="San Jose Earthquakes",
        o25=1.50, u35=1.55, source="UnknownFeed", provider="X",
        quote_type=QuoteType.CLOSING
    )
    d3 = validate_truth_record(c)
    tests["unknown_source_quarantined"] = d3.status == RecordStatus.QUARANTINED

    x = OddsRecord(match_date="2025-06-26", league="MLS", season=2025, home_team="Dallas", away_team="SJ Earthquakes")
    y = OddsRecord(match_date="26/06/2025", league="MLS", season=2025, home_team="FC Dallas", away_team="San Jose Earthquakes")
    tests["canonical_team_aliases_match"] = canonical_match_id(x) == canonical_match_id(y)

    u, dup = deduplicate([a, a])
    tests["duplicate_detection"] = len(u) == 1 and len(dup) == 1
    return tests
