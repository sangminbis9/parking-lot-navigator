import type { EventCategory, Festival, FreeEvent } from "@parking/shared-types";
import { distanceMeters } from "../../backend/src/services/geo.js";
import { mapWithConcurrency } from "./concurrency.js";
import {
  currentDiscoveryChunkIndex,
  DISCOVERY_PROVIDER_CHUNK_COUNT,
  DISCOVERY_PROVIDER_CHUNKS,
  type DiscoverySyncKind,
} from "./discoverySchedule.js";

export { mapWithConcurrency } from "./concurrency.js";
export {
  currentDiscoveryChunkIndex,
  DISCOVERY_PROVIDER_CHUNK_COUNT,
} from "./discoverySchedule.js";

type DiscoveryType = "festival" | "event";

const DISCOVERY_RESULT_LIMIT = 1000;
const DISCOVERY_CLUSTER_RESULT_LIMIT = 5000;
const DISCOVERY_STALE_DAYS: Record<DiscoveryType, number> = {
  festival: 45,
  event: 45,
};
const DISCOVERY_SYNC_RADIUS_METERS = 90000;
const DEFAULT_DISCOVERY_SYNC_CONCURRENCY = 4;
const DEFAULT_DISCOVERY_SYNC_FETCH_TIMEOUT_MS = 8000;

const NATIONAL_DISCOVERY_CENTERS: Array<{
  id: string;
  lat: number;
  lng: number;
}> = [
  { id: "seoul", lat: 37.5665, lng: 126.978 },
  { id: "busan", lat: 35.1796, lng: 129.0756 },
  { id: "daegu", lat: 35.8714, lng: 128.6014 },
  { id: "incheon", lat: 37.4563, lng: 126.7052 },
  { id: "gwangju", lat: 35.1595, lng: 126.8526 },
  { id: "daejeon", lat: 36.3504, lng: 127.3845 },
  { id: "ulsan", lat: 35.5384, lng: 129.3114 },
  { id: "sejong", lat: 36.48, lng: 127.289 },
  { id: "suwon", lat: 37.2636, lng: 127.0286 },
  { id: "chuncheon", lat: 37.8813, lng: 127.7298 },
  { id: "cheongju", lat: 36.6424, lng: 127.489 },
  { id: "jeonju", lat: 35.8242, lng: 127.148 },
  { id: "mokpo", lat: 34.8118, lng: 126.3922 },
  { id: "andong", lat: 36.5684, lng: 128.7294 },
  { id: "changwon", lat: 35.2279, lng: 128.6811 },
  { id: "gangneung", lat: 37.7519, lng: 128.8761 },
  { id: "jeju", lat: 33.4996, lng: 126.5312 },
];

const SEOUL_DISCOVERY_CENTER = { id: "seoul", lat: 37.5665, lng: 126.978 };

export interface DiscoveryQueryOptions {
  radiusMeters: number;
  upcomingWithinDays: number;
  ongoingOnly?: boolean;
  freeOnly?: boolean;
}

export interface DiscoveryCluster {
  id: string;
  type: DiscoveryType;
  lat: number;
  lng: number;
  count: number;
}

export interface DiscoverySyncRuntime {
  festivalService: { nearby(query: SyncDiscoverQuery): Promise<Festival[]> };
  eventService: { nearby(query: SyncDiscoverQuery): Promise<FreeEvent[]> };
}

export interface DiscoverySyncResult {
  syncType: string;
  fetched: number;
  upserted: number;
  skipped: number;
  pruned: number;
  sources: Record<string, number>;
  generatedAt: string;
}

interface SyncDiscoverQuery {
  lat: number;
  lng: number;
  radiusMeters: number;
  upcomingWithinDays: number;
  ongoingOnly?: boolean;
  freeOnly?: boolean;
  providerAllowlist?: ReadonlySet<string>;
  signal?: AbortSignal;
}

