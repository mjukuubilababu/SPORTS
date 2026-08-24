import fs from 'node:fs';
import path from 'node:path';
import { buildMatchTransferAudit, transferAuditToFeatureSet } from '../packages/intelligence-engine/src/transfer-impact-intelligence.mjs';
import { buildTeamMatchIntelligence } from '../packages/intelligence-engine/src/team-match-intelligence.mjs';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath) {
  console.error('USAGE: node scripts/run_transfer_impact_intelligence.mjs <input.json> [output.json]');
  process.exit(2);
}

const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const audit = buildMatchTransferAudit(input);
const transferImpact = transferAuditToFeatureSet(audit);
const intelligence = buildTeamMatchIntelligence({
  eventId: audit.eventId,
  homeTeam: input.home?.teamId ?? 'HOME',
  awayTeam: input.away?.teamId ?? 'AWAY',
  asOf: input.asOf,
  featureSet: { transferImpact },
  minimumSample: 5,
  maxAgeDays: 365
});
const result = {
  version: 'TRANSFER_IMPACT_RUNTIME_OUTPUT_V0_1',
  audit,
  transferImpactFeature: transferImpact,
  transferImpactDomain: intelligence.domainBoard.find((x)=>x.domain==='TRANSFER_IMPACT'),
  state: intelligence.missingDomains.includes('TRANSFER_IMPACT') ? 'TRANSFER_IMPACT_BLOCKED' : 'TRANSFER_IMPACT_ACTIVE',
  governance: {
    bookmakerOddsUsed: false,
    transferFeesUsed: false,
    reputationScoresUsed: false,
    lambdaRewritePerformed: false,
    capitalEffect: 'NONE',
    realMoney: 'NO'
  }
};

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result, null, 2));
