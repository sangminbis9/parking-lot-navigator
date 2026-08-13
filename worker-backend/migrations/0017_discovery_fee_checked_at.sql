-- 요금 backfill이 이미 조회한 행을 다시 조회하지 않도록 하는 표식.
-- 조회 결과가 "요금 정보 없음"이어도 시각을 남겨, 예산이 정보 없는 행에
-- 계속 소모되는 것을 막는다.
ALTER TABLE discovery_items ADD COLUMN fee_checked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_discovery_items_fee_backfill
  ON discovery_items(source, fee_checked_at);
