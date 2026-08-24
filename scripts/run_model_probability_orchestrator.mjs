import fs from 'node:fs';
import path from 'node:path';
import { orchestrateModelProbabilities } from '../packages/intelligence-engine/src/model-probability-orchestrator.mjs';

const inputPath=process.argv[2];
const outputPath=process.argv[3];
if(!inputPath){
  console.error('USAGE: node scripts/run_model_probability_orchestrator.mjs <input.json> [output.json]');
  process.exit(2);
}
const input=JSON.parse(fs.readFileSync(inputPath,'utf8'));
const output=orchestrateModelProbabilities(input);
if(outputPath){fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.writeFileSync(outputPath,JSON.stringify(output,null,2));}
console.log(JSON.stringify(output,null,2));
