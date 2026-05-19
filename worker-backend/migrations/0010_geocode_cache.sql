CREATE TABLE IF NOT EXISTS geocode_cache (
  query TEXT PRIMARY KEY,
  found INTEGER NOT NULL,
  lat REAL,
  lng REAL,
  address TEXT,
  venue TEXT,
  cached_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_geocode_cache_cached_at
  ON geocode_cache (cached_at);
