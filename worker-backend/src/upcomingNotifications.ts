// 다가오는 행사 알림(D-30 / D-7 / D-1)의 계획과 발송.
//
// 저장 단위가 (기기, 기준일, 알림 종류) 하나다 — 행사별로 행을 쌓지 않는다.
// 어떤 행사가 담기는지는 발송 시점에 계획 때와 같은 규칙으로 다시 계산한다.
// D-30/D-7/D-1이 구간이 아니라 "정확히 그 날짜"이므로, 기준일 하나에 담길 행사 집합은
// 계획 때든 발송 때든 같은 질의로 나온다. 행사 20건이 20행이 아니라 1행이 되고,
// notification_digests에 보조 인덱스가 없어 계획 행 1건이 D1 쓰기 2행에 그친다.
//
// 계획(plan)과 발송(dispatch)을 나눈 이유:
//  - 계획은 D1만 건드리고 외부 fetch를 쓰지 않는다.
//  - 발송은 묶음당 APNs fetch를 1건 쓴다. Worker invocation당 외부 fetch가 50건이라
//    한 회차에 보낼 수 있는 양이 제한되는데, 못 보낸 행은 sent_at IS NULL로 남아
//    다음 회차에 그대로 다시 잡힌다. 상한에 걸렸다고 대상이 사라지지 않는다.
//
// 중복 발송 방지는 세 겹이다. PK 하나로는 부족하다는 걸 운영에서 배웠다.
//  1) notification_digests의 PK (device_id, send_day, notification_type) — 계획 단계 중복.
//  2) 물리 발송 대상(apns_environment + apns_token) 단위 묶기 — device_id가 여러 개여도
//     실제 기기는 한 대다. 0025의 UNIQUE 인덱스가 정상 상태를 보장하고, 발송은 그마저
//     깨졌을 때를 대비해 한 번 더 토큰으로 묶는다.
//  3) claim_id 선점 — SELECT → APNs → UPDATE 사이에 다른 invocation이 끼어드는 경합.
// 그 위에 apns-collapse-id를 얹어 기기 단에서 한 번 더 합쳐지게 한다.

import { matchesRegions } from "./regionMatch.js";
import { seoulDayString, seoulHour } from "./kstDate.js";
import { type ApnsSender, isPermanentTokenFailure } from "./apns.js";

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
  updated_at: string;
};

/**
 * 발송 대기 한 건 = push 한 건. 어떤 행사가 담기는지는 발송 시점에 다시 계산한다.
 * 행사별로 행을 쌓지 않기 때문에 기기 하나가 하루에 쓰는 행이 3건(D30/D7/D1)으로 고정된다.
 */
export type PendingDigest = {
  device_id: string;
  send_day: string;
  notification_type: NotificationType;
  attempts: number;
};

// ---------------------------------------------------------------- 날짜 유틸

export { seoulDayString, seoulHour } from "./kstDate.js";

export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + delta * 86400000)
    .toISOString()
    .slice(0, 10);
}

