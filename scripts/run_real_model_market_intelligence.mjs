import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processIndependentModelMarketBatch } from '../packages/intelligence-engine/src/independent-model-processing.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultMarket = path.resolve(__dirname, '../packages/intelligence-engine/data/real-market-batch-2026-08-23T001346+0300.json');
const defaultModel = path.resolve(__dirname, '../packages/intelligence-engine/data/independent-model-inputs-2026-08-23.json');

const marketPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultMarket;
const modelPath = process.argv[3] ? path.resolve(process.argv[3]) : defaultModel;
const outputPath = process.argv[4] ? path.resolve(process.argv[4]) : null;

const marketBatch = JSON.parse(fs.readFileSync(marketPath, 'utf8'));
const modelDataset = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
const report = processIndependentModelMarketBatch(marketBatch, modelDataset);
const serialized = `${JSON.stringify(report, null, 2)}\n`;

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, 'utf8');
}

process.stdout.write(serialized);
