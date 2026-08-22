# Scaling Failure Rules v0.1
1. Never scale only from average load.
2. Never use CPU as the only saturation signal.
3. Never scale in while queues are stale.
4. Never let batch training starve live decision workloads.
5. Never exceed provider limits to hide insufficient caching/capacity.
6. Never let cost controls weaken truth/security contracts.
7. Never scale infinitely; max capacity and load shedding are explicit.
8. Never treat autoscaling as disaster recovery.
9. Never partition using unstable or hindsight-derived keys.
10. Preserve headroom for football schedule bursts.
