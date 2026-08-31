import { z } from "zod";
import { seoulDayString } from "./kstDate.js";

// 익명 사용 집계.
//
// 기기 식별자, 세션 id, 좌표를 받지 않는다. 앱이 로컬에서 카운터를 모아 가끔
// 올리면 서버는 (KST 날짜, 이벤트, 라벨) 카운터에만 더한다. 그래서 저장된 값에서
// 개인을 되짚을 수 없고, D1 쓰기도 사용자 수가 아니라 "서로 다른 조합 수 x 전송
// 횟수"에 비례한다.
//
// 라벨은 자유 문자열이 아니라 이벤트마다 정해진 값만 받는다. 자유 입력을 허용하면
// 카디널리티가 터져 쓰기 예산을 먹고, 검색어 같은 개인정보가 흘러들 수 있다.
const ANALYTICS_EVENTS = {
  app_open: [],
  map_loaded: [],
  event_pin_tap: ["festival", "local_event", "performance"],
  event_detail_open: ["festival", "local_event", "performance"],
  favorite_add: ["festival", "local_event"],
  calendar_open: [],
  notification_open: ["festival", "local_event"],
  parking_view: [],
  navigation_start: [],
  report_submit: ["festival", "local_event"],
  merchant_register_tap: [],
  empty_result: ["map", "festival", "local_event", "performance", "parking"],
  api_error: ["festival", "local_event", "performance", "parking", "other"],
} as const satisfies Record<string, readonly string[]>;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;

export const ANALYTICS_EVENT_NAMES = Object.keys(
  ANALYTICS_EVENTS,
) as AnalyticsEventName[];

export const analyticsBatchSchema = z.object({
  events: z
    .array(
      z.object({
        name: z.string().max(40),
        label: z.string().max(40).optional(),
        count: z.number().int().min(1).max(10000),
      }),
    )
    .max(40),
});

export type AnalyticsBatch = z.infer<typeof analyticsBatchSchema>;

export const ANALYTICS_RETENTION_DAYS = 180;

/** 허용 목록에 없는 이벤트나 라벨은 조용히 버린다. 앱 버전이 앞서가도 400을 내지 않는다. */
function normalize(
  batch: AnalyticsBatch,
): { name: string; label: string; count: number }[] {
  const merged = new Map<string, { name: string; label: string; count: number }>();
  for (const entry of batch.events) {
    const allowedLabels = ANALYTICS_EVENTS[entry.name as AnalyticsEventName];
    if (!allowedLabels) continue;
    const label = entry.label ?? "";
    if (label !== "" && !(allowedLabels as readonly string[]).includes(label)) {
      continue;
    }
    const key = `${entry.name} ${label}`;
    const existing = merged.get(key);
    if (existing) existing.count += entry.count;
    else merged.set(key, { name: entry.name, label, count: entry.count });
  }
  return [...merged.values()];
}

export async function recordAnalytics(
  db: D1Database,
  batch: AnalyticsBatch,
  now: Date = new Date(),
): Promise<number> {
  const entries = normalize(batch);
  if (entries.length === 0) return 0;
  const day = seoulDayString(now);
  const updatedAt = now.toISOString();
  // count/updated_at은 인덱스에 없으므로 갱신해도 본체 1행만 다시 쓴다.
  const statement = db.prepare(
    `INSERT INTO analytics_daily (day, event, label, count, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(day, event, label) DO UPDATE SET
       count = count + excluded.count,
       updated_at = excluded.updated_at`,
  );
  await db.batch(
    entries.map((e) => statement.bind(day, e.name, e.label, e.count, updatedAt)),
  );
  return entries.length;
}

export async function queryAnalyticsDaily(
  db: D1Database,
  days: number,
  now: Date = new Date(),
): Promise<{ day: string; event: string; label: string; count: number }[]> {
  const span = Math.min(Math.max(days, 1), 90);
  const from = seoulDayString(new Date(now.getTime() - (span - 1) * 86400000));
  const result = await db
    .prepare(
      `SELECT day, event, label, count FROM analytics_daily
        WHERE day >= ? ORDER BY day DESC, count DESC`,
    )
    .bind(from)
    .all<Record<string, unknown>>();
  return (result.results ?? []).map((r) => ({
    day: String(r.day),
    event: String(r.event),
    label: String(r.label),
    count: Number(r.count ?? 0),
  }));
}

export async function pruneOldAnalytics(
  db: D1Database,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = seoulDayString(
    new Date(now.getTime() - ANALYTICS_RETENTION_DAYS * 86400000),
  );
  const result = await db
    .prepare(`DELETE FROM analytics_daily WHERE day < ?`)
    .bind(cutoff)
    .run();
  return result.meta?.changes ?? 0;
}
