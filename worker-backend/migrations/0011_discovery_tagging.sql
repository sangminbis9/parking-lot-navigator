ALTER TABLE discovery_items ADD COLUMN primary_category TEXT;
ALTER TABLE discovery_items ADD COLUMN category_tags_json TEXT;
ALTER TABLE discovery_items ADD COLUMN tagging_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discovery_items ADD COLUMN tagged_at TEXT;
ALTER TABLE discovery_items ADD COLUMN tagging_model TEXT;

CREATE INDEX IF NOT EXISTS idx_discovery_items_tagging
  ON discovery_items(tagging_version);

CREATE INDEX IF NOT EXISTS idx_discovery_items_primary_category
  ON discovery_items(primary_category);
