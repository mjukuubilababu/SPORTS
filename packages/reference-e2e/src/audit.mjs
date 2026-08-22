import { deepFreeze, id, nowIso, sha256 } from './utils.mjs';
export class AuditLog {
  #events=[];
  append({correlationId, causationId=null, actor, action, artifactType, artifactId, payload={}, clock}) {
    const previousHash=this.#events.at(-1)?.eventHash ?? 'GENESIS';
    const base={
      auditId:id('audit',[correlationId,actor,action,artifactId,this.#events.length]),
      correlationId,causationId,actor,action,artifactType,artifactId,payload,
      occurredAt:nowIso(clock),sequence:this.#events.length,previousHash
    };
    const event=deepFreeze({...base,eventHash:sha256(base)});
    this.#events.push(event); return event;
  }
  list(){ return [...this.#events]; }
  verifyChain(){
    let prev='GENESIS';
    for (const e of this.#events) {
      const {eventHash,...base}=e;
      if (e.previousHash!==prev || sha256(base)!==eventHash) return false;
      prev=eventHash;
    }
    return true;
  }
}
