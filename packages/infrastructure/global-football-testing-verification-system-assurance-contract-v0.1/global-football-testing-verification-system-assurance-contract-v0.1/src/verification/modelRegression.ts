import type{ModelRegressionCheck}from"../domain/types.js";
export function modelRegressionDecision(x:Omit<ModelRegressionCheck,"decision">):ModelRegressionCheck{
 let decision:"PASS"|"FAIL"|"REVIEW"="PASS";
 if(x.critical_slice_regression||x.brier_delta>.02||x.logloss_delta>.02||x.max_drawdown_delta>.10)decision="FAIL";
 else if(x.brier_delta>.005||x.logloss_delta>.005||x.ece_delta>.01||x.coverage_delta<-.05)decision="REVIEW";
 return{...x,decision};
}
