import { AuthorizationError } from './errors.mjs';
const PERMISSIONS = Object.freeze({
  'svc.ingestion': new Set(['event:ingest']),
  'svc.pipeline': new Set(['feature:write','model:infer','pattern:evaluate','decision:evaluate','risk:evaluate','paper:execute','settlement:write','evaluation:write','assurance:run']),
  'human.reviewer': new Set(['audit:read','assurance:read']),
});
export function authorize(identity, action) {
  const allowed = PERMISSIONS[identity]?.has(action) ?? false;
  if (!allowed) throw new AuthorizationError(`DENY:${identity}:${action}`);
  return { identity, action, allowed:true };
}
