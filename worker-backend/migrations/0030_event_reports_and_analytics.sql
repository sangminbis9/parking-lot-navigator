-- 행사 정보 오류 신고와 익명 사용 집계.
--
-- 두 테이블 모두 인덱스를 최소로 둔다. D1 무료 쓰기 한도(10만행/일)에서
-- 쓰기는 인덱스 개수만큼 증폭되기 때문이다.
--
-- analytics_daily는 이벤트를 행마다 쌓지 않고 (날짜, 이벤트, 라벨) 카운터로만
-- 누적한다. 사용자 수가 늘어도 쓰기는 서로 다른 조합 수 × 전송 횟수로 묶인다.
-- 좌표·기기 식별자·세션 id는 애초에 컬럼이 없다.

CREATE TABLE IF NOT EXISTS event_reports (
  id TEXT PRIMARY KEY,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('festival', 'local_event')),
  event_id TEXT NOT NULL,
  event_title TEXT,
  reason TEXT NOT NULL CHECK (reason IN (
    'ended', 'wrong_date', 'wrong_price', 'wrong_place', 'wrong_content', 'duplicate', 'etc'
  )),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

-- 관리자 목록은 미처리 신고를 최신순으로 본다. 이 인덱스 하나만 둔다.
CREATE INDEX IF NOT EXISTS idx_event_reports_status_created
  ON event_reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS analytics_daily (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, event, label)
);
