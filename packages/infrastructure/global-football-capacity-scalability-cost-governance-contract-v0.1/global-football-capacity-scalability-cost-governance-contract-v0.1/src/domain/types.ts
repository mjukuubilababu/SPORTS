export type Priority="CRITICAL"|"HIGH"|"NORMAL"|"LOW";
export type ScaleState="UNDERUTILIZED"|"HEALTHY"|"PRESSURED"|"SATURATED";
export type CostState="NORMAL"|"WATCH"|"THROTTLE_NONCRITICAL"|"FREEZE_EXPANSION";
export type WorkloadClass="LIVE_MARKET"|"PREMATCH"|"INGESTION"|"FEATURES"|"INFERENCE"|"SETTLEMENT"|"EVALUATION"|"TRAINING"|"REPLAY";

export type CapacityEnvelope={
  service_id:string;workload:WorkloadClass;region:string;
  min_replicas:number;max_replicas:number;reserved_capacity:number;
  target_cpu_pct:number;target_memory_pct:number;max_queue_age_seconds:number;
  max_rps_per_replica:number;headroom_pct:number;
};

export type CapacityObservation={
  service_id:string;observed_at:string;replicas:number;cpu_pct:number;memory_pct:number;
  rps:number;queue_depth:number;oldest_queue_age_seconds:number;p95_latency_ms:number;
  error_rate:number;ingress_rps:number;egress_rps:number;
};

export type ScalingDecision={
  service_id:string;decided_at:string;current_replicas:number;desired_replicas:number;
  action:"SCALE_OUT"|"SCALE_IN"|"HOLD"|"SHED_LOAD";
  reason_codes:string[];cooldown_seconds:number;
};

export type PartitionKey={
  competition_id:string;season_id:string|null;match_id:string|null;provider_id:string|null;region:string|null;
};

export type LoadSheddingPolicy={
  policy_id:string;drop_order:Priority[];protected_workloads:WorkloadClass[];
  max_staleness_seconds:Partial<Record<WorkloadClass,number>>;
};

export type CostBudget={
  budget_id:string;scope:string;period:"DAILY"|"MONTHLY";currency:string;soft_limit:number;hard_limit:number;
  critical_reserve:number;owner:string;
};

export type CostObservation={
  budget_id:string;observed_at:string;spend_to_date:number;forecast_period_end:number;
  cost_per_match:number|null;cost_per_decision:number|null;cost_per_inference:number|null;
};

export type CostDecision={
  budget_id:string;state:CostState;actions:string[];reason_codes:string[];
};

export type StorageTierPolicy={
  dataset_class:string;hot_days:number;warm_days:number;cold_after_days:number;
  archive_after_days:number|null;compression_required:boolean;
};

export type ProviderRateLimit={
  provider_id:string;requests_per_second:number;burst:number;concurrency:number;
  retry_after_respected:true;
};

export type CapacityForecast={
  forecast_id:string;generated_at:string;window_start:string;window_end:string;
  expected_matches:number;expected_peak_rps:number;expected_peak_quotes_per_second:number;
  expected_storage_gb:number;confidence:number;
};

export type UnitEconomics={
  observed_at:string;scope:string;currency:string;
  total_cost:number;matches_processed:number;decisions_generated:number;inferences:number;
  cost_per_match:number|null;cost_per_decision:number|null;cost_per_inference:number|null;
};
