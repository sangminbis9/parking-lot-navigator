-- 배치 대상 선정 SELECT들이 매 회차 소스 전체를 훑던 것을 인덱스로 좁힌다.
-- 2026-09-06 wrangler d1 insights 24시간 창 실측(회차당 읽는 행 × 하루 회차):
--   태깅 대상        7,685행 × 66회 = 507,272행  (실제 매칭 0건)
--   요금 대상        5,628행 × 61회 = 343,334행  (실제 매칭 12건)
--   요금 backlog 집계 5,627행 × 62회 = 348,874행  (아무도 안 읽는 보고값 — 코드에서 제거)
--   프로그램 크롤    1,725행 × 144회 = 248,441행 (실제 매칭 206건)
--   좌표 대상        3,753행 × 60회 = 225,228행  (후처리 뒤 실제 풀 1,355건)
--
-- 전부 부분 인덱스(partial index)다. 대상이 "아직 안 채운 행"이라 채워지면
-- 인덱스에서 빠져나가므로, 인덱스 크기가 적체 크기를 따라간다 —
-- 전체 인덱스보다 읽기도 쓰기도 싸다.
--
-- 주의: SQLite는 부분 인덱스를 쿼리의 WHERE가 인덱스의 WHERE를 **구조적으로**
-- 함의할 때만 쓴다. 아래 술어는 대상 쿼리에 문자 그대로 같은 항이 있어야 한다.
-- COALESCE 식도 마찬가지라 `backfillRetry.ts`의 FUTURE_END_DATE_EXPR과 같이 고친다.

-- ② 태깅 대상 (llmTagging.fetchFestivalRows, incremental 모드)
CREATE INDEX IF NOT EXISTS idx_discovery_tagging_pending
  ON discovery_items (tagging_version, tagged_at)
  WHERE tagging_version <= 0;

-- ③ 요금·프로그램 detail backfill 대상 (feeBackfill)
CREATE INDEX IF NOT EXISTS idx_discovery_fee_pending
  ON discovery_items (source, COALESCE(end_date, '9999-12-31'))
  WHERE fee_filled_at IS NULL OR program_filled_at IS NULL;

-- ④ 프로그램 웹 크롤 대상 (programCrawl.selectProgramCrawlTargets)
CREATE INDEX IF NOT EXISTS idx_discovery_program_pending
  ON discovery_items (source, COALESCE(end_date, '9999-12-31'))
  WHERE program_filled_at IS NULL;

-- ⑤ 좌표 backfill 대상 (geocodeBackfill.backfillDiscoveryItems)
-- 0020이 만든 (geocode_checked_at, start_date)를 대체한다. 그 인덱스는
-- geocode_checked_at IS NULL 3,753행 전부를 훑은 뒤 end_date로 걸러내 절반 넘게
-- 버렸다. 소비자가 이 쿼리 하나뿐이라 교체해도 다른 쿼리가 잃는 것이 없다.
DROP INDEX IF EXISTS idx_discovery_items_geocode_checked;

CREATE INDEX IF NOT EXISTS idx_discovery_geocode_pending
  ON discovery_items (end_date, start_date)
  WHERE geocode_checked_at IS NULL;
