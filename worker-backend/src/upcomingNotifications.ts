// 다가오는 행사 알림(D-30 / D-7 / D-1)의 계획과 발송.
//
// 계획(plan)과 발송(dispatch)을 나눈 이유:
//  - 계획은 D1만 건드리고 외부 fetch를 쓰지 않는다.
//  - 발송은 항목당 APNs fetch를 1건 쓴다. Worker invocation당 외부 fetch가 50건이라
//    한 회차에 보낼 수 있는 양이 제한되는데, 못 보낸 행은 sent_at IS NULL로 남아
//    다음 회차에 그대로 다시 잡힌다. 상한에 걸렸다고 대상이 사라지지 않는다.
//
// 중복 발송 방지는 notification_sends의 PK (device_id, event_id, notification_type)가
// 담당한다. cron이 몇 번을 돌든 같은 조합은 한 행뿐이고, 성공하면 sent_at이 채워진다.

import { matchesRegions } from "./regionMatch.js";
import {
  type ApnsSender,
  isPermanentTokenFailure,
} from "./apns.js";

export type NotificationType = "D30" | "D7" | "D1";

/** 시작일 기준 정확히 며칠 전에 보낼지. 구간(8~30일)이 아니라 그 날짜 하루다. */
export const UPCOMING_OFFSETS: { days: number; type: NotificationType }[] = [
  { days: 30, type: "D30" },
  { days: 7, type: "D7" },
  { days: 1, type: "D1" },
];

export type EventKind = "festival" | "local_event";

export type UpcomingEvent = {
  id: string;
  kind: EventKind;
  title: string;
  address: string;
  startDate: string;
  primaryCategory: string | null;
};

export type NotificationDevice = {
  device_id: string;
  apns_token: string | null;
  apns_environment: string;
  festival_enabled: number;
  festival_regions: string;
  festival_categories: string;
  local_event_enabled: number;
  local_event_regions: string;
  local_event_categories: string;
  quiet_hours_enabled: number;
  quiet_start_hour: number;
  quiet_end_hour: number;
};

export type PendingSend = {
  device_id: string;
  event_id: string;
  notification_type: NotificationType;
  event_kind: EventKind;
  event_title: string;
  event_start_date: string;
  attempts: number;
};

// ---------------------------------------------------------------- 날짜 유틸

/** now를 Asia/Seoul 기준 "yyyy-MM-dd"로. 서버는 UTC로 돌지만 사용자 날짜는 KST다. */
export function seoulDayString(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export function seoulHour(now: Date): number {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
}

export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + delta * 86400000)
    .toISOString()
    .slice(0, 10);
}

/** 오늘(KST) 기준으로 각 알림 종류가 노리는 시작일. D30이면 오늘+30일이다. */
export function targetDates(today: string): { type: NotificationType; date: string }[] {
  return UPCOMING_OFFSETS.map(({ days, type }) => ({
    type,
    date: addDays(today, days),
  }));
}

