import type{LoadTestResult}from"../domain/types.js";
export function loadPass(r:LoadTestResult,limits:{p95:number;p99:number;error:number;queueAge:number}):boolean{
 return r.p95_latency_ms<=limits.p95&&r.p99_latency_ms<=limits.p99&&r.error_rate<=limits.error&&r.max_queue_age_seconds<=limits.queueAge&&r.autoscaling_worked&&r.load_shedding_worked;
}
