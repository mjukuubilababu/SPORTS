import type{CapacityEnvelope,CapacityObservation,ScalingDecision}from"../domain/types.js";

export function autoscale(e:CapacityEnvelope,o:CapacityObservation,now:string):ScalingDecision{
 const reasons:string[]=[];
 const cpuPressure=o.cpu_pct>e.target_cpu_pct*1.15;
 const memPressure=o.memory_pct>e.target_memory_pct*1.15;
 const queuePressure=o.oldest_queue_age_seconds>e.max_queue_age_seconds;
 const rpsNeeded=Math.ceil(o.rps/Math.max(1,e.max_rps_per_replica)*(1+e.headroom_pct/100));
 let desired=Math.max(e.min_replicas,Math.min(e.max_replicas,Math.max(o.replicas,rpsNeeded)));
 if(cpuPressure||memPressure||queuePressure){
   reasons.push(...(cpuPressure?["CPU_PRESSURE"]:[]),...(memPressure?["MEMORY_PRESSURE"]:[]),...(queuePressure?["QUEUE_AGE_PRESSURE"]:[]));
   desired=Math.min(e.max_replicas,Math.max(desired,o.replicas+1));
 }
 if(desired===e.max_replicas&&(cpuPressure||memPressure||queuePressure)&&o.error_rate>.03)
   return{service_id:e.service_id,decided_at:now,current_replicas:o.replicas,desired_replicas:desired,action:"SHED_LOAD",reason_codes:[...reasons,"MAX_CAPACITY_ERROR_PRESSURE"],cooldown_seconds:30};
 if(desired>o.replicas)return{service_id:e.service_id,decided_at:now,current_replicas:o.replicas,desired_replicas:desired,action:"SCALE_OUT",reason_codes:reasons.length?reasons:["RPS_FORECAST"],cooldown_seconds:60};
 const low=o.cpu_pct<e.target_cpu_pct*.45&&o.memory_pct<e.target_memory_pct*.55&&o.oldest_queue_age_seconds<e.max_queue_age_seconds*.25;
 if(low&&o.replicas>e.min_replicas)return{service_id:e.service_id,decided_at:now,current_replicas:o.replicas,desired_replicas:o.replicas-1,action:"SCALE_IN",reason_codes:["SUSTAINED_LOW_UTILIZATION"],cooldown_seconds:300};
 return{service_id:e.service_id,decided_at:now,current_replicas:o.replicas,desired_replicas:o.replicas,action:"HOLD",reason_codes:["WITHIN_CAPACITY_ENVELOPE"],cooldown_seconds:60};
}
