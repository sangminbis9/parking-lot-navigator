import type {
  LocalEvent,
  LocalEventAdminUpsertRequest,
  LocalEventReportRequest,
  LocalEventStatus,
  LocalEventStatusPatchRequest,
  MapItem,
} from "@parking/shared-types";
import { distanceMeters } from "../../backend/src/services/geo.js";
import {
  inferLocalEventType,
  structureLocalEvent,
} from "../../backend/src/features/localEvents/localEventStructuring.js";

export interface LocalEventQueryOptions {
  lat: number;
  lng: number;
  radiusMeters: number;
  limit: number;
  cursor?: string;
  status?: LocalEventStatus;
}

interface LocalEventRow {
  id: string;
  title: string;
  description: string | null;
  benefit: string | null;
  event_type: LocalEvent["eventType"];
  status: LocalEventStatus;
  source: LocalEvent["source"];
  source_url: string | null;
  source_item_id: string | null;
  image_url: string | null;
  store_name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  start_date: string | null;
  end_date: string | null;
  confidence_score: number | null;
  needs_review: number;
  is_sponsored: number;
  sponsor_tier: string | null;
  paid_until: string | null;
  priority_score: number;
  updated_at: string;
  primary_category: string | null;
  category_tags_json: string | null;
}

export async function queryLocalEvents(
  db: D1Database,
  options: LocalEventQueryOptions,
): Promise<{ items: LocalEvent[]; nextCursor: string | null }> {
  const status = options.status ?? "approved";
  const offset = parseCursor(options.cursor);
  const latDelta = options.radiusMeters / 111320;
  const lngDelta =
    options.radiusMeters /
    Math.max(40000, 111320 * Math.cos((options.lat * Math.PI) / 180));
  const now = new Date().toISOString();
  let rows: D1Result<LocalEventRow>;
  try {
    rows = await db
      .prepare(
        `SELECT *
         FROM local_events
         WHERE status = ?
           AND lat IS NOT NULL
           AND lng IS NOT NULL
           AND lat BETWEEN ? AND ?
           AND lng BETWEEN ? AND ?
           AND (is_sponsored = 0 OR (paid_until IS NOT NULL AND paid_until > ?))`,
      )
      .bind(
        status,
        options.lat - latDelta,
        options.lat + latDelta,
        options.lng - lngDelta,
        options.lng + lngDelta,
        now,
      )
      .all<LocalEventRow>();
  } catch (error) {
    if (isMissingLocalEventsTable(error)) {
      return { items: [], nextCursor: null };
    }
    throw error;
  }
  const matched = (rows.results ?? [])
    .map((row) => mapLocalEventRow(row, options.lat, options.lng))
    .filter((item) => item.distanceMeters <= options.radiusMeters)
    .sort(localEventSort);
  const page = matched.slice(offset, offset + options.limit);
  const nextOffset = offset + page.length;
  return {
    items: page,
    nextCursor: nextOffset < matched.length ? String(nextOffset) : null,
  };
}

export async function getLocalEvent(
  db: D1Database,
  id: string,
): Promise<LocalEvent | null> {
  try {
    const row = await db
      .prepare("SELECT * FROM local_events WHERE id = ?")
      .bind(id)
      .first<LocalEventRow>();
    return row ? mapLocalEventRow(row, row.lat ?? 0, row.lng ?? 0) : null;
  } catch (error) {
    if (isMissingLocalEventsTable(error)) return null;
    throw error;
  }
}

