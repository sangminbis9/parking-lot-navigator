-- D1 Free Tier(2026-09-01부터 rows read 5,000,000/일, rows written 100,000/일)
-- 안에서 버티기 위한 index 정리. 이 파일은 두 가지를 한다.
--   (1) EXPLAIN QUERY PLAN으로 효과가 확인된 index 하나를 추가한다.
--   (2) 이번 변경으로 소비자가 사라졌음이 증명된 index를 지운다.
--
-- 왜 삭제가 중요한가: discovery_items는 upsert 1건마다 (본체 1행 + index 수)만큼
-- rows written을 쓴다. 실측(2026-08-28 d1 insights) 104,721 writes/일 ÷ 16
-- (본체 + 명시 index 13 + UNIQUE autoindex 2) ≈ 6,545 upsert/일이므로,
-- discovery_items index 하나당 하루 약 6,545 writes = 무료 쓰기 예산의 6.5%다.
-- 안 쓰는 index를 남겨 두는 비용이 read 이득보다 크다.

-- ---------------------------------------------------------------------------
-- 추가: 축제 상세 조회(getFestivalById)의 source_item_id 단건 lookup
-- ---------------------------------------------------------------------------
-- 대상: discoveryCache.ts
--   SELECT * FROM discovery_items
--    WHERE type = 'festival' AND source_item_id = ?
--    ORDER BY last_seen_at DESC LIMIT 1
-- UNIQUE(type, source, source_item_id)는 source가 중간에 있어 이 조회를 못 받는다.
--
-- 기존 plan:  SEARCH discovery_items USING INDEX idx_discovery_items_last_seen (type=?)
--             → type='festival' 전체(6,760행 중 6,760행)를 last_seen_at 역순으로
--               훑으며 source_item_id를 행마다 비교한다. 딥링크 1회당 최대 전량 읽기.
-- 변경 후:    SEARCH discovery_items USING INDEX
--             idx_discovery_items_type_source_item_last_seen (type=? AND source_item_id=?)
--             → 일치하는 소수 행만 읽는다.
--
-- last_seen_at을 3번째 키로 넣은 이유: 2컬럼(type, source_item_id)만으로 만들면
-- 옵티마이저가 ORDER BY last_seen_at DESC LIMIT 1을 공짜로 만족시키는
-- idx_discovery_items_last_seen을 계속 선택해 새 index가 쓰이지 않는다(A/B 실측 확인).
-- SELECT *의 모든 컬럼을 담는 covering index는 만들지 않는다 — 쓰기 비용이 커진다.
CREATE INDEX IF NOT EXISTS idx_discovery_items_type_source_item_last_seen
  ON discovery_items(type, source_item_id, last_seen_at DESC);

-- ---------------------------------------------------------------------------
-- 삭제: 소비자가 사라진 index
-- ---------------------------------------------------------------------------

-- 0022가 pipelineStats의 스칼라 서브쿼리
--   (SELECT MIN(first_seen_at) ... WHERE fee_checked_at IS NULL),
--   (SELECT MAX(fee_checked_at) ...), (SELECT COUNT(*) ... WHERE fee_checked_at >= ?)
-- 를 받치려고 만든 index다. 이번 변경에서 그 서브쿼리들이 discovery_items를
-- 한 번만 훑는 단일 집계(SUM(CASE ...) / MIN(CASE ...) / MAX(...))로 합쳐지면서
-- fee_checked_at을 선두로 하는 조회가 코드에서 완전히 사라졌다.
-- (fee_checked_at은 이제 WHERE 선두가 아니라 집계 CASE 안에서만 등장한다.)
DROP INDEX IF EXISTS idx_discovery_items_fee_checked_at;

-- 위와 같은 이유. 0022가 images_checked_at 스칼라 서브쿼리용으로 만들었고,
-- imageBackfill의 대상 선택은 (source, images_checked_at) 복합 index인
-- idx_discovery_items_images_backfill이 받는다 — 이 단일 컬럼 index는 그 복합
-- index의 접두사도 아니고 남은 소비자도 없다.
DROP INDEX IF EXISTS idx_discovery_items_images_checked_at;

-- 0017이 만든 요금 backfill 대상 조회용 index. 0026에서 요금/프로그램 큐가
-- detail_state 기반으로 바뀌면서 그 조회는 idx_discovery_detail_backfill
-- (source, detail_state, detail_retry_after)이 받고 있다. 선두 컬럼 source가
-- 같으므로 source 단독 탐색도 그 index로 대체된다.
-- 코드 전수 확인: fee_checked_at은 feeBackfill의 쓰기(UPDATE SET)와 pipelineStats의
-- 집계 CASE에만 남았고, WHERE 선두로 쓰이는 곳이 없다.
DROP INDEX IF EXISTS idx_discovery_items_fee_backfill;

-- 0024가 "미조회 행만 고르는 backfill 조회"를 예상하고 만들었지만, 실제 구현은
-- 요금과 프로그램을 detail 응답 한 번으로 함께 채우는 방식(0026)으로 갔다.
-- 전수 확인 결과 program_checked_at은 feeBackfill.ts의 UPDATE SET 두 곳에서만
-- 쓰이고 어떤 WHERE에도 등장하지 않는다. 읽는 쪽이 없는 index다.
DROP INDEX IF EXISTS idx_discovery_program_checked_at;

-- 0011의 단일 컬럼 index. tagging_version은 llmTagging.ts의 증분 조회
--   WHERE type = 'festival' AND (tagging_version = 0 OR tagging_version = -1)
--   ORDER BY last_seen_at DESC LIMIT ?
-- 에 나오지만, EXPLAIN QUERY PLAN은 이 index가 아니라
-- idx_discovery_items_last_seen(type, last_seen_at)을 선택한다 — ORDER BY를 공짜로
-- 만족시키는 쪽이 이기고, 단일 컬럼 index는 행마다 본체 lookup을 강제하기 때문이다.
-- 즉 만들어진 이후로 옵티마이저가 한 번도 고르지 않는 index다.
DROP INDEX IF EXISTS idx_discovery_items_tagging;

-- 삭제하지 않고 남기는 것:
--   idx_discovery_items_type_status_dates — discovery_items.status를 WHERE에 쓰는
--     코드는 없지만, 지금 pipelineStats의 GROUP BY status가 이 index를 covering
--     scan으로 실제 사용한다. "완전히 중복"이 증명되지 않았으므로 남긴다.
--   idx_discovery_items_primary_category — GROUP BY primary_category의 covering scan.
--   idx_discovery_items_geocode_checked / _images_backfill / _detail_backfill —
--     각 backfill 큐의 대상 선택을 실제로 받는다.
--   idx_discovery_items_last_seen / _type_lat_lng / idx_discovery_type_start_date —
--     각각 정리 DELETE, 지도 조회, 알림 계획 조회가 사용한다.
