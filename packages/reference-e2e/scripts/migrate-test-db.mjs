import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
const dbPath=path.resolve('artifacts/reference-test.sqlite');
try{fs.unlinkSync(dbPath)}catch{}
const db=new DatabaseSync(dbPath);
const sql=fs.readFileSync(path.resolve('migrations/0001_reference_e2e.sql'),'utf8');
db.exec(sql);
db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run('0001_reference_e2e',new Date().toISOString());
const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name);
if(!['artifacts','assurance_runs','audit_events','paper_executions','schema_migrations','settlements'].every(n=>names.includes(n))) throw new Error('MIGRATION_TABLE_MISSING');
console.log(`MIGRATION_PASS db=${dbPath} tables=${names.join(',')}`);
db.close();