interface DiscoveryItemRow {
  id: string;
  type: DiscoveryType;
  source: string;
  source_item_id: string;
  title: string;
  subtitle: string | null;
  category_text: string | null;
  start_date: string | null;
  end_date: string | null;
  status: "ongoing" | "upcoming" | null;
  is_free: number | null;
  venue_name: string | null;
  address: string;
  lat: number;
  lng: number;
  rating: number | null;
  review_count: number | null;
  lowest_price_text: string | null;
  lowest_price_platform: string | null;
  source_url: string | null;
  image_url: string | null;
  tags_json: string | null;
  amenities_json: string | null;
  offers_json: string | null;
  data_updated_at: string | null;
}

type DiscoveryItem = Festival | FreeEvent;

interface DiscoveryRowPayload {
  id: string;
  type: "festival";
  source: string;
  sourceItemId: string;
  title: string;
  subtitle: string | null;
  categoryText: string | null;
  startDate: string | null;
  endDate: string | null;
  status: "ongoing" | "upcoming" | null;
  isFree: number | null;
  venueName: string | null;
  address: string;
  lat: number;
  lng: number;
  rating: number | null;
  reviewCount: number | null;
  lowestPriceText: string | null;
  lowestPricePlatform: string | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  tagsJson: string | null;
  amenitiesJson: string | null;
  offersJson: string | null;
  rawPayload: string;
  dataUpdatedAt: string;
}

export async function queryFestivalsFromCache(
  db: D1Database,
  lat: number,
  lng: number,
  options: DiscoveryQueryOptions,
): Promise<Festival[]> {
  const rows = await queryDiscoveryRows(db, "festival", lat, lng, options);
  return rows.map((row) => mapFestivalRow(row, lat, lng));
}

export async function queryEventsFromCache(
  db: D1Database,
  lat: number,
  lng: number,
  options: DiscoveryQueryOptions,
): Promise<FreeEvent[]> {
  const rows = await queryDiscoveryRows(db, "event", lat, lng, options);
  return rows
    .map((row) => mapEventRow(row, lat, lng))
    .filter((item) => !options.freeOnly || item.isFree);
}

export async function queryDiscoveryClusters(
  db: D1Database,
  types: DiscoveryType[],
  lat: number,
  lng: number,
  options: Pick<DiscoveryQueryOptions, "radiusMeters">,
  clusterMeters: number,
): Promise<DiscoveryCluster[]> {
  const rows = (
    await Promise.all(
      types.map((type) =>
        queryDiscoveryRows(
          db,
          type,
          lat,
          lng,
          { ...options, upcomingWithinDays: 365 },
          DISCOVERY_CLUSTER_RESULT_LIMIT,
        ),
      ),
    )
  ).flat();
  const clusters = new Map<
    string,
    { type: DiscoveryType; latSum: number; lngSum: number; count: number }
  >();
  for (const row of rows) {
    const latStep = clusterMeters / 111320;
    const lngStep =
      clusterMeters /
      Math.max(40000, 111320 * Math.cos((row.lat * Math.PI) / 180));
    const key = `${row.type}:${Math.round(row.lat / latStep)}:${Math.round(row.lng / lngStep)}`;
    const cluster = clusters.get(key) ?? {
      type: row.type,
      latSum: 0,
      lngSum: 0,
      count: 0,
    };
    cluster.latSum += row.lat;
    cluster.lngSum += row.lng;
    cluster.count += 1;
    clusters.set(key, cluster);
  }
  return [...clusters.entries()].map(([id, cluster]) => ({
    id,
    type: cluster.type,
    lat: cluster.latSum / cluster.count,
    lng: cluster.lngSum / cluster.count,
    count: cluster.count,
  }));
}

