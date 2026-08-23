-- 다가오는 행사 알림(D-30 / D-7 / D-1)을 서버에서 발송하기 위한 테이블.
-- 기기 UserDefaults 대신 이 두 테이블이 "누구에게 무엇을 언제 보냈는지"의 단일 진실이다.

-- 알림 대상 기기. 로그인 시스템이 없으므로 앱이 만드는 익명 device id를 키로 쓴다.
CREATE TABLE IF NOT EXISTS notification_devices (
  device_id TEXT PRIMARY KEY,
  apns_token TEXT,
  apns_environment TEXT NOT NULL DEFAULT 'production',
  festival_enabled INTEGER NOT NULL DEFAULT 0,
  festival_regions TEXT NOT NULL DEFAULT '[]',
  festival_categories TEXT NOT NULL DEFAULT '[]',
  local_event_enabled INTEGER NOT NULL DEFAULT 0,
  local_event_regions TEXT NOT NULL DEFAULT '[]',
  local_event_categories TEXT NOT NULL DEFAULT '[]',
  quiet_hours_enabled INTEGER NOT NULL DEFAULT 0,
  quiet_start_hour INTEGER NOT NULL DEFAULT 22,
  quiet_end_hour INTEGER NOT NULL DEFAULT 8,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 발송 계획 겸 발송 이력. (device_id, event_id, notification_type)이 PK라서
-- cron이 여러 번 돌아도 같은 조합은 한 행뿐이고, 성공 발송은 sent_at으로 한 번만 남는다.
-- sent_at IS NULL = 아직 못 보낸 대기 항목이며, 보낼 때까지 행이 남으므로 대상이 유실되지 않는다.
CREATE TABLE IF NOT EXISTS notification_sends (
  device_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  event_title TEXT NOT NULL,
  event_start_date TEXT NOT NULL,
  planned_at TEXT NOT NULL,
  sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  PRIMARY KEY (device_id, event_id, notification_type)
);

-- 대기 항목만 훑는 조회를 인덱스로 받친다. sent_at이 선두라 NULL 구간만 스캔한다.
CREATE INDEX IF NOT EXISTS idx_notification_sends_pending
  ON notification_sends(sent_at, device_id);

-- 알림 계획은 "특정 날짜에 시작하는 행사"를 날짜로 직접 찾는다. 기존
-- idx_discovery_type_status_dates는 status가 선두라 이 조회를 받치지 못한다.
CREATE INDEX IF NOT EXISTS idx_discovery_type_start_date
  ON discovery_items(type, start_date);
