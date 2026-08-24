import fs from 'node:fs';
import path from 'node:path';
import { buildRealPlayerProfiles } from '../packages/intelligence-engine/src/real-player-profile-ingestion.mjs';

const inputPath=process.argv[2];
const outputPath=process.argv[3];
if(!inputPath){
  console.error('USAGE: node scripts/run_real_player_profile_ingestion.mjs <input.json> [output.json]');
  process.exit(2);
}
const input=JSON.parse(fs.readFileSync(inputPath,'utf8'));
const output=buildRealPlayerProfiles(input,{asOf:input.asOf??input.capturedAt,minimumPlayerSample:input.minimumPlayerSample??8,minimumRoleCohort:input.minimumRoleCohort??5});
if(outputPath){ fs.mkdirSync(path.dirname(outputPath),{recursive:true}); fs.writeFileSync(outputPath,JSON.stringify(output,null,2)); }
console.log(JSON.stringify({version:output.version,datasetId:output.datasetId,competition:output.competition,playerCount:output.audit.playerCount,roleCohortSizes:output.audit.roleCohortSizes,governance:output.governance},null,2));
