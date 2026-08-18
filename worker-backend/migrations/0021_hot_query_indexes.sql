-- D1 행 읽기가 하루 5,000만 건(무료 한도의 10배)까지 오른 원인을 인덱스로 잡는다.
-- 실측 2026-08-18 `wrangler d1 insights` 기준 상위 5개 쿼리가 1,954만 건을 차지했다.

-- Orion(headAgent) / Pixel(imageAgent)의 `NOT EXISTS (... WHERE aa.target_id = ?)`
-- 상관 서브쿼리는 target_id 인덱스가 없어 후보 행마다 agent_activity를 훑었다.
-- Orion 실행당 3,513,719행 · Pixel 실행당 962,251행.
CREATE INDEX IF NOT EXISTS idx_agent_activity_target
  ON agent_activity(target_id, agent_id, action);

-- sync_runs는 (sync_type, started_at) 인덱스만 있어서 sync_type 없이 started_at으로
-- 정렬하거나 status로 거르는 쿼리가 전부 전체 스캔이었다.
-- `ORDER BY started_at DESC LIMIT 15` 실행당 32,115행,
-- `UPDATE ... WHERE status = 'running'` 실행당 15,982행.
CREATE INDEX IF NOT EXISTS idx_sync_runs_started
  ON sync_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_runs_status_started
  ON sync_runs(status, started_at);

-- sync_runs는 지금까지 한 번도 정리하지 않아 100일치 16,093행이 쌓였다.
-- 조회는 최근 24시간 집계와 최근 15건만 쓴다. 30일치만 남긴다.
DELETE FROM sync_runs WHERE started_at < datetime('now', '-30 day');
