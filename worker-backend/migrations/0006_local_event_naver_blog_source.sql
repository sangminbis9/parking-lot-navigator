DROP INDEX IF EXISTS idx_local_events_source_item;
DROP INDEX IF EXISTS idx_local_events_duplicate_key;
DROP INDEX IF EXISTS idx_local_events_sponsored;
DROP INDEX IF EXISTS idx_local_events_status_dates;
DROP INDEX IF EXISTS idx_local_events_status_lat_lng;

CREATE TABLE local_events_new (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  benefit TEXT,
  event_type TEXT NOT NULL DEFAULT 'etc'
    CHECK (event_type IN ('discount', 'freebie', 'review_event', 'popup', 'limited_menu', 'opening_event', 'etc')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  source TEXT NOT NULL
    CHECK (source IN ('instagram', 'naver_place', 'naver_blog', 'owner_submitted', 'admin_manual', 'user_report', 'official_site', 'other')),
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

INSERT INTO local_events_new (
  id, title, description, benefit, event_type, status, source, source_url, source_item_id,
  image_url, store_name, address, lat, lng, start_date, end_date, confidence_score,
  needs_review, is_sponsored, sponsor_tier, paid_until, priority_score, duplicate_key,
  raw_payload, rejection_reason, approved_at, created_at, updated_at
)
SELECT
  id, title, description, benefit, event_type, status, source, source_url, source_item_id,
  image_url, store_name, address, lat, lng, start_date, end_date, confidence_score,
  needs_review, is_sponsored, sponsor_tier, paid_until, priority_score, duplicate_key,
  raw_payload, rejection_reason, approved_at, created_at, updated_at
FROM local_events;

DROP TABLE local_events;
ALTER TABLE local_events_new RENAME TO local_events;

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
