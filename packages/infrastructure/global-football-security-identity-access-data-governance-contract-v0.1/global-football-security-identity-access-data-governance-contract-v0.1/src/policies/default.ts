export const securityPolicy={
  policy_version:"security-identity-access-governance-0.1.0",
  leastPrivilege:true,
  denyByDefault:true,
  productionPromotionRequiresDualControl:true,
  productionOverrideRequiresDualControl:true,
  breakGlassRequiresReasonAndAudit:true,
  serviceCredentialsMustExpire:true,
  secretRotationRequired:true,
  secretsNeverLogged:true,
  signedProductionArtifactsRequired:true,
  contentHashVerificationRequired:true,
  providerTrustScoringRequired:true,
  poisoningDetectionRequired:true,
  restrictedDataExportDeniedByDefault:true,
  automaticPrivilegeEscalation:false,
  automaticSilentProviderTrustUpgrade:false,
  immutableSecurityAudit:true
} as const;
