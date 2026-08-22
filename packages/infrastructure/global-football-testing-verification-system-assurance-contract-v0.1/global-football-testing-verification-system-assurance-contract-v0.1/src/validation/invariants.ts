import type{CoverageSnapshot,TestCase,TestResult}from"../domain/types.js";
export type Issue={code:string;message:string};
export function validateTestCase(t:TestCase):Issue[]{const x:Issue[]=[];
 if(!t.requirement_refs.length&&!t.invariant_refs.length)x.push({code:"UNTRACEABLE_TEST",message:"test must trace to requirement or invariant"});
 if(!t.owner)x.push({code:"OWNER_REQUIRED",message:"test owner required"});return x}
export function validateResult(r:TestResult):Issue[]{const x:Issue[]=[];
 if(Date.parse(r.completed_at)<Date.parse(r.started_at))x.push({code:"BAD_TEST_TIME",message:"test completed before start"});
 if(r.status==="FAIL"&&!r.failure_code)x.push({code:"FAILURE_CODE_REQUIRED",message:"failed test requires failure code"});
 if(r.immutable!==true)x.push({code:"MUTABLE_TEST_RESULT",message:"test result immutable"});return x}
export function coverageRatios(c:CoverageSnapshot){return{
 requirements:c.requirement_total?c.requirement_covered/c.requirement_total:1,
 criticalInvariants:c.critical_invariant_total?c.critical_invariant_covered/c.critical_invariant_total:1,
 contracts:c.contract_total?c.contract_verified/c.contract_total:1
}}
