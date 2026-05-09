import type { Festival, FreeEvent, LodgingOption } from "@parking/shared-types";
import { distanceMeters } from "../../backend/src/services/geo.js";

type DiscoveryType = "festival" | "event" | "lodging";
type DiscoverySyncKind = "festivals" | "events" | "lodging";

const DISCOVERY_RESULT_LIMIT = 1000;
const DISCOVERY_CLUSTER_RESULT_LIMIT = 5000;
const DISCOVERY_STALE_DAYS: Record<DiscoveryType, number> = {
  festival: 45,
  event: 45,
  lodging: 14
};
const DISCOVERY_SYNC_RADIUS_METERS = 90000;
const LODGING_SYNC_RADIUS_METERS = 80000;
const DEFAULT_LODGING_CENTERS_PER_RUN = 4;

const NATIONAL_DISCOVERY_CENTERS: Array<{ id: string; lat: number; lng: number }> = [
  { id: "seoul", lat: 37.5665, lng: 126.9780 },
  { id: "busan", lat: 35.1796, lng: 129.0756 },
  { id: "daegu", lat: 35.8714, lng: 128.6014 },
  { id: "incheon", lat: 37.4563, lng: 126.7052 },
  { id: "gwangju", lat: 35.1595, lng: 126.8526 },
  { id: "daejeon", lat: 36.3504, lng: 127.3845 },
  { id: "ulsan", lat: 35.5384, lng: 129.3114 },
  { id: "sejong", lat: 36.4800, lng: 127.2890 },
  { id: "suwon", lat: 37.2636, lng: 127.0286 },
  { id: "chuncheon", lat: 37.8813, lng: 127.7298 },
  { id: "cheongju", lat: 36.6424, lng: 127.4890 },
  { id: "jeonju", lat: 35.8242, lng: 127.1480 },
  { id: "mokpo", lat: 34.8118, lng: 126.3922 },
  { id: "andong", lat: 36.5684, lng: 128.7294 },
  { id: "changwon", lat: 35.2279, lng: 128.6811 },
  { id: "gangneung", lat: 37.7519, lng: 128.8761 },
  { id: "jeju", lat: 33.4996, lng: 126.5312 }
];

const SEOUL_DISCOVERY_CENTER = { id: "seoul", lat: 37.5665, lng: 126.9780 };

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
  lodgingService: { nearby(query: SyncDiscoverQuery): Promise<LodgingOption[]> };
}

export interface DiscoverySyncResult {
  syncType: string;
  fetched: number;
  upserted: number;
  skipped: number;
  pruned: number;
  generatedAt: string;
}

interface SyncDiscoverQuery {
  lat: number;
  lng: number;
  radiusMeters: number;
  upcomingWithinDays: number;
  ongoingOnly?: boolean;
  freeOnly?: boolean;
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

type DiscoveryItem = Festival | FreeEvent | LodgingOption;

export async function queryFestivalsFromCache(
  db: D1Database,
  lat: number,
  lng: number,
  options: DiscoveryQueryOptions
): Promise<Festival[]> {
  const rows = await queryDiscoveryRows(db, "festival", lat, lng, options);
  return rows.map((row) => mapFestivalRow(row, lat, lng));
}

export async function queryEventsFromCache(
  db: D1Database,
  lat: number,
  lng: number,
  options: DiscoveryQueryOptions
): Promise<FreeEvent[]> {
  const rows = await queryDiscoveryRows(db, "event", lat, lng, options);
  return rows.map((row) => mapEventRow(row, lat, lng)).filter((item) => !options.freeOnly || item.isFree);
}

export async function queryLodgingFromCache(
  db: D1Database,
  lat: number,
  lng: number,
  options: DiscoveryQueryOptions
): Promise<LodgingOption[]> {
  const rows = await queryDiscoveryRows(db, "lodging", lat, lng, options);
  return rows.map((row) => mapLodgingRow(row, lat, lng));
}

export async function queryDiscoveryClusters(
  db: D1Database,
  types: DiscoveryType[],
  lat: number,
  lng: number,
  options: Pick<DiscoveryQueryOptions, "radiusMeters">,
  clusterMeters: number
): Promise<DiscoveryCluster[]> {
  const rows = (
    await Promise.all(
      types.map((type) => queryDiscoveryRows(db, type, lat, lng, { ...options, upcomingWithinDays: 365 }, DISCOVERY_CLUSTER_RESULT_LIMIT))
    )
  ).flat();
  const clusters = new Map<string, { type: DiscoveryType; latSum: number; lngSum: number; count: number }>();
  for (const row of rows) {
    const latStep = clusterMeters / 111320;
    const lngStep = clusterMeters / Math.max(40000, 111320 * Math.cos((row.lat * Math.PI) / 180));
    const key = `${row.type}:${Math.round(row.lat / latStep)}:${Math.round(row.lng / lngStep)}`;
    const cluster = clusters.get(key) ?? { type: row.type, latSum: 0, lngSum: 0, count: 0 };
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
    count: cluster.count
  }));
}

