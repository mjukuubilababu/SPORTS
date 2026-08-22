import type{Priority,WorkloadClass}from"../domain/types.js";
export function shouldShed(priority:Priority,workload:WorkloadClass,systemSaturated:boolean,protectedWorkloads:WorkloadClass[]):boolean{
 if(!systemSaturated)return false;
 if(protectedWorkloads.includes(workload))return false;
 return priority==="LOW"||priority==="NORMAL";
}
