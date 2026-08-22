import type{PipelineStage,StageDependency}from"../domain/types.js";

export const dependencyGraph:StageDependency[]=[
 {stage:"INGESTION",requires:[],optional:[],timeout_seconds:30,max_retries:5,retry_backoff_seconds:[2,5,15,30,60],dead_letter_after_attempts:5},
 {stage:"NORMALIZATION",requires:["INGESTION"],optional:[],timeout_seconds:30,max_retries:4,retry_backoff_seconds:[2,5,15,30],dead_letter_after_attempts:4},
 {stage:"DATA_CONTRACT",requires:["NORMALIZATION"],optional:[],timeout_seconds:20,max_retries:3,retry_backoff_seconds:[2,5,15],dead_letter_after_attempts:3},
 {stage:"FEATURE_ENGINE",requires:["DATA_CONTRACT"],optional:[],timeout_seconds:60,max_retries:3,retry_backoff_seconds:[5,15,30],dead_letter_after_attempts:3},
 {stage:"MODEL",requires:["FEATURE_ENGINE"],optional:[],timeout_seconds:45,max_retries:3,retry_backoff_seconds:[5,15,30],dead_letter_after_attempts:3},
 {stage:"PATTERN",requires:["MODEL"],optional:[],timeout_seconds:20,max_retries:2,retry_backoff_seconds:[5,15],dead_letter_after_attempts:2},
 {stage:"DECISION",requires:["MODEL"],optional:["PATTERN"],timeout_seconds:20,max_retries:2,retry_backoff_seconds:[5,15],dead_letter_after_attempts:2},
 {stage:"PORTFOLIO_RISK",requires:["DECISION"],optional:[],timeout_seconds:20,max_retries:2,retry_backoff_seconds:[5,15],dead_letter_after_attempts:2},
 {stage:"EXECUTION",requires:["PORTFOLIO_RISK"],optional:[],timeout_seconds:20,max_retries:1,retry_backoff_seconds:[5],dead_letter_after_attempts:1},
 {stage:"SETTLEMENT",requires:["EXECUTION"],optional:[],timeout_seconds:60,max_retries:5,retry_backoff_seconds:[10,30,60,120,300],dead_letter_after_attempts:5},
 {stage:"ATTRIBUTION",requires:["SETTLEMENT"],optional:[],timeout_seconds:60,max_retries:3,retry_backoff_seconds:[10,30,60],dead_letter_after_attempts:3},
 {stage:"EVALUATION",requires:["ATTRIBUTION"],optional:[],timeout_seconds:120,max_retries:2,retry_backoff_seconds:[30,60],dead_letter_after_attempts:2},
 {stage:"LEARNING",requires:["EVALUATION"],optional:[],timeout_seconds:120,max_retries:1,retry_backoff_seconds:[60],dead_letter_after_attempts:1},
 {stage:"GOVERNANCE",requires:["LEARNING"],optional:[],timeout_seconds:120,max_retries:1,retry_backoff_seconds:[60],dead_letter_after_attempts:1}
];

export function depsFor(stage:PipelineStage):StageDependency{
  const d=dependencyGraph.find(x=>x.stage===stage);
  if(!d)throw new Error(`unknown stage ${stage}`);
  return d;
}
