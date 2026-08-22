import type{MigrationBundle}from"../domain/types.js";

export function validateMigrationBundle(b:MigrationBundle):string[]{
  const reasons:string[]=[];
  const orders=b.steps.map(s=>s.order);
  const sorted=[...orders].sort((a,b)=>a-b);
  if(JSON.stringify(orders)!==JSON.stringify(sorted))reasons.push("MIGRATIONS_NOT_ORDERED");
  if(new Set(orders).size!==orders.length)reasons.push("DUPLICATE_MIGRATION_ORDER");
  if(b.steps.some(s=>s.destructive&&!s.requires_backup))reasons.push("DESTRUCTIVE_MIGRATION_WITHOUT_BACKUP");
  return reasons;
}

export function productionMigrationAllowed(b:MigrationBundle,backupAvailable:boolean):boolean{
  const invalid=validateMigrationBundle(b).length>0;
  if(invalid)return false;
  if(b.steps.some(s=>s.destructive)&&!backupAvailable)return false;
  return true;
}