export async function syncDiscoveryCache(
  db: D1Database,
  runtime: DiscoverySyncRuntime,
  kinds: DiscoverySyncKind[],
): Promise<DiscoverySyncResult[]> {
  const results: DiscoverySyncResult[] = [];
  for (const kind of kinds) {
    const run = await startSyncRun(db, `discover:${kind}`);
    try {
      const result = await syncDiscoveryKind(db, runtime, kind);
      await finishSyncRun(db, run.id, "success", result);
      results.push(result);
    } catch (error) {
      const failed = {
        syncType: `discover:${kind}`,
        fetched: 0,
        upserted: 0,
        skipped: 0,
        pruned: 0,
        sources: {},
        generatedAt: new Date().toISOString(),
      };
      await finishSyncRun(
        db,
        run.id,
        "failed",
        failed,
        error instanceof Error ? error.message : "Unknown error",
      );
      throw error;
    }
  }
  return results;
}

async function syncDiscoveryKind(
  db: D1Database,
  runtime: DiscoverySyncRuntime,
  kind: DiscoverySyncKind,
  providerAllowlist?: ReadonlySet<string>,
): Promise<DiscoverySyncResult> {
  const generatedAt = new Date().toISOString();
  const centers = centersForKind();
  const batches = await mapWithConcurrency(
    centers,
    discoverySyncConcurrency(),
    async (center) => {
      const query = {
        lat: center.lat,
        lng: center.lng,
        radiusMeters: DISCOVERY_SYNC_RADIUS_METERS,
        upcomingWithinDays: 365,
        providerAllowlist,
      };
      return fetchDiscoveryCenterWithTimeout(runtime, kind, center.id, query);
    },
  );
  const items = dedupeItems(batches.flat());
  const sources = countSources(items);
  const validItems = items.filter(
    (item) => Number.isFinite(item.lat) && Number.isFinite(item.lng),
  );
  const skipped = items.length - validItems.length;
  const upserted = await upsertDiscoveryItems(db, validItems, generatedAt);
  const pruned =
    kind === "events" ? 0 : await pruneStaleDiscovery(db, typeForKind(kind));
  return {
    syncType: `discover:${kind}`,
    fetched: items.length,
    upserted,
    skipped,
    pruned,
    sources,
    generatedAt,
  };
}

export async function syncDiscoveryChunk(
  db: D1Database,
  runtime: DiscoverySyncRuntime,
  chunkIndex: number,
): Promise<DiscoverySyncResult> {
  const normalized =
    ((chunkIndex % DISCOVERY_PROVIDER_CHUNK_COUNT) +
      DISCOVERY_PROVIDER_CHUNK_COUNT) %
    DISCOVERY_PROVIDER_CHUNK_COUNT;
  const chunk = DISCOVERY_PROVIDER_CHUNKS[normalized];
  const providerSet = new Set(chunk.providers);
  const syncType = `discover:${chunk.kind}:${chunk.providers.join("+")}`;
  const run = await startSyncRun(db, syncType);
  try {
    const result = await syncDiscoveryKind(
      db,
      runtime,
      chunk.kind,
      providerSet,
    );
    const annotated = { ...result, syncType };
    await finishSyncRun(db, run.id, "success", annotated);
    return annotated;
  } catch (error) {
    const failed = {
      syncType,
      fetched: 0,
      upserted: 0,
      skipped: 0,
      pruned: 0,
      sources: {},
      generatedAt: new Date().toISOString(),
    };
    await finishSyncRun(
      db,
      run.id,
      "failed",
      failed,
      error instanceof Error ? error.message : "Unknown error",
    );
    throw error;
  }
}

function centersForKind(): Array<{ id: string; lat: number; lng: number }> {
  return NATIONAL_DISCOVERY_CENTERS;
}

