CREATE TABLE IF NOT EXISTS discovery_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  category_text TEXT,
  start_date TEXT,
  end_date TEXT,
  status TEXT,
  is_free INTEGER,
  venue_name TEXT,
  address TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  rating REAL,
  review_count INTEGER,
  lowest_price_text TEXT,
  lowest_price_platform TEXT,
  source_url TEXT,
  image_url TEXT,
  tags_json TEXT,
  amenities_json TEXT,
  offers_json TEXT,
  raw_payload TEXT,
  data_updated_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  UNIQUE(type, source, source_item_id)
);

CREATE INDEX IF NOT EXISTS idx_discovery_items_type_lat_lng
  ON discovery_items(type, lat, lng);

CREATE INDEX IF NOT EXISTS idx_discovery_items_type_status_dates
  ON discovery_items(type, status, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_discovery_items_last_seen
  ON discovery_items(type, last_seen_at);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  sync_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  fetched INTEGER NOT NULL DEFAULT 0,
  upserted INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  pruned INTEGER NOT NULL DEFAULT 0,
  message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_type_started
  ON sync_runs(sync_type, started_at);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