export function isWithinQuietHours(
  hour: number,
  startHour: number,
  endHour: number,
): boolean {
  if (startHour === endHour) return false;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

// ---------------------------------------------------------------- 매칭

function parseList(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** 카테고리는 비어 있으면 전체, 값이 있으면 그 카테고리만. 지역과 AND 관계다. */
function matchesCategories(
  primaryCategory: string | null,
  categories: string[],
): boolean {
  if (categories.length === 0) return true;
  if (!primaryCategory) return false;
  return categories.includes(primaryCategory);
}

export function deviceWantsEvent(
  device: NotificationDevice,
  event: UpcomingEvent,
): boolean {
  const enabled =
    event.kind === "festival"
      ? device.festival_enabled === 1
      : device.local_event_enabled === 1;
  if (!enabled) return false;
  const regions = parseList(
    event.kind === "festival" ? device.festival_regions : device.local_event_regions,
  );
  const categories = parseList(
    event.kind === "festival"
      ? device.festival_categories
      : device.local_event_categories,
  );
  return (
    matchesRegions(event.address, regions) &&
    matchesCategories(event.primaryCategory, categories)
  );
}

/** 같은 행사가 여러 provider로 중복 저장돼 있으면 알림도 중복된다. 제목+시작일로 하나만 남긴다. */
export function dedupeEvents(events: UpcomingEvent[]): UpcomingEvent[] {
  const seen = new Set<string>();
  const result: UpcomingEvent[] = [];
  for (const event of events) {
    const key = `${event.kind}|${event.title.replace(/\s+/g, "")}|${event.startDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(event);
  }
  return result;
}

// ---------------------------------------------------------------- 계획

export async function loadUpcomingEvents(
  db: D1Database,
  dates: string[],
): Promise<UpcomingEvent[]> {
  const placeholders = dates.map(() => "?").join(",");
  const festivals = await db
    .prepare(
      `SELECT source_item_id AS id, title, address, start_date, primary_category
         FROM discovery_items
        WHERE type = 'festival' AND start_date IN (${placeholders})`,
    )
    .bind(...dates)
    .all<{
      id: string;
      title: string;
      address: string;
      start_date: string;
      primary_category: string | null;
    }>();
  const localEvents = await db
    .prepare(
      `SELECT id, title, address, start_date, primary_category
         FROM local_events
        WHERE status = 'approved' AND start_date IN (${placeholders})`,
    )
    .bind(...dates)
    .all<{
      id: string;
      title: string;
      address: string;
      start_date: string;
      primary_category: string | null;
    }>();

  const mapped: UpcomingEvent[] = [
    ...(festivals.results ?? []).map((row) => ({
      id: row.id,
      kind: "festival" as const,
      title: row.title ?? "",
      address: row.address ?? "",
      startDate: row.start_date,
      primaryCategory: row.primary_category,
    })),
    ...(localEvents.results ?? []).map((row) => ({
      id: row.id,
      kind: "local_event" as const,
      title: row.title ?? "",
      address: row.address ?? "",
      startDate: row.start_date,
      primaryCategory: row.primary_category,
    })),
  ];
  return dedupeEvents(mapped.filter((event) => event.title.length > 0));
}

export async function loadActiveDevices(
  db: D1Database,
): Promise<NotificationDevice[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM notification_devices
        WHERE apns_token IS NOT NULL AND apns_token <> ''
          AND (festival_enabled = 1 OR local_event_enabled = 1)`,
    )
    .all<NotificationDevice>();
  return rows.results ?? [];
}

const PLAN_INSERT_SQL = `INSERT OR IGNORE INTO notification_sends (
    device_id, event_id, notification_type, event_kind,
    event_title, event_start_date, planned_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`;

/**
 * 오늘(KST) 기준 D-30 / D-7 / D-1에 해당하는 행사를 찾아 기기별 발송 대기 행을 만든다.
 * 이미 있는 조합은 INSERT OR IGNORE로 무시되므로 cron이 하루에 여러 번 돌아도 안전하다.
 */
export async function planUpcomingNotifications(
  db: D1Database,
  now: Date = new Date(),
): Promise<{ planned: number; events: number; devices: number }> {
  const today = seoulDayString(now);
  const targets = targetDates(today);
  const events = await loadUpcomingEvents(
    db,
    targets.map((target) => target.date),
  );
  if (events.length === 0) return { planned: 0, events: 0, devices: 0 };
  const devices = await loadActiveDevices(db);
  if (devices.length === 0) {
    return { planned: 0, events: events.length, devices: 0 };
  }

  const typeByDate = new Map(targets.map((target) => [target.date, target.type]));
  const plannedAt = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  const insert = db.prepare(PLAN_INSERT_SQL);
  for (const device of devices) {
    for (const event of events) {
      const type = typeByDate.get(event.startDate);
      if (!type) continue;
      if (!deviceWantsEvent(device, event)) continue;
      statements.push(
        insert.bind(
          device.device_id,
          event.id,
          type,
          event.kind,
          event.title,
          event.startDate,
          plannedAt,
        ),
      );
    }
  }
  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50));
  }
  return {
    planned: statements.length,
    events: events.length,
    devices: devices.length,
  };
}

// ---------------------------------------------------------------- 발송

const TYPE_PHRASE: Record<NotificationType, string> = {
  D30: "30일 남았어요",
  D7: "7일 남았어요",
  D1: "내일 시작해요",
};

function displayDate(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  return `${month}월 ${date}일`;
}

/**
 * 한 기기의 같은 알림 종류 대기 항목을 알림 하나로 만든다. 여러 건이면 묶음 알림으로
 * 보내되 대상 행 전부를 발송 완료로 처리한다 — "앞의 N개만 보내고 나머지는 버린다"가 아니다.
 */
export function buildNotification(
  type: NotificationType,
  rows: PendingSend[],
): { title: string; body: string; data: Record<string, string> } {
  const phrase = TYPE_PHRASE[type];
  if (rows.length === 1) {
    const row = rows[0];
    const emoji = row.event_kind === "local_event" ? "🏪" : "🎪";
    return {
      title: `${emoji} ${row.event_title}`,
      body: `${phrase} · ${displayDate(row.event_start_date)} 시작`,
      data: {
        eventKind: row.event_kind,
        eventId: row.event_id,
        notificationType: type,
      },
    };
  }
  const names = rows
    .slice(0, 2)
    .map((row) => row.event_title)
    .join(", ");
  return {
    title: `🎪 다가오는 행사 ${rows.length}건`,
    body: `${phrase} · ${names} 외 ${rows.length - 2}건`.replace(
      " 외 0건",
      "",
    ),
    data: { eventKind: "digest", notificationType: type },
  };
}