/** 오늘(KST) 기준으로 각 알림 종류가 노리는 시작일. D30이면 오늘+30일이다. */
export function targetDates(
  today: string,
): { type: NotificationType; date: string }[] {
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
    return Array.isArray(parsed)
      ? parsed.filter((v) => typeof v === "string")
      : [];
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
    event.kind === "festival"
      ? device.festival_regions
      : device.local_event_regions,
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
// ---------------------------------------------------------------- 계획

const PLAN_INSERT_SQL = `INSERT OR IGNORE INTO notification_digests (
    device_id, send_day, notification_type, event_count, planned_at
  ) VALUES (?, ?, ?, ?, ?)`;

/** 지난 회차 기록 보관 기간. 재발송 방지에만 쓰이므로 길게 둘 이유가 없다. */
export const DIGEST_RETENTION_DAYS = 30;

/** 발송이 밀린 묶음을 며칠까지 다시 잡을지. 지난 날짜의 "내일 시작해요"는 이미 틀린 문구다. */
export const DIGEST_MAX_AGE_DAYS = 1;

/** 발송 회차의 기준일(send_day)과 알림 종류로 대상 행사의 시작일을 되돌린다. */
export function targetDateFor(sendDay: string, type: NotificationType): string {
  const offset = UPCOMING_OFFSETS.find((entry) => entry.type === type);
  return offset ? addDays(sendDay, offset.days) : sendDay;
}

/**
 * 오늘(KST) 기준 D-30 / D-7 / D-1에 보낼 것이 있는 기기마다 "발송 예정" 행을 하나씩 만든다.
 * 행사별로 행을 만들지 않는 게 핵심이다 — 어떤 행사가 담기는지는 발송 시점에 같은 규칙으로
 * 다시 계산하므로, 계획 단계에서 굳이 D1에 적어 둘 이유가 없다. 이미 있는 조합은
 * INSERT OR IGNORE로 무시되므로 cron이 하루에 여러 번 돌아도 안전하다.
 */
export async function planUpcomingNotifications(
  db: D1Database,
  now: Date = new Date(),
): Promise<{ planned: number; events: number; devices: number }> {
  const today = seoulDayString(now);
  await db
    .prepare(`DELETE FROM notification_digests WHERE send_day < ?`)
    .bind(addDays(today, -DIGEST_RETENTION_DAYS))
    .run();

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

  const plannedAt = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  const insert = db.prepare(PLAN_INSERT_SQL);
  for (const device of devices) {
    for (const target of targets) {
      const count = events.filter(
        (event) =>
          event.startDate === target.date && deviceWantsEvent(device, event),
      ).length;
      if (count === 0) continue;
      statements.push(
        insert.bind(device.device_id, today, target.type, count, plannedAt),
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

/**
 * 앱 알림센터가 읽는 `notificationKind`. 기기 로컬 알림 producer와 같은 계약이다
 * (`ios-app/Core/Models/AppNotificationItem.swift`의 `AppNotificationKind`).
 * 옛 앱이 읽는 `notificationType`은 그대로 함께 싣는다.
 */
const TYPE_KIND: Record<NotificationType, string> = {
  D30: "upcoming_d30",
  D7: "upcoming_d7",
  D1: "upcoming_d1",
};

/** 묶음 payload에 싣는 행사 수 상한. APNs payload 4KB 한도 때문이다. */
const MAX_DIGEST_PAYLOAD_EVENTS = 20;

function displayDate(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  return `${month}월 ${date}일`;
}

/**
 * 한 기기의 같은 알림 종류 대상 행사를 알림 하나로 만든다. 여러 건이면 묶음 알림이 되고,
 * 이때 딥링크는 개별 행사가 아니라 달력 탭으로 간다 — 묶음에서도 사용자가 어떤 행사인지
 * 확인할 수 있어야 하기 때문이다.
 */
export function buildNotification(
  type: NotificationType,
  events: UpcomingEvent[],
): { title: string; body: string; data: Record<string, string> } {
  const phrase = TYPE_PHRASE[type];
  if (events.length === 1) {
    const event = events[0];
    const emoji = event.kind === "local_event" ? "🏪" : "🎪";
    return {
      title: `${emoji} ${event.title}`,
      body: `${phrase} · ${displayDate(event.startDate)} 시작`,
      data: {
        eventKind: event.kind,
        eventId: event.id,
        notificationType: type,
        notificationKind: TYPE_KIND[type],
        occurrenceDate: event.startDate,
        eventTitle: event.title,
      },
    };
  }
  const carried = events.slice(0, MAX_DIGEST_PAYLOAD_EVENTS);
  const names = events
    .slice(0, 2)
    .map((event) => event.title)
    .join(", ");
  return {
    title: `🎪 다가오는 행사 ${events.length}건`,
    body: `${phrase} · ${names} 외 ${events.length - 2}건`.replace(
      " 외 0건",
      "",
    ),
    data: {
      eventKind: "digest",
      notificationType: type,
      notificationKind: TYPE_KIND[type],
      // 계획이 "정확히 그 날 시작하는 행사"만 담으므로 묶음 안의 시작일은 모두 같다.
      occurrenceDate: events[0]?.startDate ?? "",
      // 옛 앱은 이 날짜로 달력 탭을 연다.
      eventDate: events[0]?.startDate ?? "",
      // 새 앱은 이 목록으로 알림센터에 행사별 카드를 만든다. 상세는 앱이 다시 받아 온다.
      eventIds: carried.map((event) => `${event.kind}:${event.id}`).join(","),
      // 제목에는 쉼표가 들어갈 수 있어 줄바꿈으로 가른다.
      eventTitles: carried.map((event) => event.title).join("\n"),
    },
  };
}

// ------------------------------------------------------- 물리 발송 대상 · 지문

/** 로그에 원본 APNs 토큰을 남기지 않기 위한 짧은 지문. FNV-1a 32bit. */
export function tokenHash(token: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** 같은 토큰이면 device_id가 몇 개든 물리적으로 한 대다. 발송 단위는 이 키다. */
export function deliveryTargetKey(environment: string, token: string): string {
  return `${environment}|${token}`;
}

/**
 * apns-collapse-id. 같은 논리적 알림이면 회차·claim·device_id와 무관하게 같은 값이 나온다.
 * 단건은 (종류, 행사), 묶음은 (종류, 기준일)이 정체성이다. 발송 대상은 넣지 않는다 —
 * APNs가 collapse-id를 토큰별로 따로 보므로 넣어 봐야 64바이트만 쓴다.
 */
export function upcomingCollapseId(
  type: NotificationType,
  events: UpcomingEvent[],
  sendDay: string,
): string {
  const raw =
    events.length === 1
      ? `up-${type}-${events[0].kind}-${events[0].id}`
      : `up-${type}-digest-${sendDay}`;
  if (new TextEncoder().encode(raw).length <= 64) return raw;
  return `up-${type}-${tokenHash(raw)}`;
}

export type DispatchOptions = {
  /** 한 회차 APNs 호출 상한. invocation당 외부 fetch 50건 한도 안에 들어야 한다. */
  maxPushes?: number;
  now?: Date;
  /** 이 회차의 선점 식별자. 테스트에서 두 회차를 구분하려고 주입한다. */
  claimId?: string;
};

export type DispatchResult = {
  sent: number;
  rowsMarked: number;
  failed: number;
  skippedQuietHours: number;
  clearedTokens: number;
  /** 다른 invocation이 이미 선점한 묶음. 이번 회차는 손대지 않았다. */
  skippedClaimed: number;
  /** APNs 응답을 못 받아 발송 여부를 모르는 묶음. 선점을 붙잡아 둔 채 남긴다. */
  deliveryUnknown: number;
  /** 계획 후 대상 행사가 사라진 묶음. 보낼 게 없으므로 발송 완료로 닫는다. */
  skippedEmpty: number;
};

/**
 * 선점이 살아 있는 시간. 이 시간이 지나면 죽은 invocation이 잡아 둔 행을 다시 잡는다.
 * 짧게 두면 응답을 못 받은 발송을 금방 재시도해 중복이 되고, 길게 두면 진짜 실패가
 * 그만큼 늦게 나간다. 중복을 피하는 쪽을 택해 1시간으로 둔다.
 */
export const CLAIM_TTL_MS = 60 * 60 * 1000;

function logAttempt(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ at: "upcoming_dispatch", ...entry }));
}

/**
 * 대기 묶음을 물리 발송 대상(환경+토큰) × 기준일 × 알림 종류로 묶어 묶음당 push 하나를 보낸다.
 *
 * 순서가 중요하다. 먼저 선점(claim)으로 행의 소유권을 원자적으로 가져오고, 그 다음
 * 선점한 행만 다시 읽어 알림을 만든다. 두 invocation이 겹치면 UPDATE 한쪽만 행을 잡고
 * 다른 쪽은 0건을 읽어 아예 보내지 않는다 — 묶음이 둘로 쪼개져 두 번 나가지 않는다.
 */
export async function dispatchPendingNotifications(
  db: D1Database,
  sender: ApnsSender,
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  const maxPushes = options.maxPushes ?? 40;
  const now = options.now ?? new Date();
  const claimId = options.claimId ?? crypto.randomUUID();
  const result: DispatchResult = {
    sent: 0,
    rowsMarked: 0,
    failed: 0,
    skippedQuietHours: 0,
    clearedTokens: 0,
    skippedClaimed: 0,
    deliveryUnknown: 0,
    skippedEmpty: 0,
  };

  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - CLAIM_TTL_MS).toISOString();
  const today = seoulDayString(now);

  const pendingRows = await db
    .prepare(
      `SELECT device_id, send_day, notification_type, attempts
         FROM notification_digests
        WHERE sent_at IS NULL
          AND send_day >= ?
          AND (claim_id IS NULL OR claimed_at <= ?)
        ORDER BY send_day, device_id, notification_type
        LIMIT 1000`,
    )
    .bind(addDays(today, -DIGEST_MAX_AGE_DAYS), staleBefore)
    .all<PendingDigest>();
  const pending = pendingRows.results ?? [];
  if (pending.length === 0) return result;

  const devices = await loadActiveDevices(db);
  const deviceById = new Map(
    devices.map((device) => [device.device_id, device]),
  );

  // 같은 토큰을 든 device_id가 여럿이면 물리적으로 한 대다. 대표(가장 최근 updated_at,
  // 동률이면 device_id가 큰 쪽)의 설정을 쓰고, 대기 행은 그룹 전체 것을 함께 닫는다.
  const targets = new Map<
    string,
    { device: NotificationDevice; deviceIds: string[] }
  >();
  for (const device of devices) {
    if (!device.apns_token) continue;
    const key = deliveryTargetKey(device.apns_environment, device.apns_token);
    const existing = targets.get(key);
    if (!existing) {
      targets.set(key, { device, deviceIds: [device.device_id] });
      continue;
    }
    existing.deviceIds.push(device.device_id);
    const better =
      device.updated_at > existing.device.updated_at ||
      (device.updated_at === existing.device.updated_at &&
        device.device_id > existing.device.device_id);
    if (better) existing.device = device;
  }
  const targetKeyByDevice = new Map<string, string>();
  for (const [key, target] of targets) {
    for (const deviceId of target.deviceIds)
      targetKeyByDevice.set(deviceId, key);
  }

  // 담길 행사는 계획 때와 같은 규칙으로 여기서 다시 계산한다. 대기 중인 기준일이
  // 여럿이어도 조회는 날짜 합집합 한 번이다.
  const dates = new Set<string>();
  for (const row of pending) {
    dates.add(targetDateFor(row.send_day, row.notification_type));
  }
  const allEvents = await loadUpcomingEvents(db, [...dates]);

  // (물리 대상, 기준일, 종류) 하나가 push 하나다.
  const groups = new Map<
    string,
    { targetKey: string; sendDay: string; type: NotificationType }
  >();
  for (const row of pending) {
    // 알림을 껐거나 토큰이 없는 기기는 발송 대상이 아니다. 행은 남겨 두었다가
    // 다시 켜면 그때 나간다.
    if (!deviceById.has(row.device_id)) continue;
    const targetKey = targetKeyByDevice.get(row.device_id);
    if (!targetKey) continue;
    groups.set(`${targetKey}|${row.send_day}|${row.notification_type}`, {
      targetKey,
      sendDay: row.send_day,
      type: row.notification_type,
    });
  }

  const hour = seoulHour(now);
  let budget = maxPushes;

  for (const { targetKey, sendDay, type } of groups.values()) {
    if (budget <= 0) break;
    const target = targets.get(targetKey);
    if (!target) continue;
    const device = target.device;
    if (!device.apns_token) continue;
    if (
      device.quiet_hours_enabled === 1 &&
      isWithinQuietHours(hour, device.quiet_start_hour, device.quiet_end_hour)
    ) {
      result.skippedQuietHours += 1;
      continue;
    }

    const placeholders = target.deviceIds.map(() => "?").join(",");
    // 선점. 이미 다른 회차가 잡았거나 TTL이 안 지난 행은 여기서 걸러진다.
    await db
      .prepare(
        `UPDATE notification_digests
            SET claim_id = ?, claimed_at = ?
          WHERE send_day = ?
            AND notification_type = ?
            AND sent_at IS NULL
            AND (claim_id IS NULL OR claimed_at <= ?)
            AND device_id IN (${placeholders})`,
      )
      .bind(claimId, nowIso, sendDay, type, staleBefore, ...target.deviceIds)
      .run();

    const claimedRows = await db
      .prepare(
        `SELECT device_id, send_day, notification_type, attempts
           FROM notification_digests
          WHERE send_day = ?
            AND notification_type = ?
            AND sent_at IS NULL
            AND claim_id = ?
            AND device_id IN (${placeholders})
          ORDER BY device_id`,
      )
      .bind(sendDay, type, claimId, ...target.deviceIds)
      .all<PendingDigest>();
    const rows = claimedRows.results ?? [];
    if (rows.length === 0) {
      // 다른 invocation이 먼저 잡았다. 이 회차는 보내지 않는다.
      result.skippedClaimed += 1;
      continue;
    }

    const markSent = (extra: string | null) =>
      db.batch(
        rows.map((row) =>
          db
            .prepare(
              `UPDATE notification_digests
                  SET sent_at = ?, attempts = attempts + 1, claim_id = NULL,
                      last_error = ?
                WHERE device_id = ? AND send_day = ? AND notification_type = ?
                  AND claim_id = ?`,
            )
            .bind(nowIso, extra, row.device_id, sendDay, type, claimId),
        ),
      );

    const targetDate = targetDateFor(sendDay, type);
    const wanted = allEvents.filter(
      (event) =>
        event.startDate === targetDate && deviceWantsEvent(device, event),
    );
    if (wanted.length === 0) {
      // 계획 후 행사가 사라졌거나 설정이 바뀌었다. 보낼 게 없으니 닫는다.
      result.skippedEmpty += 1;
      result.rowsMarked += rows.length;
      await markSent("no_matching_events");
      continue;
    }

    const content = buildNotification(type, wanted);
    const collapseId = upcomingCollapseId(type, wanted, sendDay);
    const logBase = {
      logicalNotificationKey: collapseId,
      tokenHash: tokenHash(device.apns_token),
      deviceIds: target.deviceIds,
      notificationType: type,
      sendDay,
      eventIds: wanted.map((event) => event.id),
      claimId,
      rows: rows.length,
    };

    budget -= 1;
    let outcome;
    try {
      outcome = await sender.send(device.apns_token, device.apns_environment, {
        title: content.title,
        body: content.body,
        threadId: `upcoming-${type}`,
        collapseId,
        data: content.data,
      });
    } catch (error) {
      // 응답을 못 받았다. 애플이 받았는지 알 수 없으므로 선점을 풀지 않는다 —
      // 지금 재시도하면 중복이 될 수 있고, TTL이 지나면 자연히 한 번 더 잡힌다.
      const reason = `delivery_unknown ${String(error).slice(0, 120)}`;
      result.deliveryUnknown += 1;
      logAttempt({ ...logBase, outcome: "delivery_unknown", error: reason });
      await db.batch(
        rows.map((row) =>
          db
            .prepare(
              `UPDATE notification_digests SET attempts = attempts + 1, last_error = ?
                WHERE device_id = ? AND send_day = ? AND notification_type = ?
                  AND claim_id = ?`,
            )
            .bind(reason, row.device_id, sendDay, type, claimId),
        ),
      );
      continue;
    }

    if (outcome.ok) {
      result.sent += 1;
      result.rowsMarked += rows.length;
      logAttempt({
        ...logBase,
        outcome: "sent",
        status: outcome.status,
        apnsId: outcome.apnsId,
        sentAt: nowIso,
      });
      await markSent(null);
      continue;
    }

    result.failed += 1;
    const reason = `${outcome.status}${outcome.reason ? ` ${outcome.reason}` : ""}`;
    logAttempt({
      ...logBase,
      outcome: "failed",
      status: outcome.status,
      reason: outcome.reason,
      apnsId: outcome.apnsId,
    });
    // APNs가 명시적으로 거절했다 — 안 갔다는 뜻이므로 선점을 풀어 다음 회차에 다시 잡히게 한다.
    await db.batch(
      rows.map((row) =>
        db
          .prepare(
            `UPDATE notification_digests
                SET attempts = attempts + 1, last_error = ?,
                    claim_id = NULL, claimed_at = NULL
              WHERE device_id = ? AND send_day = ? AND notification_type = ?
                AND claim_id = ?`,
          )
          .bind(reason, row.device_id, sendDay, type, claimId),
      ),
    );
    if (isPermanentTokenFailure(outcome)) {
      // 죽은 토큰으로 계속 재시도하면 예산만 태운다. 토큰만 비우고 대기 행은 남긴다.
      await db
        .prepare(
          `UPDATE notification_devices SET apns_token = NULL, updated_at = ?
            WHERE device_id = ?`,
        )
        .bind(nowIso, device.device_id)
        .run();
      result.clearedTokens += 1;
      targets.delete(targetKey);
    }
  }
  return result;
}
