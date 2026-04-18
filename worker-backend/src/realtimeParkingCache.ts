import type { ParkingLot, ParkingSearchOptions } from "@parking/shared-types";
import type { CompositeParkingProvider } from "../../backend/src/providers/CompositeParkingProvider.js";
import { rankParkingLots } from "../../backend/src/ranking/rankParking.js";
import { distanceMeters } from "../../backend/src/services/geo.js";

const KOREA_REALTIME_SYNC_CENTER = { lat: 36.35, lng: 127.8 };
const KOREA_REALTIME_SYNC_RADIUS_METERS = 460000;
const REALTIME_CACHE_MAX_AGE_SECONDS = 45 * 60;
const REALTIME_CACHE_RESULT_LIMIT = 1000;
const REALTIME_CLUSTER_RESULT_LIMIT = 5000;

export interface RealtimeCacheSyncResult {
  fetched: number;
  upserted: number;
  skipped: number;
  pruned: number;
  generatedAt: string;
}

export interface RealtimeParkingCluster {
  id: string;
  lat: number;
  lng: number;
  count: number;
  availableSpaces: number | null;
  totalCapacity: number | null;
  congestionStatus: ParkingLot["congestionStatus"];
}

export async function syncRealtimeParkingCache(
  db: D1Database,
  provider: CompositeParkingProvider
): Promise<RealtimeCacheSyncResult> {
  const generatedAt = new Date().toISOString();
  const items = (await provider.nearby(KOREA_REALTIME_SYNC_CENTER.lat, KOREA_REALTIME_SYNC_CENTER.lng, {
    radiusMeters: KOREA_REALTIME_SYNC_RADIUS_METERS
  })).filter((item) => item.realtimeAvailable && item.availableSpaces !== null);

  let upserted = 0;
  let skipped = 0;
  for (const item of items) {
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) {
      skipped += 1;
      continue;
    }
    await upsertRealtimeParking(db, item, generatedAt);
    upserted += 1;
  }
  const pruned = await pruneUnseenRealtimeParking(db, generatedAt);

  return { fetched: items.length, upserted, skipped, pruned, generatedAt };
}

export async function queryRealtimeParkingCache(
  db: D1Database,
  lat: number,
  lng: number,
  options: ParkingSearchOptions
): Promise<ParkingLot[]> {
  return queryRealtimeParkingCacheItems(db, lat, lng, options, REALTIME_CACHE_RESULT_LIMIT);
}

async function queryRealtimeParkingCacheItems(
  db: D1Database,
  lat: number,
  lng: number,
  options: ParkingSearchOptions,
  limit: number
): Promise<ParkingLot[]> {
  const radiusMeters = options.radiusMeters;
  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / Math.max(40000, 111320 * Math.cos((lat * Math.PI) / 180));
  const minSeenAt = new Date(Date.now() - REALTIME_CACHE_MAX_AGE_SECONDS * 1000).toISOString();
  const rows = await db
    .prepare(
      `SELECT *
       FROM realtime_parking_status
       WHERE lat BETWEEN ? AND ?
         AND lng BETWEEN ? AND ?
         AND last_seen_at >= ?
       LIMIT ?`
    )
    .bind(lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta, minSeenAt, Math.max(limit + 500, limit))
    .all<RealtimeParkingStatusRow>();

  const items = (rows.results ?? [])
    .map((row) => mapRealtimeStatusRow(row, lat, lng))
    .filter((item) => item.distanceFromDestinationMeters <= radiusMeters);
  return rankParkingLots(items, options).slice(0, limit);
}

