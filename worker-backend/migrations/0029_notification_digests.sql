-- 다가오는 행사 알림의 저장 단위를 (기기 × 행사 × 종류)에서 (기기 × 기준일 × 종류)로 옮긴다.
--
-- 왜: notification_sends는 인덱스가 3개(PK autoindex + _pending + _claim)라 계획 행 1건이
-- D1 쓰기 4행이었다. 하루 시작 행사가 평균 30건이므로 기기 하나가 D-30/D-7/D-1 세 날짜에
-- 대략 90행 = 360 쓰기행을 썼고, 기기 100대면 하루 36,000행으로 무료 쓰기 예산의 3분의 1을
-- 알림만으로 태웠다. 실제로 나가는 push는 기기당 하루 최대 3건인데 저장은 그 30배였다.
--
-- 어떻게: 발송 단위 하나가 행 하나다. 어떤 행사가 담기는지는 저장하지 않고 발송 시점에
-- 계획 때와 같은 규칙(정확히 D-30/D-7/D-1에 시작 + 지역·카테고리 매칭)으로 다시 계산한다.
-- 오프셋이 구간이 아니라 그 하루라서 같은 질의가 같은 집합을 준다. event_count는 계획 시점의
-- 참고값일 뿐 발송 내용을 결정하지 않는다.
--
-- 보조 인덱스를 일부러 만들지 않는다. 대기 조회는 (sent_at IS NULL AND send_day >= ?)인데
-- 이 테이블은 기기 수 × 3 × 보관일수라 작고, 인덱스 하나가 계획 행마다 쓰기 1행을 더한다.
-- 읽기 예산은 한도의 27%로 여유가 있고 쓰기가 병목이므로 스캔을 택한다.
CREATE TABLE IF NOT EXISTS notification_digests (
  device_id TEXT NOT NULL,
  send_day TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  planned_at TEXT NOT NULL,
  sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  claim_id TEXT,
  claimed_at TEXT,
  PRIMARY KEY (device_id, send_day, notification_type)
);

-- 전환일 중복 방지. 옛 테이블에서 이미 발송된 이력을 KST 기준일로 접어 옮긴다.
-- planned_at/sent_at은 UTC ISO라 +9시간 뒤 앞 10자가 KST 날짜다. 같은 (기기, 날짜, 종류)에
-- 여러 행이 접히므로 MIN/MAX로 하나만 남긴다. sent_at이 NULL인(아직 안 보낸) 옛 행은
-- 옮기지 않는다 — 새 계획이 곧 같은 조합을 다시 만들고, 그때 보내면 된다.
INSERT OR IGNORE INTO notification_digests (
    device_id, send_day, notification_type, event_count, planned_at, sent_at, attempts
  )
  SELECT device_id,
         substr(datetime(sent_at, '+9 hours'), 1, 10),
         notification_type,
         COUNT(*),
         MIN(planned_at),
         MAX(sent_at),
         MAX(attempts)
    FROM notification_sends
   WHERE sent_at IS NOT NULL
   GROUP BY device_id, substr(datetime(sent_at, '+9 hours'), 1, 10), notification_type;

-- notification_sends는 남겨 둔다. 롤백 시 되돌아갈 곳이고, 이미 보낸 이력의 원본이다.
