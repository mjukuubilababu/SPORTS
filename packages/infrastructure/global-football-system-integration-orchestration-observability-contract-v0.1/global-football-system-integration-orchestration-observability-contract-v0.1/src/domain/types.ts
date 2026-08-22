export type PipelineStage=
  | "INGESTION"
  | "NORMALIZATION"
  | "DATA_CONTRACT"
  | "FEATURE_ENGINE"
  | "MODEL"
  | "PATTERN"
  | "DECISION"
  | "PORTFOLIO_RISK"
  | "EXECUTION"
  | "SETTLEMENT"
  | "ATTRIBUTION"
  | "EVALUATION"
  | "LEARNING"
  | "GOVERNANCE";

export type EventStatus="PENDING"|"PROCESSING"|"SUCCEEDED"|"FAILED"|"DEAD_LETTERED"|"QUARANTINED";
export type Severity="INFO"|"WARN"|"ERROR"|"CRITICAL";

export type SystemEvent<T=unknown>={
  event_id:string;
  event_type:string;
  schema_version:"0.1";
  occurred_at:string;
  observed_at:string;
  producer:string;
  stage:PipelineStage;
  correlation_id:string;
  causation_id:string|null;
  idempotency_key:string;
  entity_type:string;
  entity_id:string;
  payload:T;
  lineage_refs:string[];
  attempt:number;
  status:EventStatus;
};

export type StageDependency={
  stage:PipelineStage;
  requires:PipelineStage[];
  optional:PipelineStage[];
  timeout_seconds:number;
  max_retries:number;
  retry_backoff_seconds:number[];
  dead_letter_after_attempts:number;
};

export type StageRun={
  stage_run_id:string;
  event_id:string;
  stage:PipelineStage;
  started_at:string;
  completed_at:string|null;
  status:EventStatus;
  attempt:number;
  input_hash:string;
  output_hash:string|null;
  error_code:string|null;
  error_message:string|null;
  worker_id:string;
  immutable:true;
};

export type TraceSpan={
  trace_id:string;
  span_id:string;
  parent_span_id:string|null;
  stage:PipelineStage;
  name:string;
  started_at:string;
  ended_at:string|null;
  status:"OK"|"ERROR";
  attributes:Record<string,string|number|boolean|null>;
};

export type HealthMetric={
  metric:string;
  stage:PipelineStage|null;
  observed_at:string;
  value:number;
  unit:string;
  severity:Severity;
};

export type SLODefinition={
  slo_id:string;
  name:string;
  stage:PipelineStage|null;
  indicator:string;
  target:number;
  window_minutes:number;
  burn_rate_alert_threshold:number;
};

export type AlertEvent={
  alert_id:string;
  created_at:string;
  severity:Severity;
  source:string;
  stage:PipelineStage|null;
  code:string;
  message:string;
  trace_id:string|null;
  correlation_id:string|null;
  auto_action:"NONE"|"PAUSE_STAGE"|"QUARANTINE_ENTITY"|"OPEN_CIRCUIT"|"DEGRADE_MODE";
  resolved_at:string|null;
};

export type CircuitBreakerState={
  circuit_id:string;
  stage:PipelineStage;
  state:"CLOSED"|"OPEN"|"HALF_OPEN";
  failure_rate:number;
  consecutive_failures:number;
  opened_at:string|null;
  last_transition_at:string;
};

export type BackpressureState={
  queue_name:string;
  observed_at:string;
  depth:number;
  oldest_message_age_seconds:number;
  processing_rate_per_second:number;
  ingress_rate_per_second:number;
  state:"NORMAL"|"PRESSURED"|"THROTTLED"|"PAUSED";
};

export type ReplayRequest={
  replay_id:string;
  requested_at:string;
  stage:PipelineStage;
  source_event_ids:string[];
  mode:"DRY_RUN"|"SAFE_REPLAY";
  reason:string;
  preserve_original_artifacts:true;
};

export type OrchestrationDecision={
  action:"RUN"|"WAIT"|"RETRY"|"DEAD_LETTER"|"QUARANTINE"|"SKIP_IDEMPOTENT"|"BLOCKED_BY_CIRCUIT";
  reason:string;
  next_retry_at:string|null;
};
