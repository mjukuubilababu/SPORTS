import fs from 'node:fs';
import path from 'node:path';
const required=[
  'src/orchestrator.mjs','src/qualification-scanner.mjs','src/contracts.mjs','src/features.mjs','src/model.mjs','src/pattern.mjs','src/decision.mjs','src/risk.mjs','src/execution.mjs','src/settlement.mjs','src/evaluation.mjs','src/security.mjs','src/assurance.mjs','migrations/0001_reference_e2e.sql','fixtures/controlled-match.json'
];
for(const f of required){ if(!fs.existsSync(path.resolve(f))) throw new Error(`MISSING_FILE:${f}`); }
console.log(`CHECK_PASS files=${required.length}`);