export async function syncDiscoveryCache(
  db: D1Database,
  runtime: DiscoverySyncRuntime,
  kinds: DiscoverySyncKind[],
  options: { lodgingCentersPerRun?: number } = {}
): Promise<DiscoverySyncResult[]> {
  const results: DiscoverySyncResult[] = [];
  for (const kind of kinds) {
    const run = await startSyncRun(db, `discover:${kind}`);
    try {
      const result = await syncDiscoveryKind(db, runtime, kind, options);
      await finishSyncRun(db, run.id, "success", result);
      results.push(result);
    } catch (error) {
      const failed = {
        syncType: `discover:${kind}`,
        fetched: 0,
        upserted: 0,
        skipped: 0,
        pruned: 0,
        generatedAt: new Date().toISOString()
      };
      await finishSyncRun(db, run.id, "failed", failed, error instanceof Error ? error.message : "Unknown error");
      throw error;
    }
  }
  return results;
}

async function syncDiscoveryKind(
  db: D1Database,
  runtime: DiscoverySyncRuntime,
  kind: DiscoverySyncKind,
  options: { lodgingCentersPerRun?: number }
): Promise<DiscoverySyncResult> {
  const generatedAt = new Date().toISOString();
  const centers = await centersForKind(db, kind, options.lodgingCentersPerRun ?? DEFAULT_LODGING_CENTERS_PER_RUN);
  const batches = await Promise.all(
    centers.map((center) => {
      const query = {
        lat: center.lat,
        lng: center.lng,
        radiusMeters: kind === "lodging" ? LODGING_SYNC_RADIUS_METERS : DISCOVERY_SYNC_RADIUS_METERS,
        upcomingWithinDays: 365,
        freeOnly: kind === "events" ? true : undefined
      };
      if (kind === "festivals") return runtime.festivalService.nearby(query);
      if (kind === "events") return runtime.eventService.nearby(query);
      return runtime.lodgingService.nearby(query);
    })
  );
  const items = dedupeItems(batches.flat());
  let upserted = 0;
  let skipped = 0;
  for (const item of items) {
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) {
      skipped += 1;
      continue;
    }
    await upsertDiscoveryItem(db, item, generatedAt);
    upserted += 1;
  }
  const pruned = await pruneStaleDiscovery(db, typeForKind(kind));
  return { syncType: `discover:${kind}`, fetched: items.length, upserted, skipped, pruned, generatedAt };
}

async function centersForKind(
  db: D1Database,
  kind: DiscoverySyncKind,
  lodgingCentersPerRun: number
): Promise<Array<{ id: string; lat: number; lng: number }>> {
  if (kind === "events") return [SEOUL_DISCOVERY_CENTER];
  if (kind === "festivals") return NATIONAL_DISCOVERY_CENTERS;
  const centerCount = Math.min(lodgingCentersPerRun, NATIONAL_DISCOVERY_CENTERS.length);
  const start = await nextCursor(db, "lodging_center_cursor", NATIONAL_DISCOVERY_CENTERS.length, centerCount);
  return Array.from({ length: centerCount }, (_, index) => {
    return NATIONAL_DISCOVERY_CENTERS[(start + index) % NATIONAL_DISCOVERY_CENTERS.length];
  });
}

