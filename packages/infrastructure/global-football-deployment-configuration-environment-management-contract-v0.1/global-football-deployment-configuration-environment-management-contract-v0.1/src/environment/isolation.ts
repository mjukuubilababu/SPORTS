import type{ConfigSnapshot,Environment}from"../domain/types.js";

export function secretReferenceViolations(snapshot:ConfigSnapshot):string[]{
  const bad:string[]=[];
  for(const e of snapshot.entries){
    const looksSecret=/password|secret|token|api[_-]?key/i.test(e.key);
    if(looksSecret&&e.secret_ref===null)bad.push(e.key);
  }
  return bad;
}

export function crossEnvironmentReferenceAllowed(from:Environment,to:Environment):boolean{
  if(from===to)return true;
  return false;
}