async function queryDiscoveryRows(
  db: D1Database,
  type: DiscoveryType,
  lat: number,
  lng: number,
  options: DiscoveryQueryOptions,
  limit = DISCOVERY_RESULT_LIMIT,
): Promise<DiscoveryItemRow[]> {
  const radiusMeters = options.radiusMeters;
  const latDelta = radiusMeters / 111320;
  const lngDelta =
    radiusMeters / Math.max(40000, 111320 * Math.cos((lat * Math.PI) / 180));
  const minSeenAt = new Date(
    Date.now() - DISCOVERY_STALE_DAYS[type] * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rows = await db
    .prepare(
      `SELECT *
       FROM discovery_items
       WHERE type = ?
         AND lat BETWEEN ? AND ?
         AND lng BETWEEN ? AND ?
         AND last_seen_at >= ?
       LIMIT ?`,
    )
    .bind(
      type,
      lat - latDelta,
      lat + latDelta,
      lng - lngDelta,
      lng + lngDelta,
      minSeenAt,
      Math.max(limit + 500, limit),
    )
    .all<DiscoveryItemRow>();
  return (rows.results ?? [])
    .filter((row) => distanceMeters(lat, lng, row.lat, row.lng) <= radiusMeters)
    .filter((row) => rowPassesFilters(row, options))
    .sort((a, b) => sortDiscoveryRows(a, b, lat, lng))
    .slice(0, limit);
}

const DISCOVERY_UPSERT_BATCH_SIZE = 50;

const DISCOVERY_UPSERT_SQL = `INSERT INTO discovery_items (
        id, type, source, source_item_id, title, subtitle, category_text,
        start_date, end_date, status, is_free, venue_name, address, lat, lng,
        rating, review_count, lowest_price_text, lowest_price_platform,
        source_url, image_url, tags_json, amenities_json, offers_json, raw_payload,
        data_updated_at, first_seen_at, last_seen_at, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        source = excluded.source,
        source_item_id = excluded.source_item_id,
        title = excluded.title,
        subtitle = excluded.subtitle,
        category_text = excluded.category_text,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        status = excluded.status,
        is_free = excluded.is_free,
        venue_name = excluded.venue_name,
        address = excluded.address,
        lat = excluded.lat,
        lng = excluded.lng,
        rating = excluded.rating,
        review_count = excluded.review_count,
        lowest_price_text = excluded.lowest_price_text,
        lowest_price_platform = excluded.lowest_price_platform,
        source_url = excluded.source_url,
        image_url = excluded.image_url,
        tags_json = excluded.tags_json,
        amenities_json = excluded.amenities_json,
        offers_json = excluded.offers_json,
        raw_payload = excluded.raw_payload,
        data_updated_at = excluded.data_updated_at,
        last_seen_at = excluded.last_seen_at,
        synced_at = excluded.synced_at`;

function prepareDiscoveryUpsert(
  db: D1Database,
  item: DiscoveryItem,
  syncedAt: string,
): D1PreparedStatement {
  const row = discoveryRow(item, syncedAt);
  return db
    .prepare(DISCOVERY_UPSERT_SQL)
    .bind(
      row.id,
      row.type,
      row.source,
      row.sourceItemId,
      row.title,
      row.subtitle,
      row.categoryText,
      row.startDate,
      row.endDate,
      row.status,
      row.isFree,
      row.venueName,
      row.address,
      row.lat,
      row.lng,
      row.rating,
      row.reviewCount,
      row.lowestPriceText,
      row.lowestPricePlatform,
      row.sourceUrl,
      row.imageUrl,
      row.tagsJson,
      row.amenitiesJson,
      row.offersJson,
      row.rawPayload,
      row.dataUpdatedAt,
      syncedAt,
      syncedAt,
      syncedAt,
    );
}

async function upsertDiscoveryItems(
  db: D1Database,
  items: DiscoveryItem[],
  syncedAt: string,
): Promise<number> {
  if (items.length === 0) return 0;
  let upserted = 0;
  for (
    let start = 0;
    start < items.length;
    start += DISCOVERY_UPSERT_BATCH_SIZE
  ) {
    const slice = items.slice(start, start + DISCOVERY_UPSERT_BATCH_SIZE);
    const statements = slice.map((item) =>
      prepareDiscoveryUpsert(db, item, syncedAt),
    );
    await db.batch(statements);
    upserted += slice.length;
  }
  return upserted;
}

function discoveryRow(
  item: DiscoveryItem,
  syncedAt: string,
): DiscoveryRowPayload {
  const isEvent = "eventType" in item;
  // Public API events are intentionally folded into the festival discovery domain for one map toggle and one cache type.
  return {
    id: isEvent ? `festival:${item.source}:${item.id}` : `festival:${item.id}`,
    type: "festival",
    source: item.source,
    sourceItemId: item.id,
    title: item.title,
    subtitle: isEvent ? item.shortDescription : item.subtitle,
    categoryText: isEvent ? item.eventType : item.tags.join(","),
    startDate: item.startDate,
    endDate: item.endDate,
    status: item.status,
    isFree: isEvent ? (item.isFree ? 1 : 0) : null,
    venueName: item.venueName,
    address: item.address,
    lat: item.lat,
    lng: item.lng,
    rating: null,
    reviewCount: null,
    lowestPriceText: isEvent ? (item.price ?? null) : null,
    lowestPricePlatform: null,
    sourceUrl: item.sourceUrl,
    imageUrl: item.imageUrl,
    tagsJson: isEvent ? null : JSON.stringify(item.tags),
    amenitiesJson: null,
    offersJson: null,
    rawPayload: JSON.stringify(item),
    dataUpdatedAt: syncedAt,
  };
}

async function pruneStaleDiscovery(
  db: D1Database,
  type: DiscoveryType,
): Promise<number> {
  const minSeenAt = new Date(
    Date.now() - DISCOVERY_STALE_DAYS[type] * 24 * 60 * 60 * 1000,
  ).toISOString();
  const result = await db
    .prepare("DELETE FROM discovery_items WHERE type = ? AND last_seen_at < ?")
    .bind(type, minSeenAt)
    .run();
  return result.meta.changes ?? 0;
}

function mapFestivalRow(
  row: DiscoveryItemRow,
  lat: number,
  lng: number,
): Festival {
  return {
    id: row.source_item_id,
    title: row.title,
    subtitle: row.subtitle,
    startDate: row.start_date ?? "",
    endDate: row.end_date ?? row.start_date ?? "",
    status: row.status ?? "upcoming",
    venueName: row.venue_name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    distanceMeters: distanceMeters(lat, lng, row.lat, row.lng),
    source: row.source,
    sourceUrl: row.source_url,
    imageUrl: row.image_url,
    tags:
      parseJsonArray<string>(row.tags_json).length > 0
        ? parseJsonArray<string>(row.tags_json)
        : (row.category_text ?? "public-culture")
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
  };
}

function mapEventRow(
  row: DiscoveryItemRow,
  lat: number,
  lng: number,
): FreeEvent {
  return {
    id: row.source_item_id,
    title: row.title,
    eventType: row.category_text ?? "event",
    category: eventCategory(row.category_text),
    sourceId: row.source_item_id,
    startDate: row.start_date ?? "",
    endDate: row.end_date ?? row.start_date ?? "",
    status: row.status ?? "upcoming",
    isFree: Boolean(row.is_free),
    venueName: row.venue_name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    distanceMeters: distanceMeters(lat, lng, row.lat, row.lng),
    source: row.source,
    sourceUrl: row.source_url,
    imageUrl: row.image_url,
    shortDescription: row.subtitle,
    price: row.lowest_price_text,
    region: null,
    updatedAt: row.data_updated_at ?? undefined,
  };
}

function eventCategory(value: string | null): EventCategory {
  const allowed: EventCategory[] = [
    "festival",
    "performance",
    "exhibition",
    "culture",
    "local_event",
    "other",
  ];
  return allowed.includes(value as EventCategory)
    ? (value as EventCategory)
    : "other";
}

function rowPassesFilters(
  row: DiscoveryItemRow,
  options: DiscoveryQueryOptions,
): boolean {
  if (options.ongoingOnly && row.status !== "ongoing") return false;
  if (row.type === "event" && options.freeOnly && !row.is_free) return false;
  if (!row.start_date || !row.end_date) return true;
  const end = Date.parse(row.end_date);
  if (!Number.isFinite(end)) return true;
  const max = Date.now() + options.upcomingWithinDays * 24 * 60 * 60 * 1000;
  return end >= startOfToday() && Date.parse(row.start_date) <= max;
}

function sortDiscoveryRows(
  a: DiscoveryItemRow,
  b: DiscoveryItemRow,
  lat: number,
  lng: number,
): number {
  if (a.status !== b.status) {
    if (a.status === "ongoing") return -1;
    if (b.status === "ongoing") return 1;
  }
  return (
    distanceMeters(lat, lng, a.lat, a.lng) -
    distanceMeters(lat, lng, b.lat, b.lng)
  );
}

function dedupeItems<T extends DiscoveryItem>(items: T[]): T[] {
  const selected = new Map<string, T>();
  for (const item of items) {
    const type = "eventType" in item ? "event" : "festival";
    selected.set(`${type}:${item.source}:${item.id}`, item);
  }
  return [...selected.values()];
}

function countSources(items: DiscoveryItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.source] = (counts[item.source] ?? 0) + 1;
  }
  return counts;
}

