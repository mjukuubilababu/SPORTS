PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS artifacts(
  artifact_type TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  event_id TEXT,
  version TEXT,
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(artifact_type, artifact_id)
);
CREATE TABLE IF NOT EXISTS audit_events(
  audit_id TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_executions(
  execution_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  entry_price REAL NOT NULL,
  stake REAL NOT NULL,
  executed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settlements(
  settlement_id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL UNIQUE,
  total_goals INTEGER NOT NULL,
  won INTEGER NOT NULL CHECK(won IN (0,1)),
  pnl REAL NOT NULL,
  settled_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assurance_runs(
  assurance_id TEXT PRIMARY KEY,
  gate TEXT NOT NULL CHECK(gate IN ('PROMOTE','REVIEW','BLOCK')),
  checks_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
