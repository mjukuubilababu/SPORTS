export const deploymentPolicy = {
    policy_version: "deployment-config-environment-0.1.0",
    sequentialPromotionRequired: true,
    reproducibleBuildRequired: true,
    signedReleaseRequired: true,
    immutableConfigSnapshots: true,
    productionCanaryPreferred: true,
    automaticRollbackOnCriticalAlert: true,
    configDriftDetectionRequired: true,
    secretReferencesOnly: true,
    destructiveMigrationRequiresBackup: true,
    migrationVerificationRequired: true,
    rollbackArtifactRequiredForProduction: true,
    disasterRecoveryTestingRequired: true,
    productionDirectDeployFromDevForbidden: true,
    runtimeConfigMutationRestricted: true,
    productionFeatureFlagsMustExpireOrHaveOwner: true
};
