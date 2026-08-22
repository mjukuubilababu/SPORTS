
from dataclasses import dataclass, asdict
from typing import Optional, List, Dict
from datetime import datetime
import hashlib, json, math

@dataclass(frozen=True)
class FrozenSignal:
    signal_id:str
    match_id:str
    pattern_id:str
    created_at:str
    kickoff_at:str
    selection:str
    model_prob:float
    market_prob:float
    reference_odds:float
    lambda_total:float
    raw_edge_pp:float
    lineup_gate:str
    quote_source:str
    quote_type:str
    rule_version:str
    payload_hash:str

@dataclass
class ExecutionRecord:
    signal_id:str
    observed_at:str
    paper_entry_odds:Optional[float]
    closing_odds:Optional[float]
    result:Optional[int]
    settlement_odds:Optional[float]=None
    quote_age_seconds:Optional[int]=None
    slippage_pct:Optional[float]=None
    clv_pct:Optional[float]=None
    status:str="OPEN"

def _iso(s): return datetime.fromisoformat(s.replace("Z","+00:00"))

def freeze_signal(payload:Dict)->FrozenSignal:
    required=["match_id","pattern_id","created_at","kickoff_at","selection","model_prob",
              "market_prob","reference_odds","lambda_total","raw_edge_pp","lineup_gate",
              "quote_source","quote_type","rule_version"]
    missing=[k for k in required if k not in payload]
    if missing: raise ValueError("Missing: "+",".join(missing))
    if _iso(payload["created_at"]) >= _iso(payload["kickoff_at"]):
        raise ValueError("Signal must be frozen before kickoff")
    canonical=json.dumps({k:payload[k] for k in required},sort_keys=True,separators=(",",":"))
    h=hashlib.sha256(canonical.encode()).hexdigest()
    sid=f'{payload["pattern_id"]}-{payload["match_id"]}-{h[:10]}'
    return FrozenSignal(signal_id=sid,payload_hash=h,**{k:payload[k] for k in required})

def verify_immutable(signal:FrozenSignal)->bool:
    d=asdict(signal)
    required=["match_id","pattern_id","created_at","kickoff_at","selection","model_prob",
              "market_prob","reference_odds","lambda_total","raw_edge_pp","lineup_gate",
              "quote_source","quote_type","rule_version"]
    canonical=json.dumps({k:d[k] for k in required},sort_keys=True,separators=(",",":"))
    return hashlib.sha256(canonical.encode()).hexdigest()==signal.payload_hash

def paper_execute(signal:FrozenSignal, observed_at:str, executable_odds:float,
                  max_quote_age_seconds:int=300)->ExecutionRecord:
    if not verify_immutable(signal): raise ValueError("Signal integrity failure")
    obs=_iso(observed_at); created=_iso(signal.created_at); kickoff=_iso(signal.kickoff_at)
    if obs >= kickoff: raise ValueError("Execution observation at/after kickoff")
    age=max(0,int((obs-created).total_seconds()))
    slip=(executable_odds/signal.reference_odds-1)*100
    status="PAPER_EXECUTED" if age<=max_quote_age_seconds else "STALE_QUOTE"
    return ExecutionRecord(signal.signal_id,observed_at,executable_odds,None,None,
                           quote_age_seconds=age,slippage_pct=slip,status=status)

def attach_close(rec:ExecutionRecord, closing_odds:float)->ExecutionRecord:
    rec.closing_odds=closing_odds
    if rec.paper_entry_odds:
        rec.clv_pct=(rec.paper_entry_odds/closing_odds-1)*100
    return rec

def settle(rec:ExecutionRecord, result:int)->ExecutionRecord:
    if result not in (0,1): raise ValueError("result must be 0/1")
    rec.result=result
    rec.settlement_odds=rec.paper_entry_odds
    rec.status="WIN" if result else "LOSS"
    return rec

def batch_report(records:List[ExecutionRecord])->Dict:
    settled=[r for r in records if r.result in (0,1) and r.paper_entry_odds]
    clv=[r.clv_pct for r in settled if r.clv_pct is not None]
    stale=sum(r.status=="STALE_QUOTE" for r in records)
    profit=sum((r.paper_entry_odds-1) if r.result==1 else -1 for r in settled)
    return {
      "n_records":len(records),"n_settled":len(settled),
      "hit_rate":sum(r.result for r in settled)/len(settled) if settled else None,
      "roi":profit/len(settled) if settled else None,
      "mean_clv_pct":sum(clv)/len(clv) if clv else None,
      "positive_clv_rate":sum(x>0 for x in clv)/len(clv) if clv else None,
      "stale_quote_rate":stale/len(records) if records else None,
      "mean_slippage_pct":sum(r.slippage_pct for r in records if r.slippage_pct is not None)/
          len([r for r in records if r.slippage_pct is not None]) if any(r.slippage_pct is not None for r in records) else None
    }

def drift_check(reference:Dict,current:Dict,limits:Optional[Dict]=None)->Dict:
    limits=limits or {"model_prob_mean":0.05,"market_prob_mean":0.05,"lambda_mean":0.20,"qualifier_rate":0.10}
    changes={}; alerts=[]
    for k,lim in limits.items():
        if k in reference and k in current and reference[k] is not None and current[k] is not None:
            delta=current[k]-reference[k]
            changes[k]=delta
            if abs(delta)>lim: alerts.append(f"{k} drift {delta:+.4f} > {lim}")
    return {"pass":not alerts,"changes":changes,"alerts":alerts}

def forward_promotion_gate(report:Dict, drift:Dict, min_settled:int=30)->Dict:
    checks={
      "n":report.get("n_settled",0)>=min_settled,
      "positive_roi":report.get("roi") is not None and report["roi"]>0,
      "positive_clv":report.get("mean_clv_pct") is not None and report["mean_clv_pct"]>0,
      "quote_integrity":report.get("stale_quote_rate") is not None and report["stale_quote_rate"]<=0.05,
      "drift":drift.get("pass") is True
    }
    return {"pass":all(checks.values()),"checks":checks}
