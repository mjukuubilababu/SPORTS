import type{StageRun,SystemEvent,TraceSpan}from"../domain/types.js";
export type Issue={code:string;message:string};

export function validateEvent(e:SystemEvent):Issue[]{const x:Issue[]=[];
 if(!e.idempotency_key)x.push({code:"MISSING_IDEMPOTENCY_KEY",message:"idempotency key required"});
 if(!e.correlation_id)x.push({code:"MISSING_CORRELATION_ID",message:"correlation id required"});
 if(Date.parse(e.observed_at)>Date.parse(e.occurred_at))x.push({code:"TEMPORAL_ORDER",message:"observed_at cannot follow occurred_at"});
 if(e.attempt<0)x.push({code:"NEGATIVE_ATTEMPT",message:"attempt must be >=0"});return x}
export function validateStageRun(r:StageRun):Issue[]{const x:Issue[]=[];
 if(r.status==="SUCCEEDED"&&!r.output_hash)x.push({code:"MISSING_OUTPUT_HASH",message:"successful run requires output hash"});
 if(r.completed_at&&Date.parse(r.completed_at)<Date.parse(r.started_at))x.push({code:"BAD_STAGE_TIME",message:"completed before started"});
 if(r.immutable!==true)x.push({code:"MUTABLE_RUN",message:"stage run immutable"});return x}
export function validateSpan(s:TraceSpan):Issue[]{return s.ended_at&&Date.parse(s.ended_at)<Date.parse(s.started_at)?[{code:"BAD_SPAN_TIME",message:"span ended before start"}]:[]}
