from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from hashlib import sha256
import csv
import io
import json
from typing import Dict, Iterable, List, Sequence
from zoneinfo import ZoneInfo

from gate1_engine import OddsRecord, canonical_match_id, normalize_team
from gate2_engine import Match, build_features
from negbin_challenger import negbin_u35


CAPTURE_VERSION = "FUTURE_TEST_B_PREMATCH_CAPTURE_V0_1"
POISSON_MODEL_VERSION = "P002_GATE2_POISSON_U35_V0_1"
FIXTUREDOWNLOAD_UTC_CSV = "https://fixturedownload.com/download/mls-2026-UTC.csv"
OFFICIAL_MLS_2026_SCHEDULE = "https://www.mlssoccer.com/news/mls-announces-2026-regular-season-schedule"

FIXTURE_ALIASES = {
    "St. Louis CITY SC": "St Louis City",
    "D.C. United": "DC United",
    "Red Bull New York": "New York Red Bulls",
    "Vancouver Whitecaps FC": "Vancouver Whitecaps",
    "Minnesota United FC": "Minnesota United FC",
    "Houston Dynamo FC": "Houston Dynamo",
    "Chicago Fire FC": "Chicago Fire",
    "Los Angeles Football Club": "Los Angeles FC",
    "Inter Miami CF": "Inter Miami",
    "CF Montréal": "CF Montreal",
    "LA Galaxy": "Los Angeles Galaxy",
    "New York City Football Club": "New York City FC",
    "Seattle Sounders FC": "Seattle Sounders",
}

HOME_TIMEZONES = {
    "atlanta united": "America/New_York", "charlotte fc": "America/New_York",
    "fc cincinnati": "America/New_York", "columbus crew": "America/New_York",
    "dc united": "America/New_York", "inter miami": "America/New_York",
    "cf montreal": "America/Toronto", "new england revolution": "America/New_York",
    "new york red bulls": "America/New_York", "new york city fc": "America/New_York",
    "orlando city": "America/New_York", "philadelphia union": "America/New_York",
    "toronto fc": "America/Toronto", "nashville sc": "America/Chicago",
    "austin fc": "America/Chicago", "chicago fire": "America/Chicago",
    "fc dallas": "America/Chicago", "houston dynamo": "America/Chicago",
    "minnesota united fc": "America/Chicago", "sporting kansas city": "America/Chicago",
    "st louis city": "America/Chicago", "colorado rapids": "America/Denver",
    "real salt lake": "America/Denver", "los angeles fc": "America/Los_Angeles",
    "los angeles galaxy": "America/Los_Angeles", "portland timbers": "America/Los_Angeles",
    "san diego fc": "America/Los_Angeles", "san jose earthquakes": "America/Los_Angeles",
    "seattle sounders": "America/Los_Angeles", "vancouver whitecaps": "America/Vancouver",
}


def _iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _hash(value: object) -> str:
    return sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _team(value: str) -> str:
    return normalize_team(FIXTURE_ALIASES.get(value.strip(), value.strip()))


@dataclass(frozen=True)
class ScheduledFixture:
    source_row_id: str
    round_number: int
    kickoff_at_utc: str
    venue: str
    home_team: str
    away_team: str
    result: str

    @property
    def is_settled(self) -> bool:
        return bool(self.result and self.result.strip() not in {"-", ""})


def parse_fixture_schedule_csv(text: str) -> List[ScheduledFixture]:
    rows: List[ScheduledFixture] = []
    for index, raw in enumerate(csv.DictReader(io.StringIO(text)), start=1):
        dt = datetime.strptime(raw["Date"], "%d/%m/%Y %H:%M").replace(tzinfo=timezone.utc)
        rows.append(ScheduledFixture(
            source_row_id=str(raw.get("Match Number") or index),
            round_number=int(raw.get("Round Number") or raw.get("Round") or 0),
            kickoff_at_utc=dt.isoformat().replace("+00:00", "Z"),
            venue=str(raw.get("Location") or ""),
            home_team=_team(raw["Home Team"]),
            away_team=_team(raw["Away Team"]),
            result=str(raw.get("Result") or "").strip(),
        ))
    return rows


