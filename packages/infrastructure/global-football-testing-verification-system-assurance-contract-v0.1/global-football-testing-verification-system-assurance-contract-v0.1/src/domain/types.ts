export type TestLayer="UNIT"|"CONTRACT"|"INTEGRATION"|"PROPERTY"|"REPLAY"|"CHAOS"|"LOAD"|"SECURITY"|"DATA_QUALITY"|"MODEL_REGRESSION"|"END_TO_END";
export type TestStatus="PASS"|"FAIL"|"SKIP"|"QUARANTINED";
export type GateDecision="PROMOTE"|"BLOCK"|"REVIEW";
export type Severity="LOW"|"MEDIUM"|"HIGH"|"CRITICAL";

export type TestCase={
 test_id:string;layer:TestLayer;name:string;owner:string;critical:boolean;
 requirement_refs:string[];invariant_refs:string[];deterministic:boolean;
};

export type TestResult={
 run_id:string;test_id:string;layer:TestLayer;started_at:string;completed_at:string;
 status:TestStatus;critical:boolean;duration_ms:number;failure_code:string|null;artifact_refs:string[];
 environment:string;source_commit:string;immutable:true;
};

export type CoverageSnapshot={
 snapshot_id:string;observed_at:string;requirement_total:number;requirement_covered:number;
 critical_invariant_total:number;critical_invariant_covered:number;
 contract_total:number;contract_verified:number;
};

export type PropertyCheck={
 property_id:string;name:string;trials:number;passed:number;failed:number;
 minimal_counterexample:string|null;
};

export type ReplayVerification={
 replay_id:string;dataset_version:string;code_version:string;config_version:string;
 expected_hash:string;actual_hash:string;equivalent:boolean;differences:string[];
};

export type ChaosExperiment={
 experiment_id:string;fault_type:"PROVIDER_OUTAGE"|"QUEUE_DELAY"|"DB_FAILOVER"|"NETWORK_PARTITION"|"CLOCK_SKEW"|"DUPLICATE_EVENTS"|"STALE_DATA"|"SERVICE_CRASH";
 target:string;started_at:string;completed_at:string|null;
 expected_safe_behavior:string;observed_behavior:string|null;
 passed:boolean|null;blast_radius:string;
};

export type LoadTestResult={
 test_id:string;observed_at:string;peak_rps:number;peak_events_per_second:number;
 p95_latency_ms:number;p99_latency_ms:number;error_rate:number;
 max_queue_age_seconds:number;autoscaling_worked:boolean;load_shedding_worked:boolean;
};

export type SecurityVerification={
 verification_id:string;observed_at:string;control:string;
 status:"PASS"|"FAIL";severity:Severity;evidence_refs:string[];
};

export type ModelRegressionCheck={
 check_id:string;champion_version:string;candidate_version:string;dataset_version:string;
 brier_delta:number;logloss_delta:number;ece_delta:number;
 max_drawdown_delta:number;coverage_delta:number;
 critical_slice_regression:boolean;decision:"PASS"|"FAIL"|"REVIEW";
};

export type AssuranceGateInput={
 release_id:string;results:TestResult[];coverage:CoverageSnapshot;
 unresolved_security_failures:number;critical_data_quality_failures:number;
 model_regression:ModelRegressionCheck|null;replay_verified:boolean;
 load_verified:boolean;chaos_verified:boolean;
};

export type AssuranceGateResult={
 release_id:string;decision:GateDecision;reason_codes:string[];
 evaluated_at:string;immutable:true;
};

export type DefectRecord={
 defect_id:string;detected_at:string;severity:Severity;source_test_id:string|null;
 component:string;description:string;status:"OPEN"|"FIXED"|"ACCEPTED_RISK";
 root_cause:string|null;regression_test_id:string|null;
};
