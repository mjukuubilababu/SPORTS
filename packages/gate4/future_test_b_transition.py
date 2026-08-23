from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
from typing import Dict

from gate2_engine import devig_u35


TRANSITION_VERSION = "FUTURE_TEST_B_CAPTURE_TRANSITIONS_V0_1"


def _iso(value: str) -> datetime:
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _hash(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return sha256(payload.encode("utf-8")).hexdigest()


def attach_verified_closing_market(
    prematch: Dict,
    *,
    provider: str,
    source: str,
    source_url: str,
    observed_at: str,
    over35_odds: float,
    under35_odds: float,
    source_verified: bool,
    closing_semantics_verified: bool,
) -> Dict:
    if prematch.get("state") != "PREMATCH_FROZEN":
        raise ValueError("CLOSING_MARKET_REQUIRES_PREMATCH_FROZEN_STATE")
    kickoff = _iso(prematch["kickoff_at"])
    observed = _iso(observed_at)
    frozen = _iso(prematch["prediction"]["frozen_at"])
    if observed < frozen:
        raise ValueError("CLOSING_MARKET_PRECEDES_MODEL_FREEZE")
    if observed >= kickoff:
        raise ValueError("CLOSING_MARKET_NOT_PRE_KICKOFF")
    if source_verified is not True:
        raise ValueError("CLOSING_MARKET_SOURCE_NOT_VERIFIED")
    if closing_semantics_verified is not True:
        raise ValueError("CLOSING_MARKET_SEMANTICS_NOT_VERIFIED")
    if not provider or not source or not source_url:
        raise ValueError("CLOSING_MARKET_PROVENANCE_REQUIRED")

    fair = devig_u35(float(over35_odds), float(under35_odds))
    market = {
        "snapshot_id": f"MKT-{prematch['match_id']}-{observed.strftime('%Y%m%dT%H%M%SZ')}",
        "provider": provider,
        "source": source,
        "source_url": source_url,
        "observed_at": observed.isoformat().replace("+00:00", "Z"),
        "over35_odds": float(over35_odds),
        "under35_odds": float(under35_odds),
        "fair_probability_u35": fair,
        "source_verified": True,
        "closing_semantics_verified": True,
    }
    market["snapshot_sha256"] = _hash(market)

    out = deepcopy(prematch)
    parent_hash = out.get("record_sha256")
    out["transition_version"] = TRANSITION_VERSION
    out["parent_record_sha256"] = parent_hash
    out["state"] = "CLOSING_MARKET_CAPTURED"
    out["market"] = market
    out["settlement"] = None
    out["test_b_eligible"] = False
    out["next_required_state"] = "SETTLED_ELIGIBLE"
    out.pop("record_sha256", None)
    out["record_sha256"] = _hash(out)
    return out


def attach_verified_settlement(
    priced: Dict,
    *,
    source: str,
    source_url: str,
    verified: bool,
    settled_at: str,
    home_goals: int,
    away_goals: int,
) -> Dict:
    if priced.get("state") != "CLOSING_MARKET_CAPTURED":
        raise ValueError("SETTLEMENT_REQUIRES_CLOSING_MARKET_CAPTURED_STATE")
    kickoff = _iso(priced["kickoff_at"])
    settled = _iso(settled_at)
    if settled <= kickoff:
        raise ValueError("SETTLEMENT_NOT_POST_KICKOFF")
    if verified is not True:
        raise ValueError("SETTLEMENT_NOT_VERIFIED")
    if not source or not source_url:
        raise ValueError("SETTLEMENT_PROVENANCE_REQUIRED")
    if not isinstance(home_goals, int) or home_goals < 0:
        raise ValueError("HOME_GOALS_INVALID")
    if not isinstance(away_goals, int) or away_goals < 0:
        raise ValueError("AWAY_GOALS_INVALID")

    settlement = {
        "source": source,
        "source_url": source_url,
        "verified": True,
        "settled_at": settled.isoformat().replace("+00:00", "Z"),
        "home_goals": home_goals,
        "away_goals": away_goals,
    }
    settlement["snapshot_sha256"] = _hash(settlement)

    out = deepcopy(priced)
    parent_hash = out.get("record_sha256")
    out["transition_version"] = TRANSITION_VERSION
    out["parent_record_sha256"] = parent_hash
    out["state"] = "SETTLED_ELIGIBLE"
    out["settlement"] = settlement
    out["test_b_eligible"] = True
    out["next_required_state"] = "BLIND_ACCUMULATOR"
    out.pop("record_sha256", None)
    out["record_sha256"] = _hash(out)
    return out


def to_blind_candidate(record: Dict) -> Dict:
    if record.get("state") != "SETTLED_ELIGIBLE" or record.get("test_b_eligible") is not True:
        raise ValueError("BLIND_CANDIDATE_REQUIRES_SETTLED_ELIGIBLE_STATE")
    prediction = record["prediction"]
    market = record["market"]
    regime = record["regime"]
    settlement = record["settlement"]
    return {
        "match_id": record["match_id"],
        "competition": record["competition"],
        "kickoff_at": record["kickoff_at"],
        "prediction": {
            "snapshot_id": prediction["snapshot_id"],
            "snapshot_sha256": prediction["snapshot_sha256"],
            "frozen_at": prediction["frozen_at"],
            "poisson_model_version": prediction["poisson_model_version"],
            "poisson_probability_u35": prediction["poisson_probability_u35"],
            "negbin_model_version": prediction["negbin_model_version"],
            "negbin_specification_sha256": prediction["negbin_specification_sha256"],
            "negbin_probability_u35": prediction["negbin_probability_u35"],
            "uses_market_odds": prediction["uses_market_odds"],
        },
        "market": {
            "snapshot_id": market["snapshot_id"],
            "snapshot_sha256": market["snapshot_sha256"],
            "provider": market["provider"],
            "source": market["source"],
            "source_url": market["source_url"],
            "observed_at": market["observed_at"],
            "fair_probability_u35": market["fair_probability_u35"],
            "source_verified": market["source_verified"],
            "closing_semantics_verified": market["closing_semantics_verified"],
        },
        "regime": regime,
        "settlement": {
            "source": settlement["source"],
            "source_url": settlement["source_url"],
            "verified": settlement["verified"],
            "settled_at": settlement["settled_at"],
            "home_goals": settlement["home_goals"],
            "away_goals": settlement["away_goals"],
        },
    }