def fixture_local_date(fixture: ScheduledFixture) -> str:
    zone = HOME_TIMEZONES.get(fixture.home_team)
    if not zone:
        raise ValueError(f"HOME_TIMEZONE_NOT_REGISTERED:{fixture.home_team}")
    return _iso(fixture.kickoff_at_utc).astimezone(ZoneInfo(zone)).date().isoformat()


def fixture_match_id(fixture: ScheduledFixture, *, season: int = 2026) -> str:
    return canonical_match_id(OddsRecord(
        match_date=fixture_local_date(fixture), league="MLS", season=season,
        home_team=fixture.home_team, away_team=fixture.away_team,
    ))


def _parse_score(value: str) -> tuple[int, int] | None:
    if not value or value.strip() in {"", "-"}:
        return None
    parts = [part.strip() for part in value.split("-")]
    if len(parts) != 2 or not all(part.isdigit() for part in parts):
        return None
    return int(parts[0]), int(parts[1])


def settled_fixture_matches(fixtures: Iterable[ScheduledFixture], *, captured_at: str) -> List[Match]:
    cutoff = _iso(captured_at)
    out: List[Match] = []
    for fixture in fixtures:
        score = _parse_score(fixture.result)
        if score is None or _iso(fixture.kickoff_at_utc) >= cutoff:
            continue
        out.append(Match(
            date=fixture_local_date(fixture), season=2026, league="MLS",
            home=fixture.home_team, away=fixture.away_team,
            hg=score[0], ag=score[1], lineup_state="UNKNOWN",
        ))
    return out


def historical_input_matches(rows: Iterable[object]) -> List[Match]:
    out: List[Match] = []
    for row in rows:
        out.append(Match(
            date=str(row.match_date), season=int(row.season), league=str(row.league),
            home=normalize_team(row.home_team), away=normalize_team(row.away_team),
            hg=int(row.home_goals), ag=int(row.away_goals), lineup_state="UNKNOWN",
        ))
    return out


def _future_feature(history: Sequence[Match], fixture: ScheduledFixture):
    placeholder = Match(
        date=fixture_local_date(fixture), season=2026, league="MLS",
        home=fixture.home_team, away=fixture.away_team, hg=0, ag=0,
        lineup_state="UNKNOWN",
    )
    # Build every future fixture independently from the same settled history so
    # one future placeholder can never become history for another future match.
    return build_features([*history, placeholder])[-1]


