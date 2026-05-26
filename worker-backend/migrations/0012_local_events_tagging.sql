ALTER TABLE local_events ADD COLUMN primary_category TEXT;
ALTER TABLE local_events ADD COLUMN category_tags_json TEXT;
ALTER TABLE local_events ADD COLUMN tagging_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE local_events ADD COLUMN tagged_at TEXT;
ALTER TABLE local_events ADD COLUMN tagging_model TEXT;

CREATE INDEX IF NOT EXISTS idx_local_events_tagging
  ON local_events(tagging_version);

CREATE INDEX IF NOT EXISTS idx_local_events_primary_category
  ON local_events(primary_category);
