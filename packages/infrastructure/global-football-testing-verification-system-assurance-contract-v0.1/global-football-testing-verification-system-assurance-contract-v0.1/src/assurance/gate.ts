import type{AssuranceGateInput,AssuranceGateResult}from"../domain/types.js";
export function evaluateAssuranceGate(i:AssuranceGateInput,now:string):AssuranceGateResult{
 const r:string[]=[];
 if(i.results.some(x=>x.critical&&x.status!=="PASS"))r.push("CRITICAL_TEST_NOT_PASSING");
 if(i.results.some(x=>x.status==="FAIL"&&x.layer==="CONTRACT"))r.push("CONTRACT_FAILURE");
 if(i.unresolved_security_failures>0)r.push("UNRESOLVED_SECURITY_FAILURE");
 if(i.critical_data_quality_failures>0)r.push("CRITICAL_DATA_QUALITY_FAILURE");
 if(i.coverage.critical_invariant_covered<i.coverage.critical_invariant_total)r.push("CRITICAL_INVARIANT_COVERAGE_INCOMPLETE");
 if(i.coverage.contract_verified<i.coverage.contract_total)r.push("CONTRACT_VERIFICATION_INCOMPLETE");
 if(!i.replay_verified)r.push("REPLAY_NOT_VERIFIED");
 if(!i.load_verified)r.push("LOAD_NOT_VERIFIED");
 if(!i.chaos_verified)r.push("CHAOS_NOT_VERIFIED");
 if(i.model_regression?.decision==="FAIL")r.push("MODEL_REGRESSION_FAILED");
 const review=i.model_regression?.decision==="REVIEW";
 return{release_id:i.release_id,decision:r.length?"BLOCK":review?"REVIEW":"PROMOTE",reason_codes:r.length?r:review?["MODEL_REGRESSION_REVIEW_REQUIRED"]:[],evaluated_at:now,immutable:true};
}
