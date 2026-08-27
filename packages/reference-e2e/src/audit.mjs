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
  hydrate(events) {
    if(this.#events.length!==0) throw new Error('AUDIT_HYDRATE_REQUIRES_EMPTY_LOG');
    if(!Array.isArray(events)) throw new Error('AUDIT_HYDRATE_EVENTS_REQUIRED');
    let previousHash='GENESIS';
    for(let sequence=0;sequence<events.length;sequence+=1){
      const candidate=structuredClone(events[sequence]);
      const {eventHash,...base}=candidate;
      if(candidate.sequence!==sequence || candidate.previousHash!==previousHash || sha256(base)!==eventHash){
        throw new Error(`AUDIT_HYDRATE_CHAIN_INVALID:${sequence}`);
      }
      const event=deepFreeze(candidate);
      this.#events.push(event);
      previousHash=event.eventHash;
    }
    return this;
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
