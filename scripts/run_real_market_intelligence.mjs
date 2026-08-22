import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processObservedMarketBatch } from '../packages/intelligence-engine/src/real-market-processing.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultInput = path.resolve(
  __dirname,
  '../packages/intelligence-engine/data/real-market-batch-2026-08-23T001346+0300.json'
);

const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultInput;
const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : null;

const batch = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const report = processObservedMarketBatch(batch);
const serialized = `${JSON.stringify(report, null, 2)}\n`;

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, 'utf8');
}

process.stdout.write(serialized);
