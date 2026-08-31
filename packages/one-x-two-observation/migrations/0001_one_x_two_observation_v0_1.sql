CREATE TABLE one_x_two_observation_batches (
 batch_id text PRIMARY KEY,
 dataset_type text NOT NULL CHECK (dataset_type='1X2_REAL_WORLD_OBSERVATION'),
 status text NOT NULL CHECK (status='OBSERVATIONAL_ONLY'),
 provider text NOT NULL,
 observation_source text NOT NULL CHECK (observation_source IN ('REAL_MONEY_USER_SLIP','PAPER_DECISION','SYSTEM_FROZEN_1X2_SIGNAL','EXTERNAL_BENCHMARK')),
 origin_decision text NOT NULL CHECK (origin_decision IN ('USER_DECISION','SYSTEM_DECISION','BENCHMARK_DECISION')),
 payload_fingerprint text NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL
);

CREATE TABLE one_x_two_observations (
 observation_id text PRIMARY KEY,
 batch_id text NOT NULL REFERENCES one_x_two_observation_batches(batch_id),
 dataset_type text NOT NULL CHECK (dataset_type='1X2_REAL_WORLD_OBSERVATION'),
 status text NOT NULL CHECK (status='OBSERVATIONAL_ONLY'),
 observation_source text NOT NULL CHECK (observation_source IN ('REAL_MONEY_USER_SLIP','PAPER_DECISION','SYSTEM_FROZEN_1X2_SIGNAL','EXTERNAL_BENCHMARK')),
 origin_decision text NOT NULL CHECK (origin_decision IN ('USER_DECISION','SYSTEM_DECISION','BENCHMARK_DECISION')),
 ingestion_timing text NOT NULL CHECK (ingestion_timing IN ('PRE_KICKOFF_VERIFIED','POST_EVENT_ARCHIVAL')),
 provider text NOT NULL,
 event_id text,
 competition text,
 season text,
 home_team text NOT NULL,
 away_team text NOT NULL,
 selection text NOT NULL CHECK (selection IN ('HOME','DRAW','AWAY')),
 entry_odds numeric NOT NULL CHECK (entry_odds>1),
 entry_provider text NOT NULL,
 entry_observed_at timestamptz,
 kickoff_at timestamptz,
 implied_entry_probability numeric NOT NULL CHECK (implied_entry_probability>0 AND implied_entry_probability<1),
 closing_odds numeric CHECK (closing_odds>1),
 closing_provider text,
 closing_observed_at timestamptz,
 closing_verified boolean NOT NULL DEFAULT false,
 clv numeric,
 home_score integer NOT NULL CHECK (home_score>=0),
 away_score integer NOT NULL CHECK (away_score>=0),
 outcome text NOT NULL CHECK (outcome IN ('WIN','LOSS')),
 failure_classification text NOT NULL CHECK (failure_classification IN ('DRAW_FAILURE_HIGH_SCORING','DRAW_FAILURE_LOW_EVENT','FAVORITE_WIN_SUCCESS','OUTRIGHT_FAVORITE_UPSET','UNDERDOG_WIN_SUCCESS','DRAW_SUCCESS','UNCLASSIFIED')),
 state text NOT NULL CHECK (state IN ('OBSERVED','ENTRY_VERIFIED','STARTED','SETTLED','CLOSE_VERIFIED','EVALUATED')),
 system_probability numeric CHECK (system_probability BETWEEN 0 AND 1),
 confidence numeric CHECK (confidence BETWEEN 0 AND 1),
 prematch_signal_id text,
 favorite_rank integer,
 trap_flag boolean,
 market_context jsonb,
 identity_fingerprint text NOT NULL CHECK (identity_fingerprint ~ '^[0-9a-f]{64}$'),
 payload_fingerprint text NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL,
 CHECK (NOT (status IN ('VALIDATED','EXECUTION_APPROVED','CHAMPION'))),
 CHECK (ingestion_timing<>'PRE_KICKOFF_VERIFIED' OR (entry_observed_at IS NOT NULL AND kickoff_at IS NOT NULL AND entry_observed_at<kickoff_at)),
 CHECK (ingestion_timing<>'POST_EVENT_ARCHIVAL' OR entry_observed_at IS NULL),
 CHECK ((closing_verified=false AND closing_odds IS NULL AND closing_provider IS NULL AND closing_observed_at IS NULL AND clv IS NULL)
     OR (closing_verified=true AND closing_odds IS NOT NULL AND closing_provider=entry_provider AND closing_observed_at IS NOT NULL AND kickoff_at IS NOT NULL AND closing_observed_at<kickoff_at AND clv IS NOT NULL)),
 CHECK (NOT (state IN ('SETTLED','CLOSE_VERIFIED','EVALUATED') AND observation_source='SYSTEM_FROZEN_1X2_SIGNAL' AND origin_decision='USER_DECISION'))
);
CREATE INDEX one_x_two_observations_batch_idx ON one_x_two_observations(batch_id);
CREATE INDEX one_x_two_observations_event_idx ON one_x_two_observations(event_id) WHERE event_id IS NOT NULL;

CREATE TABLE one_x_two_counterfactual_replays (
 replay_id text PRIMARY KEY,
 observation_id text NOT NULL REFERENCES one_x_two_observations(observation_id),
 event_id text NOT NULL,
 cutoff_at timestamptz NOT NULL,
 decision text NOT NULL CHECK (decision IN ('HOME','DRAW','AWAY','ABSTAIN')),
 probabilities jsonb NOT NULL,
 confidence numeric CHECK (confidence BETWEEN 0 AND 1),
 flags jsonb NOT NULL,
 input_fingerprint text NOT NULL CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL
);
CREATE INDEX one_x_two_counterfactual_event_idx ON one_x_two_counterfactual_replays(event_id);

CREATE FUNCTION enforce_one_x_two_replay_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_event text; parent_kickoff timestamptz;
BEGIN
 SELECT event_id,kickoff_at INTO parent_event,parent_kickoff FROM one_x_two_observations WHERE observation_id=NEW.observation_id;
 IF parent_event IS NULL OR parent_event<>NEW.event_id THEN RAISE EXCEPTION 'CROSS_EVENT_REPLAY_REJECTED'; END IF;
 IF parent_kickoff IS NULL OR NEW.cutoff_at>parent_kickoff THEN RAISE EXCEPTION 'REPLAY_CUTOFF_AFTER_KICKOFF'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER one_x_two_replay_lineage BEFORE INSERT ON one_x_two_counterfactual_replays FOR EACH ROW EXECUTE FUNCTION enforce_one_x_two_replay_lineage();

CREATE FUNCTION reject_one_x_two_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'IMMUTABLE_ONE_X_TWO_EVIDENCE'; END $$;
CREATE TRIGGER one_x_two_batches_immutable BEFORE UPDATE OR DELETE ON one_x_two_observation_batches FOR EACH ROW EXECUTE FUNCTION reject_one_x_two_mutation();
CREATE TRIGGER one_x_two_observations_immutable BEFORE UPDATE OR DELETE ON one_x_two_observations FOR EACH ROW EXECUTE FUNCTION reject_one_x_two_mutation();
CREATE TRIGGER one_x_two_replays_immutable BEFORE UPDATE OR DELETE ON one_x_two_counterfactual_replays FOR EACH ROW EXECUTE FUNCTION reject_one_x_two_mutation();