export async function queryRealtimeParkingClusters(
  db: D1Database,
  lat: number,
  lng: number,
  options: ParkingSearchOptions,
  clusterMeters: number
): Promise<RealtimeParkingCluster[]> {
  const items = await queryRealtimeParkingCacheItems(db, lat, lng, options, REALTIME_CLUSTER_RESULT_LIMIT);
  const latStep = clusterMeters / 111320;
  const lngStep = clusterMeters / Math.max(40000, 111320 * Math.cos((lat * Math.PI) / 180));
  const clusters = new Map<string, ParkingLot[]>();

  for (const item of items) {
    const key = `${Math.round(item.lat / latStep)}:${Math.round(item.lng / lngStep)}`;
    clusters.set(key, [...(clusters.get(key) ?? []), item]);
  }

  return [...clusters.entries()].map(([id, clusterItems]) => summarizeCluster(id, clusterItems));
}

async function upsertRealtimeParking(db: D1Database, item: ParkingLot, now: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO realtime_parking_status (
        id, source, source_parking_id, name, address, lat, lng,
        total_capacity, available_spaces, occupancy_rate, congestion_status,
        realtime_available, freshness_timestamp, operating_hours, fee_summary,
        supports_ev, supports_accessible, is_public, is_private, display_status,
        raw_payload, first_seen_at, last_seen_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source = excluded.source,
        source_parking_id = excluded.source_parking_id,
        name = excluded.name,
        address = excluded.address,
        lat = excluded.lat,
        lng = excluded.lng,
        total_capacity = excluded.total_capacity,
        available_spaces = excluded.available_spaces,
        occupancy_rate = excluded.occupancy_rate,
        congestion_status = excluded.congestion_status,
        realtime_available = excluded.realtime_available,
        freshness_timestamp = excluded.freshness_timestamp,
        operating_hours = excluded.operating_hours,
        fee_summary = excluded.fee_summary,
        supports_ev = excluded.supports_ev,
        supports_accessible = excluded.supports_accessible,
        is_public = excluded.is_public,
        is_private = excluded.is_private,
        display_status = excluded.display_status,
        raw_payload = excluded.raw_payload,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at`
    )
    .bind(
      item.id,
      item.source,
      item.sourceParkingId,
      item.name,
      item.address,
      item.lat,
      item.lng,
      item.totalCapacity,
      item.availableSpaces,
      item.occupancyRate,
      item.congestionStatus,
      item.realtimeAvailable ? 1 : 0,
      item.freshnessTimestamp,
      item.operatingHours,
      item.feeSummary,
      item.supportsEv ? 1 : 0,
      item.supportsAccessible ? 1 : 0,
      item.isPublic ? 1 : 0,
      item.isPrivate ? 1 : 0,
      item.displayStatus,
      null,
      now,
      now,
      item.freshnessTimestamp ?? now
    )
    .run();
}

async function pruneUnseenRealtimeParking(db: D1Database, syncedAt: string): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM realtime_parking_status
       WHERE source IN ('seoul-realtime', 'daejeon-realtime', 'suseong-realtime', 'kac-airport-realtime', 'incheon-airport-realtime')
         AND last_seen_at < ?`
    )
    .bind(syncedAt)
    .run();
  return result.meta.changes ?? 0;
}

interface RealtimeParkingStatusRow {
  id: string;
  source: ParkingLot["source"];
  source_parking_id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  total_capacity: number | null;
  available_spaces: number | null;
  occupancy_rate: number | null;
  congestion_status: ParkingLot["congestionStatus"];
  realtime_available: number;
  freshness_timestamp: string | null;
  operating_hours: string | null;
  fee_summary: string | null;
  supports_ev: number;
  supports_accessible: number;
  is_public: number;
  is_private: number;
  display_status: string;
  raw_payload: string | null;
  last_seen_at: string;
}

