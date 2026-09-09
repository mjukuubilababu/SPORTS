import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { runProviderMatchEvidencePersistence } from '../src/postgres-provider-match-evidence-runtime.mjs';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export async function main(argv = process.argv.slice(2)) {
  const [inputFile, outputFile] = argv;
  if (!inputFile) throw new Error(
    'USAGE: node scripts/run-provider-match-evidence-persistence.mjs <runtime-envelope.json> [output.json]'
  );
  const envelope = readJson(inputFile);
  const result = await runProviderMatchEvidencePersistence({
    providerBatch: envelope.providerBatch,
    timingByEvent: envelope.timingByEvent,
    databaseUrl: process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL
  });
  const output = JSON.stringify(result, null, 2) + '\n';
  if (outputFile) {
    fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
    fs.writeFileSync(outputFile, output);
  } else {
    process.stdout.write(output);
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(JSON.stringify({
      status: 'FAILED_CLOSED',
      error: error?.message ?? 'POSTGRES_PROVIDER_MATCH_EVIDENCE_RUNTIME_FAILED',
      capitalState: 'LOCKED',
      realMoney: 'NO'
    }) + '\n');
    process.exitCode = 1;
  });
}
