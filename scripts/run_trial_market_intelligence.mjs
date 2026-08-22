import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processTrialBatch } from '../packages/intelligence-engine/src/trial-processing.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultInput = path.resolve(__dirname, '../packages/intelligence-engine/data/trial-market-batch-v0.1.json');

const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultInput;
const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : null;

const batch = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const report = processTrialBatch(batch);
const serialized = `${JSON.stringify(report, null, 2)}\n`;

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, 'utf8');
}

process.stdout.write(serialized);
