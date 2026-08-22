export class EvidenceGraph {
  constructor(){ this.nodes = new Map(); }
  add(node){
    if (!node.id) throw new Error('EVIDENCE_ID_REQUIRED');
    if (this.nodes.has(node.id)) throw new Error('DUPLICATE_EVIDENCE_ID');
    this.nodes.set(node.id, Object.freeze({...node}));
  }
  get(id){ return this.nodes.get(id) ?? null; }
  decisionEligible(id){
    const n=this.get(id);
    return Boolean(n && n.verified && n.decisionWeight !== 'ZERO' && n.decisionWeight !== 0);
  }
  unresolvedCritical(){ return [...this.nodes.values()].filter(n => n.critical && !n.verified); }
  snapshot(){ return [...this.nodes.values()].map(x => ({...x})); }
}