function mapRealtimeStatusRow(row: RealtimeParkingStatusRow, lat: number, lng: number): ParkingLot {
  const stale = isStale(row.last_seen_at, REALTIME_CACHE_MAX_AGE_SECONDS);
  const realtimeAvailable = Boolean(row.realtime_available) && !stale;
  const totalCapacity = row.total_capacity ?? null;
  const availableSpaces = row.available_spaces ?? null;
  const occupancyRate =
    totalCapacity !== null && totalCapacity > 0 && availableSpaces !== null
      ? Math.max(0, Math.min(1, 1 - availableSpaces / totalCapacity))
      : row.occupancy_rate ?? null;
  const congestionStatus = row.congestion_status ?? inferCongestion(availableSpaces, occupancyRate);
  return {
    id: row.id,
    source: row.source,
    sourceParkingId: row.source_parking_id,
    name: row.name,
    address: row.address ?? "주소 정보 없음",
    lat: row.lat,
    lng: row.lng,
    distanceFromDestinationMeters: distanceMeters(lat, lng, row.lat, row.lng),
    totalCapacity,
    availableSpaces,
    occupancyRate,
    congestionStatus,
    realtimeAvailable,
    freshnessTimestamp: row.freshness_timestamp ?? row.last_seen_at,
    operatingHours: row.operating_hours,
    feeSummary: row.fee_summary,
    supportsEv: Boolean(row.supports_ev),
    supportsAccessible: Boolean(row.supports_accessible),
    isPublic: Boolean(row.is_public),
    isPrivate: Boolean(row.is_private),
    stale,
    displayStatus: displayStatus({ realtimeAvailable, stale, availableSpaces, congestionStatus }),
    score: 0,
    provenance: [
      {
        source: row.source,
        sourceParkingId: row.source_parking_id,
        freshnessTimestamp: row.freshness_timestamp ?? row.last_seen_at
      }
    ],
    rawSourcePayload: undefined
  };
}

function summarizeCluster(id: string, items: ParkingLot[]): RealtimeParkingCluster {
  const totalAvailable = sumNullable(items.map((item) => item.availableSpaces));
  const totalCapacity = sumNullable(items.map((item) => item.totalCapacity));
  return {
    id,
    lat: average(items.map((item) => item.lat)),
    lng: average(items.map((item) => item.lng)),
    count: items.length,
    availableSpaces: totalAvailable,
    totalCapacity,
    congestionStatus: inferCongestion(totalAvailable, clusterOccupancy(totalAvailable, totalCapacity))
  };
}

function sumNullable(values: Array<number | null>): number | null {
  const numeric = values.filter((value): value is number => value !== null);
  if (numeric.length === 0) return null;
  return numeric.reduce((sum, value) => sum + value, 0);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function clusterOccupancy(availableSpaces: number | null, totalCapacity: number | null): number | null {
  if (availableSpaces === null || totalCapacity === null || totalCapacity <= 0) return null;
  return Math.max(0, Math.min(1, 1 - availableSpaces / totalCapacity));
}

function isStale(timestamp: string | null | undefined, thresholdSeconds: number): boolean {
  if (!timestamp) return true;
  const time = new Date(timestamp).getTime();
  return Number.isNaN(time) || Date.now() - time > thresholdSeconds * 1000;
}

function inferCongestion(
  availableSpaces: number | null,
  occupancyRate: number | null
): ParkingLot["congestionStatus"] {
  if (occupancyRate !== null) {
    if (occupancyRate >= 0.98) return "full";
    if (occupancyRate >= 0.85) return "busy";
    if (occupancyRate >= 0.6) return "moderate";
    return "available";
  }
  if (availableSpaces !== null) return availableSpaces <= 2 ? "busy" : "available";
  return "unknown";
}

function displayStatus(input: {
  realtimeAvailable: boolean;
  stale: boolean;
  availableSpaces: number | null;
  congestionStatus: ParkingLot["congestionStatus"];
}): string {
  if (input.stale) return "업데이트 지연 가능";
  if (input.realtimeAvailable && input.availableSpaces !== null) return `실시간 ${input.availableSpaces}면`;
  switch (input.congestionStatus) {
    case "available":
      return "여유";
    case "moderate":
      return "보통";
    case "busy":
      return "혼잡";
    case "full":
      return "만차 임박";
    default:
      return "실시간 정보 없음";
  }
}