export type DispatchOptions = {
  /** 한 회차 APNs 호출 상한. invocation당 외부 fetch 50건 한도 안에 들어야 한다. */
  maxPushes?: number;
  now?: Date;
};

export type DispatchResult = {
  sent: number;
  rowsMarked: number;
  failed: number;
  skippedQuietHours: number;
  clearedTokens: number;
};

export async function dispatchPendingNotifications(
  db: D1Database,
  sender: ApnsSender,
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  const maxPushes = options.maxPushes ?? 40;
  const now = options.now ?? new Date();
  const result: DispatchResult = {
    sent: 0,
    rowsMarked: 0,
    failed: 0,
    skippedQuietHours: 0,
    clearedTokens: 0,
  };

  const pendingRows = await db
    .prepare(
      `SELECT device_id, event_id, notification_type, event_kind,
              event_title, event_start_date, attempts
         FROM notification_sends
        WHERE sent_at IS NULL
        ORDER BY device_id, notification_type, event_start_date
        LIMIT 1000`,
    )
    .all<PendingSend>();
  const pending = pendingRows.results ?? [];
  if (pending.length === 0) return result;

  const byDevice = new Map<string, PendingSend[]>();
  for (const row of pending) {
    const bucket = byDevice.get(row.device_id);
    if (bucket) bucket.push(row);
    else byDevice.set(row.device_id, [row]);
  }

  const devices = await loadActiveDevices(db);
  const deviceById = new Map(devices.map((device) => [device.device_id, device]));
  const hour = seoulHour(now);
  const sentAt = now.toISOString();

  let budget = maxPushes;
  for (const [deviceId, rows] of byDevice) {
    if (budget <= 0) break;
    const device = deviceById.get(deviceId);
    // 알림을 껐거나 토큰이 없는 기기는 발송 대상이 아니다. 행은 남겨 두었다가
    // 다시 켜면 그때 나간다.
    if (!device || !device.apns_token) continue;
    if (
      device.quiet_hours_enabled === 1 &&
      isWithinQuietHours(hour, device.quiet_start_hour, device.quiet_end_hour)
    ) {
      result.skippedQuietHours += 1;
      continue;
    }

    const byType = new Map<NotificationType, PendingSend[]>();
    for (const row of rows) {
      const bucket = byType.get(row.notification_type);
      if (bucket) bucket.push(row);
      else byType.set(row.notification_type, [row]);
    }

    for (const [type, typeRows] of byType) {
      if (budget <= 0) break;
      const content = buildNotification(type, typeRows);
      budget -= 1;
      const outcome = await sender.send(
        device.apns_token,
        device.apns_environment,
        {
          title: content.title,
          body: content.body,
          threadId: `upcoming-${type}`,
          data: content.data,
        },
      );
      if (outcome.ok) {
        result.sent += 1;
        result.rowsMarked += typeRows.length;
        await db.batch(
          typeRows.map((row) =>
            db
              .prepare(
                `UPDATE notification_sends SET sent_at = ?, attempts = attempts + 1
                  WHERE device_id = ? AND event_id = ? AND notification_type = ?`,
              )
              .bind(sentAt, row.device_id, row.event_id, row.notification_type),
          ),
        );
        continue;
      }

      result.failed += 1;
      const reason = `${outcome.status}${outcome.reason ? ` ${outcome.reason}` : ""}`;
      await db.batch(
        typeRows.map((row) =>
          db
            .prepare(
              `UPDATE notification_sends SET attempts = attempts + 1, last_error = ?
                WHERE device_id = ? AND event_id = ? AND notification_type = ?`,
            )
            .bind(reason, row.device_id, row.event_id, row.notification_type),
        ),
      );
      if (isPermanentTokenFailure(outcome)) {
        // 죽은 토큰으로 계속 재시도하면 예산만 태운다. 토큰만 비우고 대기 행은 남긴다.
        await db
          .prepare(
            `UPDATE notification_devices SET apns_token = NULL, updated_at = ?
              WHERE device_id = ?`,
          )
          .bind(sentAt, deviceId)
          .run();
        result.clearedTokens += 1;
        break;
      }
    }
  }
  return result;
}
