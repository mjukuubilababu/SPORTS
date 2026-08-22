import type{BackpressureState}from"../domain/types.js";
export function classifyBackpressure(queue_name:string,observed_at:string,depth:number,oldest:number,processing:number,ingress:number):BackpressureState{
 let state:"NORMAL"|"PRESSURED"|"THROTTLED"|"PAUSED"="NORMAL";
 if(oldest>300||depth>10000)state="PAUSED";
 else if(oldest>120||depth>5000||ingress>processing*2)state="THROTTLED";
 else if(oldest>30||depth>1000||ingress>processing*1.2)state="PRESSURED";
 return{queue_name,observed_at,depth,oldest_message_age_seconds:oldest,processing_rate_per_second:processing,ingress_rate_per_second:ingress,state};
}
