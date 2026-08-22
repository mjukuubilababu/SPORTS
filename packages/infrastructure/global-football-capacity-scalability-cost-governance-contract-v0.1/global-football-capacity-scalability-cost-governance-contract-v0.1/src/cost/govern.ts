import type{CostBudget,CostDecision,CostObservation}from"../domain/types.js";
export function governCost(b:CostBudget,o:CostObservation):CostDecision{
 const hardUsable=Math.max(0,b.hard_limit-b.critical_reserve);
 if(o.spend_to_date>=b.hard_limit||o.forecast_period_end>=b.hard_limit)
  return{budget_id:b.budget_id,state:"FREEZE_EXPANSION",actions:["STOP_NONCRITICAL_TRAINING","STOP_BULK_REPLAY","REQUIRE_APPROVAL_FOR_SCALE_UP"],reason_codes:["HARD_BUDGET_RISK"]};
 if(o.spend_to_date>=hardUsable||o.forecast_period_end>=hardUsable)
  return{budget_id:b.budget_id,state:"THROTTLE_NONCRITICAL",actions:["THROTTLE_LOW_PRIORITY","DEFER_BATCH_EVALUATION"],reason_codes:["CRITICAL_RESERVE_PROTECTED"]};
 if(o.spend_to_date>=b.soft_limit||o.forecast_period_end>=b.soft_limit)
  return{budget_id:b.budget_id,state:"WATCH",actions:["REVIEW_COST_DRIVERS","TIGHTEN_IDLE_SCALE_IN"],reason_codes:["SOFT_BUDGET_RISK"]};
 return{budget_id:b.budget_id,state:"NORMAL",actions:[],reason_codes:[]};
}
export function unitCost(total:number,count:number):number|null{return count>0?total/count:null}
