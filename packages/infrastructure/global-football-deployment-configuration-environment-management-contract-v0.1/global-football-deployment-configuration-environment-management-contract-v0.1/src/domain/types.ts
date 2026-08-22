export type Environment="DEV"|"TEST"|"STAGING"|"PRODUCTION";
export type ReleaseState="DRAFT"|"BUILT"|"SIGNED"|"STAGED"|"CANARY"|"PROMOTED"|"ROLLED_BACK"|"QUARANTINED";
export type RolloutStrategy="ALL_AT_ONCE"|"CANARY"|"BLUE_GREEN"|"SHADOW";
export type ConfigValue=string|number|boolean|null;

export type BuildArtifact={
  build_id:string;
  source_commit:string;
  source_tree_hash:string;
  dependency_lock_hash:string;
  compiler_version:string;
  build_environment:string;
  built_at:string;
  artifact_hash:string;
  reproducible:boolean;
  sbom_reference:string|null;
  immutable:true;
};

export type ReleaseArtifact={
  release_id:string;
  release_version:string;
  build_id:string;
  state:ReleaseState;
  created_at:string;
  signed_at:string|null;
  signature:string|null;
  key_id:string|null;
  target_environments:Environment[];
  migration_bundle_id:string|null;
  config_schema_version:string;
  immutable:true;
};

export type ConfigEntry={
  key:string;
  value:ConfigValue;
  secret_ref:string|null;
  data_class:"PUBLIC"|"INTERNAL"|"RESTRICTED";
  mutable_at_runtime:boolean;
};

export type ConfigSnapshot={
  config_snapshot_id:string;
  environment:Environment;
  schema_version:string;
  created_at:string;
  created_by_identity_id:string;
  entries:ConfigEntry[];
  content_hash:string;
  immutable:true;
};

export type FeatureFlag={
  flag_id:string;
  name:string;
  environment:Environment;
  enabled:boolean;
  rollout_pct:number;
  allowed_scopes:string[];
  created_at:string;
  expires_at:string|null;
  owner:string;
};

export type EnvironmentState={
  environment:Environment;
  active_release_id:string|null;
  active_config_snapshot_id:string|null;
  last_deployed_at:string|null;
  health_state:"HEALTHY"|"DEGRADED"|"UNHEALTHY"|"UNKNOWN";
  drift_detected:boolean;
};

export type DeploymentPlan={
  deployment_id:string;
  release_id:string;
  from_environment:Environment;
  to_environment:Environment;
  strategy:RolloutStrategy;
  created_at:string;
  requested_by_identity_id:string;
  canary_pct:number|null;
  success_slo_ids:string[];
  abort_on_critical_alert:boolean;
  rollback_release_id:string|null;
};

export type DeploymentResult={
  deployment_id:string;
  started_at:string;
  completed_at:string|null;
  status:"PENDING"|"RUNNING"|"SUCCEEDED"|"FAILED"|"ABORTED"|"ROLLED_BACK";
  promoted_release_id:string|null;
  rollback_release_id:string|null;
  reason_codes:string[];
  immutable:true;
};

export type MigrationStep={
  migration_id:string;
  order:number;
  description:string;
  backward_compatible:boolean;
  destructive:boolean;
  requires_backup:boolean;
  verification_query:string|null;
};

export type MigrationBundle={
  migration_bundle_id:string;
  schema_from:string;
  schema_to:string;
  steps:MigrationStep[];
  created_at:string;
  immutable:true;
};

export type BackupRecord={
  backup_id:string;
  environment:Environment;
  created_at:string;
  data_scope:string;
  storage_reference:string;
  checksum:string;
  restore_tested:boolean;
  restore_tested_at:string|null;
  retention_until:string;
};

export type DisasterRecoveryPlan={
  dr_plan_id:string;
  environment:Environment;
  rpo_minutes:number;
  rto_minutes:number;
  backup_required:boolean;
  multi_region_required:boolean;
  failover_target:string|null;
  last_dr_test_at:string|null;
  next_dr_test_due_at:string;
};
