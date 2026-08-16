-- 지역 대표 좌표(서울시청 등) 위에 쌓인 discovery_items 행을 회차당 조금씩
-- 다시 지오코딩한다. 한 번 시도한 행은 여기에 표시해 같은 행에 매번 예산을
-- 쓰지 않게 하고, 동시에 sync가 좌표를 다시 fallback으로 덮어쓰지 못하게 한다.
ALTER TABLE discovery_items ADD COLUMN geocode_checked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_discovery_items_geocode_checked
  ON discovery_items (geocode_checked_at, start_date);
