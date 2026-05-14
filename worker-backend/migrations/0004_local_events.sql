DELETE FROM discovery_items
WHERE type = 'event'
  AND EXISTS (
    SELECT 1
    FROM discovery_items AS existing
    WHERE existing.type = 'festival'
      AND existing.source = discovery_items.source
      AND existing.source_item_id = discovery_items.source_item_id
  );

UPDATE discovery_items
SET type = 'festival',
    id = 'festival:' || source || ':' || source_item_id
WHERE type = 'event';

CREATE TABLE IF NOT EXISTS local_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  benefit TEXT,
  event_type TEXT NOT NULL DEFAULT 'etc'
    CHECK (event_type IN ('discount', 'freebie', 'review_event', 'popup', 'limited_menu', 'opening_event', 'etc')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  source TEXT NOT NULL
    CHECK (source IN ('instagram', 'owner_submitted', 'admin_manual', 'user_report', 'official_site', 'other')),
  source_url TEXT,
  source_item_id TEXT,
  image_url TEXT,
  store_name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  lat REAL,
  lng REAL,
  start_date TEXT,
  end_date TEXT,
  confidence_score REAL,
  needs_review INTEGER NOT NULL DEFAULT 1,
  is_sponsored INTEGER NOT NULL DEFAULT 0,
  sponsor_tier TEXT,
  paid_until TEXT,
  priority_score INTEGER NOT NULL DEFAULT 0,
  duplicate_key TEXT NOT NULL,
  raw_payload TEXT,
  rejection_reason TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_events_status_lat_lng
  ON local_events(status, lat, lng);

CREATE INDEX IF NOT EXISTS idx_local_events_status_dates
  ON local_events(status, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_local_events_sponsored
  ON local_events(is_sponsored, paid_until, priority_score);

CREATE UNIQUE INDEX IF NOT EXISTS idx_local_events_source_item
  ON local_events(source, source_item_id)
  WHERE source_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_local_events_duplicate_key
  ON local_events(duplicate_key);

CREATE TABLE IF NOT EXISTS local_event_reports (
  id TEXT PRIMARY KEY,
  local_event_id TEXT,
  source_url TEXT,
  caption_text TEXT,
  store_name TEXT,
  address TEXT,
  image_url TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  FOREIGN KEY (local_event_id) REFERENCES local_events(id)
);

CREATE INDEX IF NOT EXISTS idx_local_event_reports_status_created
  ON local_event_reports(status, created_at);
