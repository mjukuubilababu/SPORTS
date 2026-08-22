export const assurancePolicy = {
    policy_version: "testing-verification-system-assurance-0.1.0",
    criticalTestsMustPass: true,
    skippedCriticalTestsForbidden: true,
    criticalInvariantCoverageRequired: 1,
    contractVerificationRequired: 1,
    replayVerificationRequiredForProduction: true,
    chaosVerificationRequiredForProduction: true,
    loadVerificationRequiredForProduction: true,
    unresolvedCriticalSecurityFailuresAllowed: 0,
    unresolvedCriticalDataQualityFailuresAllowed: 0,
    modelRegressionGateRequired: true,
    defectRequiresRegressionTest: true,
    immutableTestEvidence: true,
    productionTestDataMustBeVersioned: true,
    flakyTestsMustBeQuarantinedNotIgnored: true,
    testPassCannotOverrideBrokenInvariant: true
};
