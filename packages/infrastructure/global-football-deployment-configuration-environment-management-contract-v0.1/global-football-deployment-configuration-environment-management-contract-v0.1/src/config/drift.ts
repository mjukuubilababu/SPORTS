import type{ConfigSnapshot}from"../domain/types.js";

function stable(entries:ConfigSnapshot["entries"]):string{
  return JSON.stringify([...entries].sort((a,b)=>a.key.localeCompare(b.key)));
}
export function configDrift(expected:ConfigSnapshot,actual:ConfigSnapshot):{drift:boolean;reason:string}{
  if(expected.schema_version!==actual.schema_version)return{drift:true,reason:"CONFIG_SCHEMA_VERSION_MISMATCH"};
  if(stable(expected.entries)!==stable(actual.entries))return{drift:true,reason:"CONFIG_CONTENT_MISMATCH"};
  return{drift:false,reason:"NONE"};
}
