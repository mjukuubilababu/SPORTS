import type{ReplayVerification}from"../domain/types.js";
export function verifyReplay(r:ReplayVerification):{pass:boolean;reason:string}{
 if(r.expected_hash===r.actual_hash&&r.differences.length===0&&r.equivalent)return{pass:true,reason:"EXACT_REPRODUCTION"};
 if(r.equivalent&&r.differences.length===0)return{pass:true,reason:"SEMANTIC_EQUIVALENCE"};
 return{pass:false,reason:"REPLAY_DIVERGENCE"};
}
