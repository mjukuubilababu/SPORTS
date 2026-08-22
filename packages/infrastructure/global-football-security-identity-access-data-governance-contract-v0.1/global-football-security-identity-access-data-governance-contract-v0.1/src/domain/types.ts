export type IdentityType="HUMAN"|"SERVICE"|"MODEL"|"PIPELINE"|"PROVIDER";
export type DataClass="PUBLIC"|"LICENSED"|"INTERNAL"|"RESTRICTED";
export type Environment="DEV"|"TEST"|"STAGING"|"PRODUCTION";
export type Action=
  | "READ"
  | "WRITE"
  | "EXECUTE"
  | "PROMOTE"
  | "OVERRIDE"
  | "REPLAY"
  | "ROTATE_SECRET"
  | "MANAGE_POLICY"
  | "MANAGE_IDENTITY"
  | "EXPORT";

export type Identity={
  identity_id:string;
  identity_type:IdentityType;
  display_name:string;
  active:boolean;
  environment_scope:Environment[];
  roles:string[];
  created_at:string;
  expires_at:string|null;
};

export type Permission={
  permission_id:string;
  role:string;
  resource_pattern:string;
  actions:Action[];
  environments:Environment[];
  data_classes:DataClass[];
};

export type AccessRequest={
  request_id:string;
  identity:Identity;
  action:Action;
  resource:string;
  environment:Environment;
  data_class:DataClass;
  requested_at:string;
  reason:string;
  break_glass:boolean;
};

export type AccessDecision={
  request_id:string;
  allowed:boolean;
  matched_permissions:string[];
  reason_codes:string[];
  requires_secondary_approval:boolean;
};

export type ApprovalRecord={
  approval_id:string;
  request_id:string;
  approver_identity_id:string;
  approved_at:string;
  decision:"APPROVE"|"REJECT";
  reason:string;
  immutable:true;
};

export type SignedArtifact={
  artifact_id:string;
  artifact_type:"DATASET"|"FEATURE_SET"|"MODEL"|"PATTERN"|"POLICY"|"DECISION"|"RISK_POLICY";
  artifact_version:string;
  created_at:string;
  created_by_identity_id:string;
  content_hash:string;
  signature:string;
  signature_algorithm:"HMAC_SHA256"|"ED25519"|"RSA_PSS";
  key_id:string;
  immutable:true;
};

export type ProviderTrustRecord={
  provider_id:string;
  trust_level:"TRUSTED"|"LIMITED"|"QUARANTINED"|"BLOCKED";
  last_reviewed_at:string;
  anomaly_score:number;
  schema_violation_rate:number;
  timestamp_anomaly_rate:number;
  conflict_rate:number;
  signature_verified:boolean|null;
};

export type DataGovernanceRecord={
  dataset_id:string;
  data_class:DataClass;
  owner_identity_id:string;
  purpose:string;
  allowed_uses:string[];
  prohibited_uses:string[];
  retention_days:number|null;
  residency_scope:string[];
  license_reference:string|null;
  created_at:string;
  review_due_at:string;
};

export type SecretReference={
  secret_ref:string;
  owner_service:string;
  purpose:string;
  environment:Environment;
  last_rotated_at:string;
  next_rotation_due_at:string;
  never_log:true;
};

export type SecurityAuditEvent={
  event_id:string;
  occurred_at:string;
  identity_id:string;
  action:string;
  resource:string;
  environment:Environment;
  outcome:"ALLOWED"|"DENIED"|"FAILED";
  reason_codes:string[];
  correlation_id:string|null;
  immutable:true;
};

export type PoisoningSignal={
  signal_id:string;
  detected_at:string;
  source_id:string;
  scope:string;
  anomaly_type:"DISTRIBUTION_SHIFT"|"SCHEMA_ABUSE"|"TIMESTAMP_MANIPULATION"|"LABEL_CONTAMINATION"|"DUPLICATE_FLOOD"|"SOURCE_CONFLICT_SPIKE"|"ARTIFACT_TAMPER";
  severity:"INFO"|"WARN"|"CRITICAL";
  score:number;
  action:"NONE"|"WATCH"|"QUARANTINE_SOURCE"|"BLOCK_SOURCE"|"INVALIDATE_ARTIFACT";
};
