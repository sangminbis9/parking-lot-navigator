-- 프로그램/출연진 정보(KOPIS prfcast·prfcrew·dtguidance, TourAPI program·subevent)는
-- 요금과 마찬가지로 항목별 detail 응답에만 있다. 요금 backfill이 detail을 열면서
-- 요금만 뽑고 나머지를 버려 왔기 때문에, fee_checked_at이 찍힌 행에도 programInfo가
-- 비어 있다. 어느 행의 프로그램 정보를 이미 조회했는지 따로 추적해야 같은 detail을
-- 무한히 다시 열지 않는다.
ALTER TABLE discovery_items ADD COLUMN program_checked_at TEXT;

-- backfill 대상 조회(source로 좁힌 뒤 미조회 행만)를 받친다.
CREATE INDEX IF NOT EXISTS idx_discovery_program_checked_at
  ON discovery_items(source, program_checked_at);
