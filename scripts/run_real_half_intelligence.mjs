import fs from 'node:fs';
import path from 'node:path';
import { processRealHalfProfileReport } from '../packages/intelligence-engine/src/real-half-profile-processing.mjs';

const [modelMarketArg, halfProfileArg, outputArg] = process.argv.slice(2);
if (!modelMarketArg || !halfProfileArg) {
  throw new Error('USAGE: node scripts/run_real_half_intelligence.mjs <model-market-report> <half-profile-dataset> [output]');
}

const modelMarketPath = path.resolve(modelMarketArg);
const halfProfilePath = path.resolve(halfProfileArg);
const outputPath = outputArg ? path.resolve(outputArg) : null;

const modelMarketReport = JSON.parse(fs.readFileSync(modelMarketPath, 'utf8'));
const halfProfileDataset = JSON.parse(fs.readFileSync(halfProfilePath, 'utf8'));
const report = processRealHalfProfileReport(modelMarketReport, halfProfileDataset);
const serialized = `${JSON.stringify(report, null, 2)}\n`;

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, 'utf8');
}

process.stdout.write(serialized);
