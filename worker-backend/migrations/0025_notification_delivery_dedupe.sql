-- 물리 기기 하나에 같은 알림이 여러 번 나가는 구조를 없앤다.
--
-- 0023은 notification_devices.apns_token에 UNIQUE가 없어서, 앱이 device_id를 새로 만들면
-- (재설치·앱 그룹 초기화) 같은 APNs 토큰을 든 행이 여러 개 남는다. notification_sends의
-- PK는 (device_id, event_id, notification_type)이라 그 경우 같은 행사에 대해 device 수만큼
-- 대기 행이 생기고, 발송도 그 수만큼 나간다. 아래 순서로 정리한 뒤 제약을 건다.

-- 1) canonical device를 정한다: 같은 (환경, 토큰) 중 updated_at이 가장 최근인 행,
--    동률이면 device_id가 큰 행. 결정적이라 재실행해도 같은 결과다.
--
-- 1-a) canonical이 아직 대기 중인데 중복 device 쪽은 이미 보낸 조합이면, canonical의
--      대기 행을 지운다. 그래야 1-b의 INSERT OR IGNORE가 "보냈음" 상태를 살려 넣는다.
WITH ranked AS (
  SELECT device_id, apns_environment, apns_token,
         ROW_NUMBER() OVER (
           PARTITION BY apns_environment, apns_token
           ORDER BY updated_at DESC, device_id DESC
         ) AS rn
    FROM notification_devices
   WHERE apns_token IS NOT NULL AND apns_token <> ''
)
DELETE FROM notification_sends
 WHERE sent_at IS NULL
   AND EXISTS (
     SELECT 1
       FROM ranked canon
       JOIN ranked dup
         ON dup.apns_environment = canon.apns_environment
        AND dup.apns_token = canon.apns_token
        AND dup.rn > 1
       JOIN notification_sends old
         ON old.device_id = dup.device_id
        AND old.event_id = notification_sends.event_id
        AND old.notification_type = notification_sends.notification_type
      WHERE canon.rn = 1
        AND canon.device_id = notification_sends.device_id
        AND old.sent_at IS NOT NULL
   );

-- 1-b) 중복 device의 발송 이력을 canonical로 옮긴다. 재설치로 device_id가 바뀌어도
--      이미 보낸 D-7이 다시 나가지 않게 하는 부분이다.
WITH ranked AS (
  SELECT device_id, apns_environment, apns_token,
         ROW_NUMBER() OVER (
           PARTITION BY apns_environment, apns_token
           ORDER BY updated_at DESC, device_id DESC
         ) AS rn
    FROM notification_devices
   WHERE apns_token IS NOT NULL AND apns_token <> ''
)
INSERT OR IGNORE INTO notification_sends (
  device_id, event_id, notification_type, event_kind, event_title,
  event_start_date, planned_at, sent_at, attempts, last_error
)
SELECT canon.device_id, s.event_id, s.notification_type, s.event_kind, s.event_title,
       s.event_start_date, s.planned_at, s.sent_at, s.attempts, s.last_error
  FROM notification_sends s
  JOIN ranked dup ON dup.device_id = s.device_id AND dup.rn > 1
  JOIN ranked canon
    ON canon.apns_environment = dup.apns_environment
   AND canon.apns_token = dup.apns_token
   AND canon.rn = 1;

-- 1-c) 옮긴 원본을 지운다.
WITH ranked AS (
  SELECT device_id,
         ROW_NUMBER() OVER (
           PARTITION BY apns_environment, apns_token
           ORDER BY updated_at DESC, device_id DESC
         ) AS rn
    FROM notification_devices
   WHERE apns_token IS NOT NULL AND apns_token <> ''
)
DELETE FROM notification_sends
 WHERE device_id IN (SELECT device_id FROM ranked WHERE rn > 1);

-- 1-d) 중복 device의 토큰을 비운다. 행 자체는 남겨 설정 이력을 잃지 않는다.
WITH ranked AS (
  SELECT device_id,
         ROW_NUMBER() OVER (
           PARTITION BY apns_environment, apns_token
           ORDER BY updated_at DESC, device_id DESC
         ) AS rn
    FROM notification_devices
   WHERE apns_token IS NOT NULL AND apns_token <> ''
)
UPDATE notification_devices
   SET apns_token = NULL
 WHERE device_id IN (SELECT device_id FROM ranked WHERE rn > 1);

-- 2) 같은 (환경, 토큰)을 두 device가 동시에 들 수 없게 한다. NULL/빈 문자열은 제외해야
--    토큰 없는 기기 여러 대가 서로 충돌하지 않는다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_devices_token
  ON notification_devices (apns_environment, apns_token)
  WHERE apns_token IS NOT NULL AND apns_token <> '';

-- 3) 발송 선점(claim). SELECT → APNs → UPDATE 사이에 다른 invocation이 같은 행을 집어
--    두 번 보내는 경합을 막는다. claim_id가 붙은 행은 그 회차가 소유한다.
ALTER TABLE notification_sends ADD COLUMN claim_id TEXT;
ALTER TABLE notification_sends ADD COLUMN claimed_at TEXT;

-- 대기 행 스캔은 (sent_at, claimed_at)으로 좁힌다. 선점되지 않았거나 오래된 선점만 잡는다.
CREATE INDEX IF NOT EXISTS idx_notification_sends_claim
  ON notification_sends (sent_at, claimed_at);
