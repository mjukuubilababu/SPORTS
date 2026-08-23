import fs from 'node:fs/promises';
import { processRealHalfMarketPricing } from '../packages/intelligence-engine/src/real-half-market-pricing.mjs';

const [modelPath, profilePath, capturePath, outputPath] = process.argv.slice(2);
if (!modelPath || !profilePath || !capturePath) {
  throw new Error('USAGE: node scripts/run_real_half_market_pricing.mjs <model-report> <half-profile> <market-capture> [output]');
}
const [modelReport, halfProfiles, capture] = await Promise.all([
  fs.readFile(modelPath, 'utf8').then(JSON.parse),
  fs.readFile(profilePath, 'utf8').then(JSON.parse),
  fs.readFile(capturePath, 'utf8').then(JSON.parse)
]);
const report = processRealHalfMarketPricing(modelReport, halfProfiles, capture);
const json = JSON.stringify(report, null, 2);
if (outputPath) await fs.writeFile(outputPath, `${json}\n`, 'utf8');
console.log(json);
