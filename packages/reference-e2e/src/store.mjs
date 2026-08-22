import { ImmutableArtifactError } from './errors.mjs';
import { deepFreeze, sha256 } from './utils.mjs';
export class ArtifactStore {
  #items=new Map(); #effects=new Map();
  putImmutable(kind, artifact) {
    const key=`${kind}:${artifact.id}`;
    const hash=sha256(artifact);
    const existing=this.#items.get(key);
    if (existing) {
      if (existing.hash!==hash) throw new ImmutableArtifactError(kind,artifact.id);
      return existing.artifact;
    }
    const frozen=deepFreeze(structuredClone(artifact));
    this.#items.set(key,{artifact:frozen,hash}); return frozen;
  }
  get(kind,id){ return this.#items.get(`${kind}:${id}`)?.artifact; }
  all(kind){ return [...this.#items.entries()].filter(([k])=>k.startsWith(`${kind}:`)).map(([,v])=>v.artifact); }
  exactlyOnce(effectKey, fn){ if(this.#effects.has(effectKey)) return {duplicate:true,value:this.#effects.get(effectKey)}; const value=fn(); this.#effects.set(effectKey,value); return {duplicate:false,value}; }
  snapshotHashes(){ return [...this.#items.entries()].map(([key,v])=>({key,hash:v.hash})).sort((a,b)=>a.key.localeCompare(b.key)); }
}
