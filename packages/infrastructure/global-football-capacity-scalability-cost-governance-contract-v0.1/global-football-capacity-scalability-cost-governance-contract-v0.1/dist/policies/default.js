export const capacityCostPolicy = {
    policy_version: "capacity-scalability-cost-governance-0.1.0",
    horizontalScalingPreferred: true,
    headroomRequired: true,
    predictiveCapacityPlanning: true,
    queueAgeIsFirstClassSignal: true,
    protectedCriticalWorkloads: true,
    loadSheddingBeforeTruthCorruption: true,
    providerRateLimitsRequired: true,
    partitionByStableFootballEntities: true,
    hotWarmColdStorageRequired: true,
    unitEconomicsRequired: true,
    criticalCostReserveRequired: true,
    costCannotOverrideTruthIntegrity: true,
    costCannotDisableSecurityControls: true,
    noncriticalTrainingMayBeDeferred: true,
    bulkReplayMayBeDeferred: true,
    scaleToZeroProductionCriticalServices: false
};
