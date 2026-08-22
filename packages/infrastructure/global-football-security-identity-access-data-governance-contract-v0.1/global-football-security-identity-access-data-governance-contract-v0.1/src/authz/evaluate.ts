import type{AccessDecision,AccessRequest,Permission}from"../domain/types.js";

function matches(pattern:string,resource:string):boolean{
  if(pattern==="*")return true;
  if(pattern.endsWith("*"))return resource.startsWith(pattern.slice(0,-1));
  return pattern===resource;
}

export function evaluateAccess(req:AccessRequest,permissions:Permission[]):AccessDecision{
  const reasons:string[]=[];
  if(!req.identity.active) reasons.push("IDENTITY_INACTIVE");
  if(req.identity.expires_at&&Date.parse(req.identity.expires_at)<=Date.parse(req.requested_at)) reasons.push("IDENTITY_EXPIRED");
  if(!req.identity.environment_scope.includes(req.environment)) reasons.push("ENVIRONMENT_OUT_OF_SCOPE");

  const matched=permissions.filter(p=>
    req.identity.roles.includes(p.role)&&
    matches(p.resource_pattern,req.resource)&&
    p.actions.includes(req.action)&&
    p.environments.includes(req.environment)&&
    p.data_classes.includes(req.data_class)
  );

  if(!matched.length)reasons.push("NO_MATCHING_PERMISSION");

  const privileged=["PROMOTE","OVERRIDE","MANAGE_POLICY","MANAGE_IDENTITY","ROTATE_SECRET"].includes(req.action);
  const requiresSecondary=req.environment==="PRODUCTION"&&privileged;

  if(req.break_glass){
    if(req.environment!=="PRODUCTION")reasons.push("BREAK_GLASS_PRODUCTION_ONLY");
    if(!req.reason.trim())reasons.push("BREAK_GLASS_REASON_REQUIRED");
  }

  return{
    request_id:req.request_id,
    allowed:reasons.length===0&&matched.length>0,
    matched_permissions:matched.map(x=>x.permission_id),
    reason_codes:reasons,
    requires_secondary_approval:requiresSecondary
  };
}
