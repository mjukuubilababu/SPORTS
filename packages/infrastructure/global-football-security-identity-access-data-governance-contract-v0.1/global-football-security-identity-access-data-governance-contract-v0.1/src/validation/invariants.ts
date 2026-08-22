import type{AccessRequest,DataGovernanceRecord,SignedArtifact,SecretReference,SecurityAuditEvent}from"../domain/types.js";
export type Issue={code:string;message:string};

export function validateAccessRequest(r:AccessRequest):Issue[]{const x:Issue[]=[];
 if(!r.reason.trim())x.push({code:"REASON_REQUIRED",message:"access request reason required"});
 if(Date.parse(r.requested_at).toString()==="NaN")x.push({code:"BAD_TIMESTAMP",message:"invalid requested_at"});
 return x}

export function validateArtifact(a:SignedArtifact):Issue[]{const x:Issue[]=[];
 if(!a.content_hash)x.push({code:"HASH_REQUIRED",message:"content hash required"});
 if(!a.signature)x.push({code:"SIGNATURE_REQUIRED",message:"signature required"});
 if(!a.key_id)x.push({code:"KEY_ID_REQUIRED",message:"key id required"});
 if(a.immutable!==true)x.push({code:"MUTABLE_ARTIFACT",message:"artifact must be immutable"});
 return x}

export function validateGovernance(g:DataGovernanceRecord):Issue[]{const x:Issue[]=[];
 if(g.retention_days!==null&&g.retention_days<=0)x.push({code:"BAD_RETENTION",message:"retention_days must be positive or null"});
 if(!g.purpose.trim())x.push({code:"PURPOSE_REQUIRED",message:"dataset purpose required"});
 return x}

export function validateSecret(s:SecretReference):Issue[]{return s.never_log===true?[]:[{code:"SECRET_LOGGING_RISK",message:"secrets must be marked never_log"}]}
export function validateAudit(e:SecurityAuditEvent):Issue[]{return e.immutable===true?[]:[{code:"MUTABLE_AUDIT",message:"audit event must be immutable"}]}
