import type{CapacityEnvelope,CapacityObservation,ScaleState}from"../domain/types.js";
export function capacityState(e:CapacityEnvelope,o:CapacityObservation):ScaleState{
 if(o.oldest_queue_age_seconds>e.max_queue_age_seconds*2||o.cpu_pct>=95||o.memory_pct>=95)return"SATURATED";
 if(o.oldest_queue_age_seconds>e.max_queue_age_seconds||o.cpu_pct>e.target_cpu_pct*1.1||o.memory_pct>e.target_memory_pct*1.1)return"PRESSURED";
 if(o.cpu_pct<e.target_cpu_pct*.4&&o.memory_pct<e.target_memory_pct*.4)return"UNDERUTILIZED";
 return"HEALTHY";
}