export async function createLocalEventReport(
  db: D1Database,
  input: LocalEventReportRequest,
): Promise<LocalEvent> {
  const now = new Date().toISOString();
  const structured = structureLocalEvent({
    sourceUrl: input.sourceUrl,
    captionText: input.captionText,
    storeName: input.storeName,
    address: input.address,
  });
  const id = `report:${crypto.randomUUID()}`;
  const item: LocalEvent = {
    id,
    title: structured.title ?? "Submitted local event",
    eventType: inferLocalEventType(
      [structured.title, structured.description, structured.benefit]
        .filter(Boolean)
        .join(" "),
    ),
    category: "local_event",
    sourceId: id,
    startDate: structured.startDate ?? today(),
    endDate: structured.endDate,
    status: "pending",
    storeName: structured.storeName ?? "Unknown store",
    venueName: structured.storeName,
    address: structured.address ?? "",
    lat: structured.lat ?? 0,
    lng: structured.lng ?? 0,
    distanceMeters: 0,
    source: "user_report",
    sourceUrl: structured.sourceUrl,
    imageUrl: input.imageUrl ?? null,
    benefit: structured.benefit,
    shortDescription: structured.description,
    region: null,
    updatedAt: now,
    confidenceScore: structured.confidenceScore,
    needsReview: true,
    isSponsored: false,
    sponsorTier: null,
    paidUntil: null,
    priorityScore: 0,
  };
  await insertLocalEvent(db, item, {
    rawPayload: input,
    duplicateKey: duplicateKey(item),
  });
  await db
    .prepare(
      `INSERT INTO local_event_reports (
        id, local_event_id, source_url, caption_text, store_name, address, image_url, note, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(
      `report:${crypto.randomUUID()}`,
      item.id,
      input.sourceUrl ?? null,
      input.captionText ?? null,
      input.storeName ?? null,
      input.address ?? null,
      input.imageUrl ?? null,
      input.note ?? null,
      now,
    )
    .run();
  return item;
}

export async function createAdminLocalEvent(
  db: D1Database,
  input: LocalEventAdminUpsertRequest,
): Promise<LocalEvent> {
  const now = new Date().toISOString();
  const id = `local:${crypto.randomUUID()}`;
  const item = adminInputToLocalEvent(id, input, now);
  await insertLocalEvent(db, item, {
    rawPayload: input,
    duplicateKey: duplicateKey(item),
  });
  return item;
}

export async function upsertLocalEvent(
  db: D1Database,
  item: LocalEvent,
  rawPayload: unknown,
): Promise<void> {
  await insertLocalEvent(db, item, {
    rawPayload,
    duplicateKey: duplicateKey(item),
  });
}

export async function updateAdminLocalEvent(
  db: D1Database,
  id: string,
  input: Partial<LocalEventAdminUpsertRequest>,
): Promise<LocalEvent | null> {
  const existing = await getLocalEvent(db, id);
  if (!existing) return null;
  const updated: LocalEvent = {
    ...existing,
    title: input.title ?? existing.title,
    eventType: input.eventType ?? existing.eventType,
    startDate: input.startDate ?? existing.startDate,
    endDate: input.endDate === undefined ? existing.endDate : input.endDate,
    status: input.status ?? existing.status,
    storeName: input.storeName ?? existing.storeName,
    venueName: input.storeName ?? existing.venueName,
    address: input.address ?? existing.address,
    lat: input.lat ?? existing.lat,
    lng: input.lng ?? existing.lng,
    source: input.source ?? existing.source,
    sourceUrl:
      input.sourceUrl === undefined ? existing.sourceUrl : input.sourceUrl,
    imageUrl: input.imageUrl === undefined ? existing.imageUrl : input.imageUrl,
    benefit: input.benefit ?? existing.benefit,
    shortDescription: input.description ?? existing.shortDescription,
    updatedAt: new Date().toISOString(),
    isSponsored: input.isSponsored ?? existing.isSponsored,
    sponsorTier:
      input.sponsorTier === undefined
        ? existing.sponsorTier
        : input.sponsorTier,
    paidUntil:
      input.paidUntil === undefined ? existing.paidUntil : input.paidUntil,
    priorityScore: input.priorityScore ?? existing.priorityScore,
    needsReview: input.status
      ? input.status !== "approved"
      : existing.needsReview,
  };
  await insertLocalEvent(db, updated, {
    rawPayload: updated,
    duplicateKey: duplicateKey(updated),
  });
  return updated;
}

export async function patchLocalEventStatus(
  db: D1Database,
  id: string,
  input: LocalEventStatusPatchRequest,
): Promise<LocalEvent | null> {
  const updated = await updateAdminLocalEvent(db, id, { status: input.status });
  if (!updated) return null;
  await db
    .prepare(
      "UPDATE local_events SET rejection_reason = ?, approved_at = ? WHERE id = ?",
    )
    .bind(
      input.rejectionReason ?? null,
      input.status === "approved" ? new Date().toISOString() : null,
      id,
    )
    .run();
  return updated;
}

export function localEventMapItem(item: LocalEvent): MapItem {
  return {
    id: `event:${item.id}`,
    type: "event",
    title: item.title,
    subtitle: item.benefit ?? item.storeName,
    lat: item.lat,
    lng: item.lng,
    distanceMeters: item.distanceMeters,
    markerType: "local_event",
    source: item.source,
    sourceUrl: item.sourceUrl,
    imageUrl: item.imageUrl,
    isSponsored: item.isSponsored,
    priorityScore: item.priorityScore,
  };
}

function adminInputToLocalEvent(
  id: string,
  input: LocalEventAdminUpsertRequest,
  now: string,
): LocalEvent {
  return {
    id,
    title: input.title ?? "Local event",
    eventType:
      input.eventType ??
      inferLocalEventType(
        [input.title, input.description, input.benefit]
          .filter(Boolean)
          .join(" "),
      ),
    category: "local_event",
    sourceId: id,
    startDate: input.startDate ?? today(),
    endDate: input.endDate ?? null,
    status: input.status ?? "pending",
    storeName: input.storeName ?? "Unknown store",
    venueName: input.storeName ?? "Unknown store",
    address: input.address ?? "",
    lat: input.lat ?? 0,
    lng: input.lng ?? 0,
    distanceMeters: 0,
    source: input.source,
    sourceUrl: input.sourceUrl ?? null,
    imageUrl: input.imageUrl ?? null,
    benefit: input.benefit ?? null,
    shortDescription: input.description ?? null,
    region: null,
    updatedAt: now,
    confidenceScore: null,
    needsReview: input.status !== "approved",
    isSponsored: input.isSponsored ?? false,
    sponsorTier: input.sponsorTier ?? null,
    paidUntil: input.paidUntil ?? null,
    priorityScore: input.priorityScore ?? 0,
  };
}

async function insertLocalEvent(
  db: D1Database,
  item: LocalEvent,
  options: { rawPayload: unknown; duplicateKey: string },
): Promise<void> {
  const now = item.updatedAt ?? new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO local_events (
        id, title, description, benefit, event_type, status, source, source_url, source_item_id,
        image_url, store_name, address, lat, lng, start_date, end_date, confidence_score,
        needs_review, is_sponsored, sponsor_tier, paid_until, priority_score, duplicate_key,
        raw_payload, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        benefit = excluded.benefit,
        event_type = excluded.event_type,
        status = excluded.status,
        source = excluded.source,
        source_url = excluded.source_url,
        source_item_id = excluded.source_item_id,
        image_url = excluded.image_url,
        store_name = excluded.store_name,
        address = excluded.address,
        lat = excluded.lat,
        lng = excluded.lng,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        confidence_score = excluded.confidence_score,
        needs_review = excluded.needs_review,
        is_sponsored = excluded.is_sponsored,
        sponsor_tier = excluded.sponsor_tier,
        paid_until = excluded.paid_until,
        priority_score = excluded.priority_score,
        duplicate_key = excluded.duplicate_key,
        raw_payload = excluded.raw_payload,
        updated_at = excluded.updated_at`,
    )
    .bind(
      item.id,
      item.title,
      item.shortDescription,
      item.benefit,
      item.eventType,
      item.status,
      item.source,
      item.sourceUrl,
      item.sourceId ?? item.id,
      item.imageUrl,
      item.storeName,
      item.address,
      item.lat || null,
      item.lng || null,
      item.startDate,
      item.endDate,
      item.confidenceScore ?? null,
      item.needsReview ? 1 : 0,
      item.isSponsored ? 1 : 0,
      item.sponsorTier,
      item.paidUntil,
      item.priorityScore,
      options.duplicateKey,
      JSON.stringify(options.rawPayload),
      now,
      now,
    )
    .run();
}