async function startSyncRun(
  db: D1Database,
  syncType: string,
): Promise<{ id: string }> {
  const id = `${syncType}:${crypto.randomUUID()}`;
  await db
    .prepare(
      "INSERT INTO sync_runs (id, sync_type, started_at, status) VALUES (?, ?, ?, ?)",
    )
    .bind(id, syncType, new Date().toISOString(), "running")
    .run();
  return { id };
}

export async function reapStaleSyncRuns(
  db: D1Database,
  olderThanMs: number = 10 * 60 * 1000,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const result = await db
    .prepare(
      `UPDATE sync_runs
         SET finished_at = ?, status = 'timeout', message = COALESCE(message, 'reaped: stale running')
         WHERE status = 'running' AND started_at < ?`,
    )
    .bind(new Date().toISOString(), cutoff)
    .run();
  const changes =
    (result.meta as { changes?: number } | undefined)?.changes ?? 0;
  if (changes > 0) {
    console.info(`reapStaleSyncRuns marked ${changes} stale runs as timeout`);
  }
  return changes;
}

async function fetchDiscoveryCenterWithTimeout(
  runtime: DiscoverySyncRuntime,
  kind: DiscoverySyncKind,
  centerId: string,
  query: SyncDiscoverQuery,
): Promise<DiscoveryItem[]> {
  const timeoutMs = discoverySyncFetchTimeoutMs();
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const work =
    kind === "festivals"
      ? runtime.festivalService.nearby({ ...query, signal: controller.signal })
      : runtime.eventService.nearby({ ...query, signal: controller.signal });
  const guardedWork = work.catch((error) => {
    if (controller.signal.aborted) return [];
    throw error;
  });
  const timeout = new Promise<DiscoveryItem[]>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      console.info(
        `discovery sync ${kind} center=${centerId} timed out after ${timeoutMs}ms`,
      );
      resolve([]);
    }, timeoutMs);
  });
  try {
    return await Promise.race([guardedWork, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function discoverySyncConcurrency(): number {
  return positiveIntegerFromEnv(
    "DISCOVERY_SYNC_CONCURRENCY",
    DEFAULT_DISCOVERY_SYNC_CONCURRENCY,
  );
}

function discoverySyncFetchTimeoutMs(): number {
  return positiveIntegerFromEnv(
    "DISCOVERY_SYNC_FETCH_TIMEOUT_MS",
    DEFAULT_DISCOVERY_SYNC_FETCH_TIMEOUT_MS,
  );
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function finishSyncRun(
  db: D1Database,
  id: string,
  status: "success" | "failed",
  result: DiscoverySyncResult,
  message: string | null = null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE sync_runs
       SET finished_at = ?, status = ?, fetched = ?, upserted = ?, skipped = ?, pruned = ?, message = ?
       WHERE id = ?`,
    )
    .bind(
      new Date().toISOString(),
      status,
      result.fetched,
      result.upserted,
      result.skipped,
      result.pruned,
      message,
      id,
    )
    .run();
}

function typeForKind(kind: DiscoverySyncKind): DiscoveryType {
  if (kind === "festivals") return "festival";
  return "event";
}

function parseJsonArray<T>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function startOfToday(): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
