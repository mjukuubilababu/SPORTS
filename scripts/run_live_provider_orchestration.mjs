import fs from 'node:fs';
import path from 'node:path';
import { orchestrateLiveProviderPredictions } from '../packages/intelligence-engine/src/live-provider-orchestration.mjs';

function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}

const [providerFile,linksFile,outputFile]=process.argv.slice(2);
if(!providerFile || !linksFile){
  console.error('Usage: node scripts/run_live_provider_orchestration.mjs <provider-artifact.json> <prematch-links.json> [output.json]');
  process.exit(2);
}

const providerArtifact=readJson(providerFile);
const linksPayload=readJson(linksFile);
const prematchLinks=Array.isArray(linksPayload)?linksPayload:linksPayload.prematchLinks;
const result=orchestrateLiveProviderPredictions({providerArtifact,prematchLinks});
const text=`${JSON.stringify(result,null,2)}\n`;

if(outputFile){
  fs.mkdirSync(path.dirname(outputFile),{recursive:true});
  fs.writeFileSync(outputFile,text);
}else{
  process.stdout.write(text);
}
