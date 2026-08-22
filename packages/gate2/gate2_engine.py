
from __future__ import annotations
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import List, Optional, Dict, Tuple, Iterable
from collections import defaultdict, deque
import math

# Frozen from the existing Betting Intelligence model.
VENUE_WEIGHT = 0.50
LAST10_WEIGHT = 0.30
LAST5_WEIGHT = 0.20
WARMUP_MIN_PRIOR = 3

P002 = {
    "lambda_min": 2.70,
    "lambda_max": 3.10,
    "raw_edge_min_pp": 5.0,
    "lineup_adjustment": 0.10,  # frozen provisional rule; only applied when explicitly flagged
    "locked": True,
}

@dataclass
class Match:
    date: str
    season: int
    league: str
    home: str
    away: str
    hg: int
    ag: int
    o25: Optional[float] = None
    o35: Optional[float] = None
    u35: Optional[float] = None
    quote_verified: bool = False
    lineup_state: str = "UNKNOWN"  # PASS / FAIL / UNKNOWN
    attacking_upgrade: bool = False

@dataclass
class WindowStats:
    gf: Optional[float]
    ga: Optional[float]
    n: int

@dataclass
class FeatureRow:
    date: str
    home: str
    away: str
    home_prior_n: int
    away_prior_n: int
    warmup_pass: bool

    home_home: WindowStats
    away_away: WindowStats
    home_last10: WindowStats
    away_last10: WindowStats
    home_last5: WindowStats
    away_last5: WindowStats

    venue_home_lambda: Optional[float]
    venue_away_lambda: Optional[float]
    last10_home_lambda: Optional[float]
    last10_away_lambda: Optional[float]
    last5_home_lambda: Optional[float]
    last5_away_lambda: Optional[float]

    pre_lineup_lambda: Optional[float]
    post_lineup_lambda: Optional[float]
    lambda_gate: str

    model_u35_prob: Optional[float]
    market_u35_prob: Optional[float]
    raw_edge_pp: Optional[float]
    edge_gate: str
    lineup_gate: str
    final_model_gate: str

def parse_date(s: str) -> datetime:
    return datetime.fromisoformat(s[:10])

def avg(vals: List[float]) -> Optional[float]:
    return sum(vals)/len(vals) if vals else None

def stats_from(matches: List[Match], team: str, venue: Optional[str]=None, limit: Optional[int]=None) -> WindowStats:
    rows = []
    for m in matches:
        if venue == "home" and m.home == team:
            rows.append((m.hg, m.ag))
        elif venue == "away" and m.away == team:
            rows.append((m.ag, m.hg))
        elif venue is None:
            if m.home == team:
                rows.append((m.hg, m.ag))
            elif m.away == team:
                rows.append((m.ag, m.hg))
    if limit is not None:
        rows = rows[-limit:]
    if not rows:
        return WindowStats(None, None, 0)
    return WindowStats(avg([x[0] for x in rows]), avg([x[1] for x in rows]), len(rows))

def pair_expected(home_gf: Optional[float], away_ga: Optional[float],
                  away_gf: Optional[float], home_ga: Optional[float]) -> Tuple[Optional[float], Optional[float]]:
    if None in (home_gf, away_ga, away_gf, home_ga):
        return None, None
    eh = (home_gf + away_ga) / 2.0
    ea = (away_gf + home_ga) / 2.0
    return eh, ea

def poisson_u35(lmbda: float) -> float:
    # P(total <= 3)
    return sum(math.exp(-lmbda) * (lmbda ** k) / math.factorial(k) for k in range(4))

def devig_u35(o35: float, u35: float) -> float:
    if o35 <= 1 or u35 <= 1:
        raise ValueError("Decimal odds must be > 1")
    po = 1/o35
    pu = 1/u35
    return pu / (po + pu)

def build_features(matches: Iterable[Match]) -> List[FeatureRow]:
    matches = sorted(list(matches), key=lambda m: (parse_date(m.date), m.home, m.away))
    history: List[Match] = []
    out: List[FeatureRow] = []

    for m in matches:
        home_prior = [x for x in history if x.home == m.home or x.away == m.home]
        away_prior = [x for x in history if x.home == m.away or x.away == m.away]

        hh = stats_from(history, m.home, venue="home")
        aa = stats_from(history, m.away, venue="away")
        h10 = stats_from(history, m.home, limit=10)
        a10 = stats_from(history, m.away, limit=10)
        h5 = stats_from(history, m.home, limit=5)
        a5 = stats_from(history, m.away, limit=5)

        vh, va = pair_expected(hh.gf, aa.ga, aa.gf, hh.ga)
        l10h, l10a = pair_expected(h10.gf, a10.ga, a10.gf, h10.ga)
        l5h, l5a = pair_expected(h5.gf, a5.ga, a5.gf, h5.ga)

        warmup = len(home_prior) >= WARMUP_MIN_PRIOR and len(away_prior) >= WARMUP_MIN_PRIOR
        pre = None
        if warmup and None not in (vh, va, l10h, l10a, l5h, l5a):
            venue_total = vh + va
            l10_total = l10h + l10a
            l5_total = l5h + l5a
            pre = VENUE_WEIGHT*venue_total + LAST10_WEIGHT*l10_total + LAST5_WEIGHT*l5_total

        post = None
        if pre is not None:
            post = pre + (P002["lineup_adjustment"] if m.attacking_upgrade else 0.0)

        if post is None:
            lambda_gate = "PENDING"
        elif P002["lambda_min"] <= post <= P002["lambda_max"]:
            lambda_gate = "PASS"
        else:
            lambda_gate = "FAIL"

        modelp = poisson_u35(post) if post is not None else None
        marketp = None
        edge = None
        if m.o35 is not None and m.u35 is not None:
            marketp = devig_u35(m.o35, m.u35)
        if modelp is not None and marketp is not None:
            edge = (modelp - marketp) * 100.0

        if edge is None:
            edge_gate = "PENDING"
        elif edge >= P002["raw_edge_min_pp"]:
            edge_gate = "PASS"
        else:
            edge_gate = "FAIL"

        if m.lineup_state == "FAIL" or m.attacking_upgrade:
            lineup_gate = "FAIL"
        elif m.lineup_state == "PASS":
            lineup_gate = "PASS"
        else:
            lineup_gate = "PENDING"

        if "FAIL" in (lambda_gate, edge_gate, lineup_gate):
            final = "REJECT"
        elif all(x == "PASS" for x in (lambda_gate, edge_gate, lineup_gate)):
            final = "PASS"
        else:
            final = "PENDING"

        out.append(FeatureRow(
            date=m.date, home=m.home, away=m.away,
            home_prior_n=len(home_prior), away_prior_n=len(away_prior), warmup_pass=warmup,
            home_home=hh, away_away=aa, home_last10=h10, away_last10=a10,
            home_last5=h5, away_last5=a5,
            venue_home_lambda=vh, venue_away_lambda=va,
            last10_home_lambda=l10h, last10_away_lambda=l10a,
            last5_home_lambda=l5h, last5_away_lambda=l5a,
            pre_lineup_lambda=pre, post_lineup_lambda=post, lambda_gate=lambda_gate,
            model_u35_prob=modelp, market_u35_prob=marketp,
            raw_edge_pp=edge, edge_gate=edge_gate,
            lineup_gate=lineup_gate, final_model_gate=final
        ))

        # Critical: current match is appended only AFTER features are created.
        history.append(m)

    return out

def feature_row_to_dict(row: FeatureRow) -> Dict:
    d = asdict(row)
    return d
