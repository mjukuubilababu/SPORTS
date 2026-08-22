import type{HealthMetric,SLODefinition}from"../domain/types.js";
export function sloBurnRate(slo:SLODefinition,good:number,total:number):number{
 if(total<=0)return 0;const observedBad=1-good/total;const allowedBad=Math.max(1e-9,1-slo.target);return observedBad/allowedBad;
}
export function metricSeverity(value:number,warn:number,critical:number):"INFO"|"WARN"|"CRITICAL"{
 if(value>=critical)return"CRITICAL";if(value>=warn)return"WARN";return"INFO";
}
export function health(metric:string,value:number,unit:string,observed_at:string,stage=null as any):HealthMetric{
 return{metric,stage,observed_at,value,unit,severity:"INFO"};
}
