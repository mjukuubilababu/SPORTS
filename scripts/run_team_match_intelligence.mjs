import fs from 'node:fs';
import path from 'node:path';
import { buildMatchDecisionUniverse } from '../packages/intelligence-engine/src/match-decision-universe.mjs';

const inputPath = process.argv[2];
const outputPath = process.argv[3] ?? null;
if (!inputPath) {
  console.error('Usage: node scripts/run_team_match_intelligence.mjs <input.json> [output.json]');
  process.exit(2);
}

const absoluteInput = path.resolve(process.cwd(), inputPath);
const input = JSON.parse(fs.readFileSync(absoluteInput, 'utf8'));
const result = buildMatchDecisionUniverse(input);
const report = {
  reportVersion: 'TEAM_MATCH_INTELLIGENCE_RUNTIME_V0_1',
  generatedAt: new Date().toISOString(),
  sourceInput: inputPath,
  result,
  governance: {
    bookmakerMarketIsNotAnalysisStartingPoint: true,
    uncalibratedFootballIntelligenceCannotRewriteLambda: true,
    finalQualificationRemainsCanonicalGateResponsibility: true,
    capitalLocked: true,
    realMoney: 'NO'
  }
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  const absoluteOutput = path.resolve(process.cwd(), outputPath);
  fs.writeFileSync(absoluteOutput, serialized);
  console.log(`Wrote ${absoluteOutput}`);
} else {
  process.stdout.write(serialized);
}
