-- Persistent per-section generations: changes and invalidation commit together.
-- Rows are never deleted, so revision numbers cannot suffer ABA after a retry.
CREATE TABLE snapshot_sections (
  kind TEXT NOT NULL CHECK(kind IN ('discovery','local')),
  bucket INTEGER NOT NULL CHECK(bucket BETWEEN 0 AND 63),
  revision INTEGER NOT NULL DEFAULT 1,
  published_revision INTEGER NOT NULL DEFAULT 0,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(kind,bucket)
);
CREATE INDEX idx_snapshot_pending ON snapshot_sections(kind,bucket) WHERE revision > published_revision;
WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<63)
INSERT INTO snapshot_sections(kind,bucket) SELECT 'discovery',x FROM n UNION ALL SELECT 'local',x FROM n;

ALTER TABLE discovery_items ADD COLUMN snapshot_bucket INTEGER GENERATED ALWAYS AS (((coalesce(unicode(substr(id,-1,1)),0)+coalesce(unicode(substr(id,-2,1)),0)*7+coalesce(unicode(substr(id,-3,1)),0)*13+coalesce(unicode(substr(id,-4,1)),0)*31)%64)) VIRTUAL;
CREATE INDEX idx_discovery_items_snapshot ON discovery_items(snapshot_bucket,id);
CREATE TRIGGER discovery_items_snapshot_insert AFTER INSERT ON discovery_items BEGIN UPDATE snapshot_sections SET revision=revision+1, changed_at = CASE WHEN revision=published_revision THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE changed_at END WHERE kind='discovery' AND bucket=NEW.snapshot_bucket; END;
CREATE TRIGGER discovery_items_snapshot_delete AFTER DELETE ON discovery_items BEGIN UPDATE snapshot_sections SET revision=revision+1, changed_at = CASE WHEN revision=published_revision THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE changed_at END WHERE kind='discovery' AND bucket=OLD.snapshot_bucket; END;
CREATE TRIGGER discovery_items_snapshot_update AFTER UPDATE ON discovery_items
WHEN OLD.id IS NOT NEW.id
 OR OLD.type IS NOT NEW.type
 OR OLD.source IS NOT NEW.source
 OR OLD.source_item_id IS NOT NEW.source_item_id
 OR OLD.title IS NOT NEW.title
 OR OLD.subtitle IS NOT NEW.subtitle
 OR OLD.category_text IS NOT NEW.category_text
 OR OLD.start_date IS NOT NEW.start_date
 OR OLD.end_date IS NOT NEW.end_date
 OR OLD.is_free IS NOT NEW.is_free
 OR OLD.venue_name IS NOT NEW.venue_name
 OR OLD.address IS NOT NEW.address
 OR OLD.lat IS NOT NEW.lat
 OR OLD.lng IS NOT NEW.lng
 OR OLD.lowest_price_text IS NOT NEW.lowest_price_text
 OR OLD.source_url IS NOT NEW.source_url
 OR OLD.image_url IS NOT NEW.image_url
 OR OLD.tags_json IS NOT NEW.tags_json
 OR OLD.raw_payload IS NOT NEW.raw_payload
 OR OLD.primary_category IS NOT NEW.primary_category
 OR OLD.category_tags_json IS NOT NEW.category_tags_json
 OR OLD.images_json IS NOT NEW.images_json
BEGIN
 UPDATE snapshot_sections SET revision=revision+1, changed_at = CASE WHEN revision=published_revision THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE changed_at END WHERE kind='discovery' AND bucket=OLD.snapshot_bucket;
 UPDATE snapshot_sections SET revision=revision+1, changed_at = CASE WHEN revision=published_revision THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE changed_at END WHERE kind='discovery' AND bucket=NEW.snapshot_bucket AND NEW.snapshot_bucket<>OLD.snapshot_bucket;
END;

ALTER TABLE local_events ADD COLUMN snapshot_bucket INTEGER GENERATED ALWAYS AS (((coalesce(unicode(substr(id,-1,1)),0)+coalesce(unicode(substr(id,-2,1)),0)*7+coalesce(unicode(substr(id,-3,1)),0)*13+coalesce(unicode(substr(id,-4,1)),0)*31)%64)) VIRTUAL;
CREATE INDEX idx_local_events_snapshot ON local_events(snapshot_bucket,id);
CREATE TRIGGER local_events_snapshot_insert AFTER INSERT ON local_events BEGIN UPDATE snapshot_sections SET revision=revision+1, changed_at = CASE WHEN revision=published_revision THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE changed_at END WHERE kind='local' AND bucket=NEW.snapshot_bucket; END;
CREATE TRIGGER local_events_snapshot_delete AFTER DELETE ON local_events BEGIN UPDATE snapshot_sections SET revision=revision+1, changed_at = CASE WHEN revision=published_revision THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE changed_at END WHERE kind='local' AND bucket=OLD.snapshot_bucket; END;
CREATE TRIGGER local_events_snapshot_update AFTER UPDATE ON local_events
WHEN OLD.id IS NOT NEW.id
 OR OLD.title IS NOT NEW.title
 OR OLD.description IS NOT NEW.description
 OR OLD.short_description IS NOT NEW.short_description
 OR OLD.benefit IS NOT NEW.benefit
 OR OLD.event_type IS NOT NEW.event_type
 OR OLD.status IS NOT NEW.status
 OR OLD.source IS NOT NEW.source
 OR OLD.source_url IS NOT NEW.source_url
 OR OLD.source_item_id IS NOT NEW.source_item_id
 OR OLD.image_url IS NOT NEW.image_url
 OR OLD.store_name IS NOT NEW.store_name
 OR OLD.address IS NOT NEW.address
 OR OLD.lat IS NOT NEW.lat
 OR OLD.lng IS NOT NEW.lng
 OR OLD.start_date IS NOT NEW.start_date
 OR OLD.end_date IS NOT NEW.end_date
 OR OLD.confidence_score IS NOT NEW.confidence_score
 OR OLD.needs_review IS NOT NEW.needs_review
 OR OLD.is_sponsored IS NOT NEW.is_sponsored
 OR OLD.sponsor_tier IS NOT NEW.sponsor_tier
 OR OLD.paid_until IS NOT NEW.paid_until
 OR OLD.priority_score IS NOT NEW.priority_score
 OR OLD.primary_category IS NOT NEW.primary_category
 OR OLD.category_tags_json IS NOT NEW.category_tags_json
BEGIN
 UPDATE snapshot_sections SET revision=revision+1, changed_at = CASE WHEN revision=published_revision THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE changed_at END WHERE kind='local' AND bucket=OLD.snapshot_bucket;
 UPDATE snapshot_sections SET revision=revision+1, changed_at = CASE WHEN revision=published_revision THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE changed_at END WHERE kind='local' AND bucket=NEW.snapshot_bucket AND NEW.snapshot_bucket<>OLD.snapshot_bucket;
END;