async function queryDiscoveryRows(
  db: D1Database,
  type: DiscoveryType,
  lat: number,
  lng: number,
  options: DiscoveryQueryOptions,
  limit = DISCOVERY_RESULT_LIMIT
): Promise<DiscoveryItemRow[]> {
  const radiusMeters = options.radiusMeters;
  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / Math.max(40000, 111320 * Math.cos((lat * Math.PI) / 180));
  const minSeenAt = new Date(Date.now() - DISCOVERY_STALE_DAYS[type] * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db
    .prepare(
      `SELECT *
       FROM discovery_items
       WHERE type = ?
         AND lat BETWEEN ? AND ?
         AND lng BETWEEN ? AND ?
         AND last_seen_at >= ?
       LIMIT ?`
    )
    .bind(type, lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta, minSeenAt, Math.max(limit + 500, limit))
    .all<DiscoveryItemRow>();
  return (rows.results ?? [])
    .filter((row) => distanceMeters(lat, lng, row.lat, row.lng) <= radiusMeters)
    .filter((row) => rowPassesFilters(row, options))
    .sort((a, b) => sortDiscoveryRows(a, b, lat, lng))
    .slice(0, limit);
}

async function upsertDiscoveryItem(db: D1Database, item: DiscoveryItem, syncedAt: string): Promise<void> {
  const row = discoveryRow(item, syncedAt);
  await db
    .prepare(
      `INSERT INTO discovery_items (
        id, type, source, source_item_id, title, subtitle, category_text,
        start_date, end_date, status, is_free, venue_name, address, lat, lng,
        rating, review_count, lowest_price_text, lowest_price_platform,
        source_url, image_url, tags_json, amenities_json, offers_json, raw_payload,
        data_updated_at, first_seen_at, last_seen_at, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(type, source, source_item_id) DO UPDATE SET
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
        synced_at = excluded.synced_at`
    )
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
      syncedAt
    )
    .run();
}

function discoveryRow(item: DiscoveryItem, syncedAt: string) {
  if ("name" in item) {
    return {
      id: `lodging:${item.id}`,
      type: "lodging" as const,
      source: item.source,
      sourceItemId: item.id,
      title: item.name,
      subtitle: null,
      categoryText: item.lodgingType,
      startDate: null,
      endDate: null,
      status: null,
      isFree: null,
      venueName: item.lowestPricePlatform,
      address: item.address,
      lat: item.lat,
      lng: item.lng,
      rating: item.rating,
      reviewCount: item.reviewCount,
      lowestPriceText: item.lowestPriceText,
      lowestPricePlatform: item.lowestPricePlatform,
      sourceUrl: item.sourceUrl,
      imageUrl: item.imageUrl,
      tagsJson: null,
      amenitiesJson: JSON.stringify(item.amenities),
      offersJson: JSON.stringify(item.offers),
      rawPayload: JSON.stringify(item),
      dataUpdatedAt: syncedAt
    };
  }
  if ("eventType" in item) {
    return {
      id: `event:${item.id}`,
      type: "event" as const,
      source: item.source,
      sourceItemId: item.id,
      title: item.title,
      subtitle: item.shortDescription,
      categoryText: item.eventType,
      startDate: item.startDate,
      endDate: item.endDate,
      status: item.status,
      isFree: item.isFree ? 1 : 0,
      venueName: item.venueName,
      address: item.address,
      lat: item.lat,
      lng: item.lng,
      rating: null,
      reviewCount: null,
      lowestPriceText: null,
      lowestPricePlatform: null,
      sourceUrl: item.sourceUrl,
      imageUrl: item.imageUrl,
      tagsJson: null,
      amenitiesJson: null,
      offersJson: null,
      rawPayload: JSON.stringify(item),
      dataUpdatedAt: syncedAt
    };
  }
  return {
    id: `festival:${item.id}`,
    type: "festival" as const,
    source: item.source,
    sourceItemId: item.id,
    title: item.title,
    subtitle: item.subtitle,
    categoryText: item.tags.join(","),
    startDate: item.startDate,
    endDate: item.endDate,
    status: item.status,
    isFree: null,
    venueName: item.venueName,
    address: item.address,
    lat: item.lat,
    lng: item.lng,
    rating: null,
    reviewCount: null,
    lowestPriceText: null,
    lowestPricePlatform: null,
    sourceUrl: item.sourceUrl,
    imageUrl: item.imageUrl,
    tagsJson: JSON.stringify(item.tags),
    amenitiesJson: null,
    offersJson: null,
    rawPayload: JSON.stringify(item),
    dataUpdatedAt: syncedAt
  };
}