function mapLocalEventRow(
  row: LocalEventRow,
  lat: number,
  lng: number,
): LocalEvent {
  return {
    id: row.id,
    title: row.title,
    eventType: row.event_type,
    category: "local_event",
    sourceId: row.source_item_id ?? row.id,
    startDate: row.start_date ?? "",
    endDate: row.end_date,
    status: row.status,
    storeName: row.store_name,
    venueName: row.store_name,
    address: row.address,
    lat: row.lat ?? 0,
    lng: row.lng ?? 0,
    distanceMeters: Math.round(
      distanceMeters(lat, lng, row.lat ?? 0, row.lng ?? 0),
    ),
    source: row.source,
    sourceUrl: row.source_url,
    imageUrl: row.image_url,
    benefit: row.benefit,
    shortDescription: row.description,
    region: null,
    updatedAt: row.updated_at,
    confidenceScore: row.confidence_score,
    needsReview: Boolean(row.needs_review),
    isSponsored: Boolean(row.is_sponsored),
    sponsorTier: row.sponsor_tier,
    paidUntil: row.paid_until,
    priorityScore: row.priority_score,
    primaryCategory:
      (row.primary_category as LocalEvent["primaryCategory"]) ?? null,
    categoryTags: parseCategoryTagsJson(row.category_tags_json),
  };
}

function parseCategoryTagsJson(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === "string");
    }
    return [];
  } catch {
    return [];
  }
}

function localEventSort(a: LocalEvent, b: LocalEvent): number {
  if (a.isSponsored !== b.isSponsored) return a.isSponsored ? -1 : 1;
  if (a.priorityScore !== b.priorityScore)
    return b.priorityScore - a.priorityScore;
  return a.distanceMeters - b.distanceMeters;
}

function duplicateKey(item: LocalEvent): string {
  return [
    normalize(item.storeName),
    normalize(item.title),
    item.startDate,
    item.endDate ?? "",
    Math.round(item.lat * 1000),
    Math.round(item.lng * 1000),
  ].join("|");
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()[\]{}"'`~!@#$%^&*_+=,./<>?:;|\\-]/g, "");
}

function parseCursor(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function isMissingLocalEventsTable(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("no such table: local_events")
  );
}
