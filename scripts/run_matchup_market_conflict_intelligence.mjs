import fs from 'node:fs';
import { assessMatchupMarketConflict } from '../packages/intelligence-engine/src/matchup-market-conflict-intelligence.mjs';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath) {
  console.error('Usage: node scripts/run_matchup_market_conflict_intelligence.mjs <input.json> [output.json]');
  process.exit(2);
}

const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const output = assessMatchupMarketConflict(input);
const rendered = `${JSON.stringify(output, null, 2)}\n`;
if (outputPath) fs.writeFileSync(outputPath, rendered);
else process.stdout.write(rendered);
