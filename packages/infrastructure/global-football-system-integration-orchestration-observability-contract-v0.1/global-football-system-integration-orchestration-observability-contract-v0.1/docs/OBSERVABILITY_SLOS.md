# Observability & SLO Baseline v0.1

Initial engineering targets are baselines, not permanent truths.

Recommended indicators:
- canonical ingestion availability
- market quote freshness
- end-to-end pre-match pipeline latency
- data-contract pass rate
- stage error rate
- dead-letter rate
- model availability
- decision-generation availability
- settlement completion lag
- trace completeness

Alert policy should distinguish:
INFO: no operator action needed
WARN: investigate/degrade
ERROR: stage impaired
CRITICAL: truth or capital integrity at risk; pause/quarantine/open circuit

Accuracy alarms must be separate from infrastructure alarms. A healthy service can run a drifting model;
a calibrated model can still be unavailable operationally.
