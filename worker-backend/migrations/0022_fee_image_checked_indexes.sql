-- fee/image backfill 상태 집계(pipelineStats.ts)가 discovery_items를 매번 전체
-- 스캔했다. 기존 인덱스는 둘 다 source가 선두 컬럼이라(0017/0019),
-- source를 안 거르는 전역 MIN/MAX/COUNT는 못 쓴다.
-- 실측 EXPLAIN QUERY PLAN(2026-08-18):
--   MIN(first_seen_at) WHERE fee_checked_at IS NULL   → SEARCH discovery_items (전체 스캔)
--   COUNT(*) WHERE fee_checked_at >= ?                → SCAN ... COVERING INDEX idx_discovery_items_fee_backfill (전체 스캔)
--   COUNT(*) WHERE images_checked_at >= ?              → SCAN ... COVERING INDEX idx_discovery_items_images_backfill (전체 스캔)
-- fee_checked_at 뒤에 first_seen_at을 붙여 IS NULL 구간 안에서 최소값도 인덱스
-- 순서로 바로 찾게 한다. images_checked_at은 그 자체 하나면 충분하다.
CREATE INDEX IF NOT EXISTS idx_discovery_items_fee_checked_at
  ON discovery_items(fee_checked_at, first_seen_at);

CREATE INDEX IF NOT EXISTS idx_discovery_items_images_checked_at
  ON discovery_items(images_checked_at);
