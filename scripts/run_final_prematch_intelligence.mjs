import fs from 'node:fs';
import path from 'node:path';
import { processFinalPrematchBatch } from '../packages/intelligence-engine/src/final-prematch-processing.mjs';

const [marketArg, modelArg, finalCaptureArg, outputArg] = process.argv.slice(2);
if (!marketArg || !modelArg || !finalCaptureArg) {
  process.stderr.write('Usage: node scripts/run_final_prematch_intelligence.mjs <real-market-batch.json> <model-dataset.json> <final-capture.json> [output.json]\n');
  process.exit(2);
}

const readJson = (file) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const marketBatch = readJson(marketArg);
const modelDataset = readJson(modelArg);
const finalCapture = readJson(finalCaptureArg);
const report = processFinalPrematchBatch(marketBatch, modelDataset, finalCapture);
const serialized = `${JSON.stringify(report, null, 2)}\n`;

if (outputArg) {
  const outputPath = path.resolve(outputArg);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, 'utf8');
}

process.stdout.write(serialized);
