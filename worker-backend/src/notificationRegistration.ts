// 알림 기기 등록. 로그인 시스템이 없어 앱이 만든 익명 device id가 키다.
//
// 여기서 중요한 건 토큰 소유권 이전이다. 앱을 지웠다 깔거나 앱 그룹 저장소가 비면
// device id는 새로 생기지만 APNs 토큰은 같을 수 있다. 예전에는 그때 같은 토큰을 든 행이
// 둘 남았고, 발송이 device 단위라 한 대에 같은 알림이 두 번 갔다. 이제는 새 device가
// 토큰을 넘겨받고 옛 device는 토큰을 잃는다 — 어느 순간에도 (환경, 토큰)의 주인은 하나다.

export type NotificationRegistration = {
  deviceId: string;
  apnsToken: string | null;
  apnsEnvironment: string;
  festival: { enabled: boolean; regions: string[]; categories: string[] };
  localEvent: { enabled: boolean; regions: string[]; categories: string[] };
  quietHours: { enabled: boolean; startHour: number; endHour: number };
};

const UPSERT_SQL = `INSERT INTO notification_devices (
    device_id, apns_token, apns_environment,
    festival_enabled, festival_regions, festival_categories,
    local_event_enabled, local_event_regions, local_event_categories,
    quiet_hours_enabled, quiet_start_hour, quiet_end_hour,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(device_id) DO UPDATE SET
    apns_token = COALESCE(excluded.apns_token, notification_devices.apns_token),
    apns_environment = excluded.apns_environment,
    festival_enabled = excluded.festival_enabled,
    festival_regions = excluded.festival_regions,
    festival_categories = excluded.festival_categories,
    local_event_enabled = excluded.local_event_enabled,
    local_event_regions = excluded.local_event_regions,
    local_event_categories = excluded.local_event_categories,
    quiet_hours_enabled = excluded.quiet_hours_enabled,
    quiet_start_hour = excluded.quiet_start_hour,
    quiet_end_hour = excluded.quiet_end_hour,
    updated_at = excluded.updated_at`;

/**
 * 옛 device의 발송 이력을 새 device로 옮긴 뒤 옛 device의 토큰을 비운다.
 * 이력을 먼저 옮기는 이유: 재설치로 device id가 바뀌었다고 이미 보낸 D-7이 다시 나가면
 * 사용자에겐 그냥 중복 알림이다.
 */
async function transferOwnership(
  db: D1Database,
  fromDeviceId: string,
  toDeviceId: string,
  now: string,
): Promise<void> {
  await db.batch([
    // 새 device에 없는 조합은 상태(sent_at 포함)째로 복사한다.
    db
      .prepare(
        `INSERT OR IGNORE INTO notification_sends (
            device_id, event_id, notification_type, event_kind, event_title,
            event_start_date, planned_at, sent_at, attempts, last_error
          )
          SELECT ?, event_id, notification_type, event_kind, event_title,
                 event_start_date, planned_at, sent_at, attempts, last_error
            FROM notification_sends
           WHERE device_id = ?`,
      )
      .bind(toDeviceId, fromDeviceId),
    // 이미 있던 조합이 대기 중이고 옛 쪽이 보낸 상태면 "보냈음"을 살린다.
    db
      .prepare(
        `UPDATE notification_sends
            SET sent_at = (
                  SELECT old.sent_at FROM notification_sends old
                   WHERE old.device_id = ?
                     AND old.event_id = notification_sends.event_id
                     AND old.notification_type = notification_sends.notification_type
                )
          WHERE device_id = ?
            AND sent_at IS NULL
            AND EXISTS (
                  SELECT 1 FROM notification_sends old
                   WHERE old.device_id = ?
                     AND old.event_id = notification_sends.event_id
                     AND old.notification_type = notification_sends.notification_type
                     AND old.sent_at IS NOT NULL
                )`,
      )
      .bind(fromDeviceId, toDeviceId, fromDeviceId),
    db.prepare(`DELETE FROM notification_sends WHERE device_id = ?`).bind(fromDeviceId),
    // 설정 이력은 남기고 토큰만 뗀다. 발송 대상 조회는 토큰이 있는 행만 본다.
    db
      .prepare(
        `UPDATE notification_devices SET apns_token = NULL, updated_at = ?
          WHERE device_id = ?`,
      )
      .bind(now, fromDeviceId),
  ]);
}

async function claimTokenAndUpsert(
  db: D1Database,
  input: NotificationRegistration,
  now: string,
): Promise<string[]> {
  const transferred: string[] = [];
  if (input.apnsToken) {
    const others = await db
      .prepare(
        `SELECT device_id FROM notification_devices
          WHERE apns_environment = ? AND apns_token = ? AND device_id <> ?`,
      )
      .bind(input.apnsEnvironment, input.apnsToken, input.deviceId)
      .all<{ device_id: string }>();
    for (const row of others.results ?? []) {
      await transferOwnership(db, row.device_id, input.deviceId, now);
      transferred.push(row.device_id);
    }
  }
  await db
    .prepare(UPSERT_SQL)
    .bind(
      input.deviceId,
      input.apnsToken ?? null,
      input.apnsEnvironment,
      input.festival.enabled ? 1 : 0,
      JSON.stringify(input.festival.regions),
      JSON.stringify(input.festival.categories),
      input.localEvent.enabled ? 1 : 0,
      JSON.stringify(input.localEvent.regions),
      JSON.stringify(input.localEvent.categories),
      input.quietHours.enabled ? 1 : 0,
      input.quietHours.startHour,
      input.quietHours.endHour,
      now,
      now,
    )
    .run();
  return transferred;
}

export async function registerNotificationDevice(
  db: D1Database,
  input: NotificationRegistration,
  now: string,
): Promise<{ transferredFrom: string[] }> {
  try {
    return { transferredFrom: await claimTokenAndUpsert(db, input, now) };
  } catch (error) {
    // 0025의 부분 UNIQUE 인덱스가 최종 방어선이다. 두 등록 요청이 같은 토큰을 두고
    // 겹치면 늦은 쪽이 여기로 온다 — 소유권 정리를 다시 한 번 하고 재시도한다.
    if (!String(error).includes("UNIQUE")) throw error;
    return { transferredFrom: await claimTokenAndUpsert(db, input, now) };
  }
}