def capture_prematch_snapshot(
    *, fixture: ScheduledFixture, history: Sequence[Match], captured_at: str,
    registered_at: str, challenger_model_version: str,
    challenger_specification_sha256: str, dispersion_r: float,
    fixture_source_sha256: str,
) -> Dict:
    capture_time = _iso(captured_at)
    kickoff = _iso(fixture.kickoff_at_utc)
    if capture_time <= _iso(registered_at):
        raise ValueError("CAPTURE_NOT_AFTER_CHALLENGER_PREREGISTRATION")
    if capture_time >= kickoff:
        raise ValueError("PREMATCH_CAPTURE_NOT_BEFORE_KICKOFF")
    if fixture.is_settled:
        raise ValueError("FUTURE_CAPTURE_FIXTURE_ALREADY_HAS_RESULT")

    row = _future_feature(history, fixture)
    if not row.warmup_pass or row.pre_lineup_lambda is None or row.model_u35_prob is None:
        raise ValueError("GATE2_MODEL_NOT_READY_FOR_FUTURE_FIXTURE")

    match_id = fixture_match_id(fixture)
    prediction_payload = {
        "snapshot_id": f"PRED-{match_id}-{capture_time.strftime('%Y%m%dT%H%M%SZ')}",
        "frozen_at": capture_time.isoformat().replace("+00:00", "Z"),
        "poisson_model_version": POISSON_MODEL_VERSION,
        "poisson_probability_u35": row.model_u35_prob,
        "negbin_model_version": challenger_model_version,
        "negbin_specification_sha256": challenger_specification_sha256,
        "negbin_probability_u35": negbin_u35(row.pre_lineup_lambda, dispersion_r),
        "pre_lineup_lambda": row.pre_lineup_lambda,
        "uses_market_odds": False,
        "history_rows_available": len(history),
        "home_prior_n": row.home_prior_n,
        "away_prior_n": row.away_prior_n,
    }
    prediction_payload["snapshot_sha256"] = _hash(prediction_payload)

    regime_payload = {
        "snapshot_id": f"REG-{match_id}-{capture_time.strftime('%Y%m%dT%H%M%SZ')}",
        "label": "MLS_2026_REGULAR_SEASON",
        "source": "MLS_OFFICIAL_2026_REGULAR_SEASON_SCHEDULE",
        "source_url": OFFICIAL_MLS_2026_SCHEDULE,
        "observed_at": capture_time.isoformat().replace("+00:00", "Z"),
        "verified": True,
        "uses_outcome": False,
        "uses_market_odds": False,
    }
    regime_payload["snapshot_sha256"] = _hash(regime_payload)

    record = {
        "capture_version": CAPTURE_VERSION,
        "state": "PREMATCH_FROZEN",
        "match_id": match_id,
        "competition": "MLS",
        "season": 2026,
        "kickoff_at": fixture.kickoff_at_utc,
        "fixture": {
            "source": "FixtureDownload",
            "source_url": FIXTUREDOWNLOAD_UTC_CSV,
            "source_row_id": fixture.source_row_id,
            "source_sha256": fixture_source_sha256,
            "venue": fixture.venue,
            "home_team": fixture.home_team,
            "away_team": fixture.away_team,
            "canonical_venue_local_date": fixture_local_date(fixture),
        },
        "prediction": prediction_payload,
        "regime": regime_payload,
        "market": None,
        "settlement": None,
        "test_b_eligible": False,
        "next_required_state": "CLOSING_MARKET_CAPTURED",
        "governance": {
            "prediction_frozen_before_kickoff": True,
            "future_fixture_not_added_to_other_fixture_history": True,
            "bookmaker_odds_used_by_model": False,
            "closing_market_not_fabricated": True,
            "settlement_not_available_pre_match": True,
            "capital_effect": "NONE",
            "real_money": "NO",
        },
    }
    record["record_sha256"] = _hash(record)
    return record


def capture_batch(
    *, fixtures: Sequence[ScheduledFixture], target_match_ids: Iterable[str],
    history: Sequence[Match], captured_at: str, registered_at: str,
    challenger_model_version: str, challenger_specification_sha256: str,
    dispersion_r: float, fixture_source_sha256: str,
) -> Dict:
    wanted = set(target_match_ids)
    by_id = {fixture_match_id(f): f for f in fixtures}
    missing = sorted(wanted - set(by_id))
    if missing:
        raise ValueError(f"TARGET_FIXTURES_NOT_FOUND:{','.join(missing)}")
    records = [capture_prematch_snapshot(
        fixture=by_id[mid], history=history, captured_at=captured_at,
        registered_at=registered_at, challenger_model_version=challenger_model_version,
        challenger_specification_sha256=challenger_specification_sha256,
        dispersion_r=dispersion_r, fixture_source_sha256=fixture_source_sha256,
    ) for mid in sorted(wanted)]
    return {
        "batch_version": CAPTURE_VERSION,
        "captured_at": captured_at,
        "records": records,
        "summary": {"prematch_frozen": len(records), "test_b_eligible": 0},
        "performance_metrics_exposed": False,
    }
