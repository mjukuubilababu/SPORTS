# Global Football System Integration, Orchestration & Observability Contract v0.1

## Constitutional principle
The larger the system's intelligence becomes, the stronger its discipline against self-deception must become.

## Mission
This contract turns independent intelligence components into one reliable production system.
Its first responsibility is to preserve truth under failure.

## Event-driven architecture
Each stage emits immutable events carrying:
- event_id
- correlation_id
- causation_id
- idempotency_key
- entity identity
- timestamps
- lineage references
- attempt number
- stage and producer

## Dependency graph
INGESTION -> NORMALIZATION -> DATA_CONTRACT -> FEATURE_ENGINE -> MODEL -> PATTERN/DECISION ->
PORTFOLIO_RISK -> EXECUTION -> SETTLEMENT -> ATTRIBUTION -> EVALUATION -> LEARNING -> GOVERNANCE.

Required dependencies are explicit. Optional dependencies never silently become required.

## Idempotency
Retries are normal. Duplicate business effects are not.
Exactly-once business effect is achieved through idempotency keys, immutable input hashes and persisted successful stage runs.

## Retry discipline
Retries are bounded and use backoff. Exhausted retries go to a dead-letter queue.
Infinite retry loops are prohibited because they hide persistent faults and consume capacity.

## Circuit breakers
A failing stage may open its circuit to stop cascading failures. Half-open recovery probes are explicit.
A broken provider or model service must not poison downstream artifacts.

## Backpressure
Queue depth, oldest-message age, ingress rate and processing rate determine NORMAL/PRESSURED/THROTTLED/PAUSED states.
The system may degrade or pause rather than process stale data as if it were fresh.

## Replay
Historical replay is explicit and versioned. Replay never overwrites original artifacts.
DRY_RUN and SAFE_REPLAY are separate modes.

## Observability
Every match decision can be traced end-to-end by trace_id/correlation_id.
Required telemetry:
- structured logs
- distributed traces
- queue depth
- stage latency
- success/failure rate
- retry rate
- dead-letter rate
- stale-data rate
- data-contract rejection rate
- feature missingness
- model latency
- abstention rate
- decision state counts
- settlement lag
- drift signals

## SLOs
SLOs are versioned contracts, not dashboard decoration. Burn-rate alerts detect rapid reliability degradation.

## Failure philosophy
The correct degraded behavior is often WAIT, REJECT, QUARANTINE or PAUSE.
The system must never fabricate missing data, infer successful completion, or silently repair evidence to keep the pipeline green.

## Global scale
No competition receives special orchestration logic. Partitioning and scheduling operate on entity IDs, competition IDs, event time and priority.
Architecture supports horizontal workers and independent scaling of hot stages such as market ingestion.

## Recovery
Every failed stage preserves:
- original event
- failure code
- attempt history
- trace
- input hash
- last known good artifact

Recovery creates a new run; it does not rewrite the failed run.
