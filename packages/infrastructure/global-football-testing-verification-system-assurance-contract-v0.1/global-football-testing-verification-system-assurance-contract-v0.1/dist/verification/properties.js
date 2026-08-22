export function probabilityInvariant(values) { return values.every(x => Number.isFinite(x) && x >= 0 && x <= 1); }
export function temporalInvariant(observedAt, occurredAt) { return Date.parse(observedAt) <= Date.parse(occurredAt); }
export function monotonicLineageInvariant(parentCount, childCount) { return childCount >= parentCount; }
export function noDuplicateBusinessEffect(keys) { return new Set(keys).size === keys.length; }
