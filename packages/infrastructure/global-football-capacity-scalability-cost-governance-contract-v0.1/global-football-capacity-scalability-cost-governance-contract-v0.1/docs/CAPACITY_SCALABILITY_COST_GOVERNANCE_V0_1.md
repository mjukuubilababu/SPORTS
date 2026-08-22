# Global Football Capacity, Scalability & Cost Governance Contract v0.1

## Constitutional principle
The larger the system's intelligence becomes, the stronger its discipline against self-deception must become.

Scale must preserve truth. Cost optimization must never silently reduce evidence integrity, security, lineage or reproducibility.

## Capacity model
Every service declares a capacity envelope:
minimum/maximum replicas, reserved capacity, CPU/memory targets, queue-age target,
per-replica throughput and safety headroom.

CPU alone is insufficient. Queue age, ingress rate, latency and error rate are first-class signals.

## Horizontal scalability
Stateless compute should scale horizontally. Stateful systems scale through partitioning,
replication and explicit ownership boundaries.

Stable football partition dimensions include:
competition_id, season_id, match_id, provider_id and region.

## Burst handling
Football workloads are bursty around:
lineup releases, market moves, kickoff windows, halftime/fulltime and large concurrent match slates.
Capacity forecasts should therefore be schedule-aware, not only based on yesterday's average traffic.

## Protected workloads
When saturated, preserve truth-critical workloads before optional work.
Typical protected classes:
LIVE_MARKET, PREMATCH, EXECUTION, SETTLEMENT.

Training, replay and low-priority batch work may be delayed.

## Load shedding
Load shedding is explicit. The system may reject/defer low-priority work before allowing stale or corrupted decisions.
It must never silently discard required evidence.

## Rate limiting
Every provider integration has contractual request rate, burst and concurrency limits.
Retry-After is respected. Provider bans are treated as reliability failures, not capacity strategy.

## Storage lifecycle
HOT -> WARM -> COLD -> ARCHIVE.
Immutable historical truth remains retrievable while expensive storage is reserved for actively queried data.

## Cost governance
Each scope has soft limit, hard limit and protected critical reserve.
Budget pressure may:
- defer training
- stop bulk replay
- throttle low-priority work
- tighten idle scale-in
- require approval for expansion

Budget pressure may NOT:
- disable security
- drop lineage
- fabricate missing data
- weaken validation
- overwrite immutable history

## Unit economics
Track:
cost per match
cost per decision
cost per inference
provider cost per useful observation
storage cost per retained evidence unit

Total cloud bill alone is not sufficient for optimization.

## Global expansion
A new league/competition must declare expected match volume, market quote density,
provider traffic, inference load and storage growth before capacity is committed.
Global growth is partitioned and measured rather than assumed to be free.
