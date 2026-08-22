CREATE TABLE IF NOT EXISTS capacity_envelopes_v01(
 service_id text NOT NULL,workload text NOT NULL,region text NOT NULL,min_replicas integer NOT NULL,max_replicas integer NOT NULL,
 reserved_capacity integer NOT NULL,target_cpu_pct numeric NOT NULL,target_memory_pct numeric NOT NULL,
 max_queue_age_seconds integer NOT NULL,max_rps_per_replica numeric NOT NULL,headroom_pct numeric NOT NULL,
 PRIMARY KEY(service_id,region));

CREATE TABLE IF NOT EXISTS capacity_observations_v01(
 service_id text NOT NULL,observed_at timestamptz NOT NULL,replicas integer NOT NULL,cpu_pct numeric NOT NULL,
 memory_pct numeric NOT NULL,rps numeric NOT NULL,queue_depth bigint NOT NULL,oldest_queue_age_seconds numeric NOT NULL,
 p95_latency_ms numeric NOT NULL,error_rate numeric NOT NULL,ingress_rps numeric NOT NULL,egress_rps numeric NOT NULL,
 PRIMARY KEY(service_id,observed_at));

CREATE TABLE IF NOT EXISTS scaling_decisions_v01(
 service_id text NOT NULL,decided_at timestamptz NOT NULL,current_replicas integer NOT NULL,desired_replicas integer NOT NULL,
 action text NOT NULL,reason_codes jsonb NOT NULL,cooldown_seconds integer NOT NULL,
 PRIMARY KEY(service_id,decided_at));

CREATE TABLE IF NOT EXISTS cost_budgets_v01(
 budget_id text PRIMARY KEY,scope text NOT NULL,period text NOT NULL,currency text NOT NULL,
 soft_limit numeric NOT NULL,hard_limit numeric NOT NULL,critical_reserve numeric NOT NULL,owner text NOT NULL);

CREATE TABLE IF NOT EXISTS cost_observations_v01(
 budget_id text NOT NULL,observed_at timestamptz NOT NULL,spend_to_date numeric NOT NULL,forecast_period_end numeric NOT NULL,
 cost_per_match numeric,cost_per_decision numeric,cost_per_inference numeric,PRIMARY KEY(budget_id,observed_at));

CREATE TABLE IF NOT EXISTS storage_tier_policies_v01(
 dataset_class text PRIMARY KEY,hot_days integer NOT NULL,warm_days integer NOT NULL,cold_after_days integer NOT NULL,
 archive_after_days integer,compression_required boolean NOT NULL);

CREATE TABLE IF NOT EXISTS provider_rate_limits_v01(
 provider_id text PRIMARY KEY,requests_per_second numeric NOT NULL,burst numeric NOT NULL,concurrency integer NOT NULL,
 retry_after_respected boolean NOT NULL DEFAULT true CHECK(retry_after_respected=true));

CREATE TABLE IF NOT EXISTS capacity_forecasts_v01(
 forecast_id text PRIMARY KEY,generated_at timestamptz NOT NULL,window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,
 expected_matches integer NOT NULL,expected_peak_rps numeric NOT NULL,expected_peak_quotes_per_second numeric NOT NULL,
 expected_storage_gb numeric NOT NULL,confidence numeric NOT NULL CHECK(confidence BETWEEN 0 AND 1));
