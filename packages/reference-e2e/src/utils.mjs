import crypto from 'node:crypto';
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}
export function sha256(value) { return crypto.createHash('sha256').update(typeof value==='string'?value:stableStringify(value)).digest('hex'); }
export function id(prefix, parts) { return `${prefix}_${sha256(parts).slice(0,16)}`; }
export function deepFreeze(obj) {
  if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) return obj;
  Object.freeze(obj); for (const v of Object.values(obj)) deepFreeze(v); return obj;
}
export function nowIso(clock=()=>new Date()) { return clock().toISOString(); }
