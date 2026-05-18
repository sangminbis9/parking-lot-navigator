CREATE TABLE IF NOT EXISTS agent_activity (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_kind TEXT,
  target_id TEXT,
  target_title TEXT,
  verdict TEXT,
  reason TEXT,
  payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_activity_ts
  ON agent_activity(ts DESC);

CREATE INDEX IF NOT EXISTS idx_agent_activity_agent_ts
  ON agent_activity(agent_id, ts DESC);
