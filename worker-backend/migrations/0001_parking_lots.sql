CREATE TABLE IF NOT EXISTS parking_lots (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_parking_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  road_address TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  total_capacity INTEGER,
  fee_summary TEXT,
  operating_hours TEXT,
  supports_ev INTEGER NOT NULL DEFAULT 0,
  supports_accessible INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 0,
  is_private INTEGER NOT NULL DEFAULT 0,
  region1 TEXT,
  region2 TEXT,
  raw_payload TEXT,
  data_updated_at TEXT,
  synced_at TEXT NOT NULL,
  UNIQUE(source, source_parking_id)
);

CREATE INDEX IF NOT EXISTS idx_parking_lots_lat_lng ON parking_lots(lat, lng);
CREATE INDEX IF NOT EXISTS idx_parking_lots_region ON parking_lots(region1, region2);
CREATE INDEX IF NOT EXISTS idx_parking_lots_source ON parking_lots(source);
