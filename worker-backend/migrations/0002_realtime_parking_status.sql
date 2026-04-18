CREATE TABLE IF NOT EXISTS realtime_parking_status (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_parking_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  total_capacity INTEGER,
  available_spaces INTEGER,
  occupancy_rate REAL,
  congestion_status TEXT NOT NULL DEFAULT 'unknown',
  realtime_available INTEGER NOT NULL DEFAULT 1,
  freshness_timestamp TEXT,
  operating_hours TEXT,
  fee_summary TEXT,
  supports_ev INTEGER NOT NULL DEFAULT 0,
  supports_accessible INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 0,
  is_private INTEGER NOT NULL DEFAULT 0,
  display_status TEXT NOT NULL,
  raw_payload TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_realtime_parking_status_lat_lng
  ON realtime_parking_status(lat, lng);

CREATE INDEX IF NOT EXISTS idx_realtime_parking_status_last_seen
  ON realtime_parking_status(last_seen_at);

