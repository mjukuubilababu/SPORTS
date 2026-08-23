import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processRealFootballFeatureBatch } from '../packages/intelligence-engine/src/real-football-feature-ingestion.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultInput = path.resolve(here, '../packages/intelligence-engine/data/real-football-features-epl-2025-26-to-2026-08-23.json');
const inputPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : defaultInput;
const outputPath = process.argv[3] ? path.resolve(process.cwd(), process.argv[3]) : null;

const dataset = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const report = processRealFootballFeatureBatch(dataset, { asOf: dataset.capturedAt });
const serialized = `${JSON.stringify(report, null, 2)}\n`;

if (outputPath) {
  fs.writeFileSync(outputPath, serialized);
  console.log(`Wrote ${outputPath}`);
} else {
  process.stdout.write(serialized);
}
