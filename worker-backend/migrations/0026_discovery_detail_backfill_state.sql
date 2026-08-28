-- detail backfill(요금·프로그램·출연진)의 재조회 정책을 checked_at 하나에서
-- 네 가지 상태로 나눈다. 예전 구조는 "값을 확보했다"와 "조회했지만 원본에 없다"를
-- 같은 fee_checked_at/program_checked_at에 섞어 찍어서, 아직 공개되지 않은 정보가
-- 나중에 올라와도 영원히 다시 보지 않았고, 반대로 일시적 실패(429·5xx·타임아웃)는
-- 아무 표식도 남기지 않아 ORDER BY start_date 선두의 같은 행만 매 회차 다시 잡혔다.
--
--   1) 값 확보 완료      → fee_filled_at / program_filled_at (해당 필드는 재조회 안 함)
--   2) 조회했지만 없음   → detail_state='empty' + detail_retry_after(행사 임박도별 backoff)
--   3) 일시적 실패       → detail_state 유지 + detail_retry_after(지수 backoff), 영구 아님
--   4) 영구적 조회 불필요 → detail_state='nodata' (NODATA·잘못된 id·종료된 행사)
--
-- detail_attempts는 선점(claim) 횟수다. 대상을 고른 직후 올려 두므로 invocation이
-- 도중에 죽어도 다음 회차가 같은 행에 갇히지 않는다.
-- 기존 fee_checked_at/program_checked_at은 "마지막으로 시도한 시각"으로 남겨
-- pipelineStats 대시보드가 그대로 동작한다. 기존 데이터는 지우지 않는다.

ALTER TABLE discovery_items ADD COLUMN fee_filled_at TEXT;
ALTER TABLE discovery_items ADD COLUMN program_filled_at TEXT;
ALTER TABLE discovery_items ADD COLUMN detail_state TEXT;
ALTER TABLE discovery_items ADD COLUMN detail_retry_after TEXT;
ALTER TABLE discovery_items ADD COLUMN detail_attempts INTEGER NOT NULL DEFAULT 0;

-- 이미 값을 확보한 행을 "완료" 상태로 옮긴다. 이 행들은 다시 조회하지 않는다.
UPDATE discovery_items
   SET fee_filled_at = COALESCE(fee_checked_at, synced_at, first_seen_at)
 WHERE fee_filled_at IS NULL
   AND lowest_price_text IS NOT NULL
   AND lowest_price_text <> '';

UPDATE discovery_items
   SET program_filled_at = COALESCE(program_checked_at, synced_at, first_seen_at)
 WHERE program_filled_at IS NULL
   AND json_valid(raw_payload)
   AND COALESCE(json_extract(raw_payload, '$.programInfo'), '') <> '';

-- 선정 쿼리(source로 좁힌 뒤 영구 제외가 아니고 재시도 시각이 지난 행)를 받친다.
CREATE INDEX IF NOT EXISTS idx_discovery_detail_backfill
  ON discovery_items(source, detail_state, detail_retry_after);
