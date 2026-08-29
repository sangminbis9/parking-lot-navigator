import { z } from "zod";

export const EVENT_REPORT_REASONS = [
  "ended",
  "wrong_date",
  "wrong_price",
  "wrong_place",
  "wrong_content",
  "duplicate",
  "etc",
] as const;

export const eventReportSchema = z.object({
  eventKind: z.enum(["festival", "local_event"]),
  eventId: z.string().min(1).max(200),
  eventTitle: z.string().max(200).nullable().optional(),
  reason: z.enum(EVENT_REPORT_REASONS),
  note: z.string().max(500).nullable().optional(),
});

export type EventReportInput = z.infer<typeof eventReportSchema>;

export interface EventReportRow {
  id: string;
  eventKind: string;
  eventId: string;
  eventTitle: string | null;
  reason: string;
  note: string | null;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// 로그인이 없는 앱이라 신고자를 식별하지 않는다. 같은 사람이 같은 행사를 두 번
// 신고하는 것은 앱이 로컬에 기억해 버튼을 막는 쪽으로 처리하고, 서버는 길이
// 제한만 건다 — 식별자를 받으려고 PII 수집 구조를 만들지 않는다.
export async function createEventReport(
  db: D1Database,
  input: EventReportInput,
): Promise<EventReportRow> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const row: EventReportRow = {
    id,
    eventKind: input.eventKind,
    eventId: input.eventId.trim(),
    eventTitle: trimOrNull(input.eventTitle),
    reason: input.reason,
    note: trimOrNull(input.note),
    status: "pending",
    createdAt,
    reviewedAt: null,
  };
  await db
    .prepare(
      `INSERT INTO event_reports
         (id, event_kind, event_id, event_title, reason, note, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(
      row.id,
      row.eventKind,
      row.eventId,
      row.eventTitle,
      row.reason,
      row.note,
      row.createdAt,
    )
    .run();
  return row;
}

export async function queryEventReports(
  db: D1Database,
  options: { status?: string; limit?: number } = {},
): Promise<EventReportRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const status = options.status ?? "pending";
  const result = await db
    .prepare(
      `SELECT id, event_kind, event_id, event_title, reason, note, status, created_at, reviewed_at
         FROM event_reports
        WHERE status = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .bind(status, limit)
    .all<Record<string, unknown>>();
  return (result.results ?? []).map((r) => ({
    id: String(r.id),
    eventKind: String(r.event_kind),
    eventId: String(r.event_id),
    eventTitle: r.event_title == null ? null : String(r.event_title),
    reason: String(r.reason),
    note: r.note == null ? null : String(r.note),
    status: String(r.status),
    createdAt: String(r.created_at),
    reviewedAt: r.reviewed_at == null ? null : String(r.reviewed_at),
  }));
}

export async function patchEventReportStatus(
  db: D1Database,
  id: string,
  status: "pending" | "accepted" | "rejected",
): Promise<boolean> {
  const reviewedAt = status === "pending" ? null : new Date().toISOString();
  const result = await db
    .prepare(`UPDATE event_reports SET status = ?, reviewed_at = ? WHERE id = ?`)
    .bind(status, reviewedAt, id)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}