async function pruneStaleDiscovery(db: D1Database, type: DiscoveryType): Promise<number> {
  const minSeenAt = new Date(Date.now() - DISCOVERY_STALE_DAYS[type] * 24 * 60 * 60 * 1000).toISOString();
  const result = await db.prepare("DELETE FROM discovery_items WHERE type = ? AND last_seen_at < ?").bind(type, minSeenAt).run();
  return result.meta.changes ?? 0;
}

function mapFestivalRow(row: DiscoveryItemRow, lat: number, lng: number): Festival {
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
    tags: parseJsonArray<string>(row.tags_json)
  };
}

function mapEventRow(row: DiscoveryItemRow, lat: number, lng: number): FreeEvent {
  return {
    id: row.source_item_id,
    title: row.title,
    eventType: row.category_text ?? "event",
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
    shortDescription: row.subtitle
  };
}

function mapLodgingRow(row: DiscoveryItemRow, lat: number, lng: number): LodgingOption {
  return {
    id: row.source_item_id,
    name: row.title,
    lodgingType: row.category_text ?? "lodging",
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    distanceMeters: distanceMeters(lat, lng, row.lat, row.lng),
    rating: row.rating,
    reviewCount: row.review_count,
    imageUrl: row.image_url,
    source: row.source,
    sourceUrl: row.source_url,
    lowestPriceText: row.lowest_price_text,
    lowestPricePlatform: row.lowest_price_platform,
    offers: parseJsonArray<LodgingOption["offers"][number]>(row.offers_json),
    amenities: parseJsonArray<string>(row.amenities_json)
  };
}

function rowPassesFilters(row: DiscoveryItemRow, options: DiscoveryQueryOptions): boolean {
  if (options.ongoingOnly && row.status !== "ongoing") return false;
  if (row.type === "event" && options.freeOnly && !row.is_free) return false;
  if (!row.start_date || !row.end_date) return true;
  const end = Date.parse(row.end_date);
  if (!Number.isFinite(end)) return true;
  const max = Date.now() + options.upcomingWithinDays * 24 * 60 * 60 * 1000;
  return end >= startOfToday() && Date.parse(row.start_date) <= max;
}

function sortDiscoveryRows(a: DiscoveryItemRow, b: DiscoveryItemRow, lat: number, lng: number): number {
  if (a.status !== b.status) {
    if (a.status === "ongoing") return -1;
    if (b.status === "ongoing") return 1;
  }
  return distanceMeters(lat, lng, a.lat, a.lng) - distanceMeters(lat, lng, b.lat, b.lng);
}

function dedupeItems<T extends DiscoveryItem>(items: T[]): T[] {
  const selected = new Map<string, T>();
  for (const item of items) {
    const type = "name" in item ? "lodging" : "eventType" in item ? "event" : "festival";
    selected.set(`${type}:${item.source}:${item.id}`, item);
  }
  return [...selected.values()];
}

async function nextCursor(db: D1Database, key: string, modulo: number, step: number): Promise<number> {
  const now = new Date().toISOString();
  const row = await db.prepare("SELECT value FROM sync_state WHERE key = ?").bind(key).first<{ value: string }>();
  const current = Number(row?.value ?? "0");
  const next = (Number.isFinite(current) ? current + step : step) % modulo;
  await db
    .prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(key, String(next), now)
    .run();
  return Number.isFinite(current) ? current : 0;
}

async function startSyncRun(db: D1Database, syncType: string): Promise<{ id: string }> {
  const id = `${syncType}:${crypto.randomUUID()}`;
  await db
    .prepare("INSERT INTO sync_runs (id, sync_type, started_at, status) VALUES (?, ?, ?, ?)")
    .bind(id, syncType, new Date().toISOString(), "running")
    .run();
  return { id };
}

async function finishSyncRun(
  db: D1Database,
  id: string,
  status: "success" | "failed",
  result: DiscoverySyncResult,
  message: string | null = null
): Promise<void> {
  await db
    .prepare(
      `UPDATE sync_runs
       SET finished_at = ?, status = ?, fetched = ?, upserted = ?, skipped = ?, pruned = ?, message = ?
       WHERE id = ?`
    )
    .bind(new Date().toISOString(), status, result.fetched, result.upserted, result.skipped, result.pruned, message, id)
    .run();
}

function typeForKind(kind: DiscoverySyncKind): DiscoveryType {
  if (kind === "festivals") return "festival";
  if (kind === "events") return "event";
  return "lodging";
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
