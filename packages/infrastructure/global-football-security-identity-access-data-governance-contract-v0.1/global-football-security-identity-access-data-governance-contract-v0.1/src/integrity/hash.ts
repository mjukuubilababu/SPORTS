export function stableStringify(value:unknown):string{
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return "["+value.map(stableStringify).join(",")+"]";
  const o=value as Record<string,unknown>;
  return "{"+Object.keys(o).sort().map(k=>JSON.stringify(k)+":"+stableStringify(o[k])).join(",")+"}";
}
export function fnv1a32(value:unknown):string{
  const s=stableStringify(value);let h=2166136261;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
  return "fnv1a32:"+((h>>>0).toString(16).padStart(8,"0"));
}
export function verifyContentHash(value:unknown,expected:string):boolean{
  return fnv1a32(value)===expected;
}
