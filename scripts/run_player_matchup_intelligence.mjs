import fs from 'node:fs';
import path from 'node:path';
import { buildConfirmedLineupPlayerIntelligence, toRealFootballPlayerEvidence } from '../packages/intelligence-engine/src/player-matchup-intelligence.mjs';

const inputPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : null;
const outputPath = process.argv[3] ? path.resolve(process.cwd(), process.argv[3]) : null;

if (!inputPath) {
  console.error('Usage: node scripts/run_player_matchup_intelligence.mjs <confirmed-lineup-player-input.json> [output.json]');
  process.exit(2);
}

const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const intelligence = buildConfirmedLineupPlayerIntelligence(input);
const report = {
  reportVersion: 'PLAYER_MATCHUP_INTELLIGENCE_REPORT_V0_1',
  intelligence,
  realFootballPlayerEvidence: toRealFootballPlayerEvidence(intelligence),
  capitalState: 'LOCKED',
  realMoney: 'NO'
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;

if (outputPath) {
  fs.writeFileSync(outputPath, serialized);
  console.log(`Wrote ${outputPath}`);
} else {
  process.stdout.write(serialized);
}
