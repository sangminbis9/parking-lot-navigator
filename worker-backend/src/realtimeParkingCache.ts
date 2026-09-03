import type { ParkingLot, ParkingSearchOptions } from "@parking/shared-types";
import type { CompositeParkingProvider } from "../../backend/src/providers/CompositeParkingProvider.js";
import { rankParkingLots } from "../../backend/src/ranking/rankParking.js";
import { distanceMeters } from "../../backend/src/services/geo.js";

const KOREA_REALTIME_SYNC_CENTER = { lat: 36.35, lng: 127.8 };
const KOREA_REALTIME_SYNC_RADIUS_METERS = 460000;
const REALTIME_CACHE_MAX_AGE_SECONDS = 45 * 60;

// 조건부 쓰기용 시간 예산. 세 값의 순서가 계약이다.
//   heartbeat(30분) < 조회 신선도(45분) < prune 보존(90분)
// 값이 안 바뀐 주차장은 30분에 한 번만 last_seen_at을 쓰므로, 조회 시점에
// last_seen_at이 가장 오래된 경우라도 30분 + 한 회차 간격이다. 45분 필터에
// 걸리지 않을 만큼의 여유를 남겨 둔 것이고, 이 순서가 깨지면 provider가
// 계속 주고 있는 주차장이 앱에서 사라진다.
const REALTIME_HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000;
const REALTIME_PRUNE_RETENTION_MS = 90 * 60 * 1000;
/// 좌표 비교 오차. 1e-7도는 약 1cm라 부동소수 왕복 오차만 흡수하고
/// 실제 좌표 수정은 통과시킨다.
const REALTIME_COORD_EPSILON = 1e-7;
const REALTIME_CACHE_RESULT_LIMIT = 1000;
const REALTIME_CLUSTER_RESULT_LIMIT = 5000;

export interface RealtimeCacheSyncResult {
  fetched: number;
  /// 실제로 발행한 쓰기 문장 수(inserted + changed + coordinate + heartbeat).
  upserted: number;
  inserted: number;
  changed: number;
  coordinate: number;
  heartbeat: number;
  unchangedSkipped: number;
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

export interface RealtimeCacheSyncOptions {
  /**
   * 오래된 행 정리를 이 회차에 같이 돌릴지. provider를 shard로 쪼개면 한 shard가
   * 준 항목만 last_seen_at이 갱신되지만, prune은 `last_seen_at < now - 90분`
   * 이라는 **시간 기준**이라 아직 안 돈 shard의 행을 지우지 않는다. shard가
   * 4개면 각 shard가 4분마다 한 바퀴 도므로 90분 보존과 비교해 22배 여유가 있다.
   * 다만 매 분 돌리면 하루 1,440회가 되므로 호출부가 간격을 정한다.
   */
  prune?: boolean;
}

export async function syncRealtimeParkingCache(
  db: D1Database,
  provider: CompositeParkingProvider,
  options: RealtimeCacheSyncOptions = {},
): Promise<RealtimeCacheSyncResult> {
  const generatedAt = new Date().toISOString();
  const items = (
    await provider.nearby(
      KOREA_REALTIME_SYNC_CENTER.lat,
      KOREA_REALTIME_SYNC_CENTER.lng,
      {
        radiusMeters: KOREA_REALTIME_SYNC_RADIUS_METERS,
      },
    )
  ).filter((item) => item.realtimeAvailable && item.availableSpaces !== null);

  const validItems = items.filter(
    (item) => Number.isFinite(item.lat) && Number.isFinite(item.lng),
  );
  const skipped = items.length - validItems.length;
  const counts = await upsertRealtimeParkingItems(db, validItems, generatedAt);
  const pruned = options.prune === false ? 0 : await pruneUnseenRealtimeParking(db, generatedAt);

  return {
    fetched: items.length,
    upserted: counts.writes,
    inserted: counts.inserted,
    changed: counts.changed,
    coordinate: counts.coordinate,
    heartbeat: counts.heartbeat,
    unchangedSkipped: counts.unchangedSkipped,
    skipped,
    pruned,
    generatedAt,
  };
}

const REALTIME_PARKING_UPSERT_BATCH_SIZE = 50;

export interface RealtimeUpsertCounts {
  inserted: number;
  changed: number;
  coordinate: number;
  heartbeat: number;
  unchangedSkipped: number;
  writes: number;
}

/// 비교에 쓰는 기존 행. freshness_timestamp / updated_at은 일부러 빼 놨다 —
/// 대전 피드는 원본에 시각이 없어 provider가 new Date()로 채우므로 매 회차
/// 달라지고, 그것까지 "변경"으로 치면 조건부 쓰기가 통째로 무의미해진다.
/// 값이 안 바뀐 행의 표시 시각은 heartbeat가 30분 간격으로 따라잡는다.
interface ExistingRealtimeRow {
  id: string;
  source: string;
  source_parking_id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  total_capacity: number | null;
  available_spaces: number | null;
  occupancy_rate: number | null;
  congestion_status: string | null;
  realtime_available: number;
  operating_hours: string | null;
  fee_summary: string | null;
  supports_ev: number;
  supports_accessible: number;
  is_public: number;
  is_private: number;
  display_status: string | null;
  last_seen_at: string;
}

const EXISTING_REALTIME_COLUMNS = `id, source, source_parking_id, name, address, lat, lng,
        total_capacity, available_spaces, occupancy_rate, congestion_status,
        realtime_available, operating_hours, fee_summary, supports_ev,
        supports_accessible, is_public, is_private, display_status, last_seen_at`;

const REALTIME_HEARTBEAT_SQL = `UPDATE realtime_parking_status
      SET last_seen_at = ?, freshness_timestamp = ?, updated_at = ?
      WHERE id = ?`;

/// 좌표는 본 upsert의 SET에서 빠져 있다((lat, lng) 인덱스를 매 회차 다시 쓰지
/// 않으려고 `0028`에서 뺐다). 그래서 실제로 좌표가 달라진 행만 이 문장으로
/// 따로 고친다 — 원본의 좌표 수정이 영영 반영되지 않는 회귀를 막는다.
const REALTIME_COORDINATE_SQL = `UPDATE realtime_parking_status
      SET lat = ?, lng = ? WHERE id = ?`;

function boolColumn(value: boolean | null | undefined): number {
  return value ? 1 : 0;
}

function realtimeMaterialChanged(
  existing: ExistingRealtimeRow,
  item: ParkingLot,
): boolean {
  return (
    existing.source !== item.source ||
    existing.source_parking_id !== item.sourceParkingId ||
    existing.name !== item.name ||
    (existing.address ?? null) !== (item.address ?? null) ||
    (existing.total_capacity ?? null) !== (item.totalCapacity ?? null) ||
    (existing.available_spaces ?? null) !== (item.availableSpaces ?? null) ||
    (existing.occupancy_rate ?? null) !== (item.occupancyRate ?? null) ||
    (existing.congestion_status ?? null) !== (item.congestionStatus ?? null) ||
    existing.realtime_available !== boolColumn(item.realtimeAvailable) ||
    (existing.operating_hours ?? null) !== (item.operatingHours ?? null) ||
    (existing.fee_summary ?? null) !== (item.feeSummary ?? null) ||
    existing.supports_ev !== boolColumn(item.supportsEv) ||
    existing.supports_accessible !== boolColumn(item.supportsAccessible) ||
    existing.is_public !== boolColumn(item.isPublic) ||
    existing.is_private !== boolColumn(item.isPrivate) ||
    (existing.display_status ?? null) !== (item.displayStatus ?? null)
  );
}

function realtimeCoordinateChanged(
  existing: ExistingRealtimeRow,
  item: ParkingLot,
): boolean {
  return (
    Math.abs(existing.lat - item.lat) > REALTIME_COORD_EPSILON ||
    Math.abs(existing.lng - item.lng) > REALTIME_COORD_EPSILON
  );
}

function realtimeHeartbeatDue(lastSeenAt: string, syncedAt: string): boolean {
  const last = Date.parse(lastSeenAt);
  const now = Date.parse(syncedAt);
  if (!Number.isFinite(last) || !Number.isFinite(now)) return true;
  return now - last >= REALTIME_HEARTBEAT_INTERVAL_MS;
}

async function fetchExistingRealtimeRows(
  db: D1Database,
  items: ParkingLot[],
): Promise<Map<string, ExistingRealtimeRow>> {
  const existingById = new Map<string, ExistingRealtimeRow>();
  if (items.length === 0) return existingById;
  const ids = items.map((item) => item.id);
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT ${EXISTING_REALTIME_COLUMNS} FROM realtime_parking_status WHERE id IN (${placeholders})`,
    )
    .bind(...ids)
    .all<ExistingRealtimeRow>();
  for (const row of rows.results ?? []) existingById.set(row.id, row);
  return existingById;
}

async function upsertRealtimeParkingItems(
  db: D1Database,
  items: ParkingLot[],
  syncedAt: string,
): Promise<RealtimeUpsertCounts> {
  const counts: RealtimeUpsertCounts = {
    inserted: 0,
    changed: 0,
    coordinate: 0,
    heartbeat: 0,
    unchangedSkipped: 0,
    writes: 0,
  };
  for (
    let start = 0;
    start < items.length;
    start += REALTIME_PARKING_UPSERT_BATCH_SIZE
  ) {
    const slice = items.slice(
      start,
      start + REALTIME_PARKING_UPSERT_BATCH_SIZE,
    );
    const existingById = await fetchExistingRealtimeRows(db, slice);
    const statements: D1PreparedStatement[] = [];
    for (const item of slice) {
      const existing = existingById.get(item.id);
      if (!existing) {
        counts.inserted += 1;
        statements.push(prepareRealtimeParkingUpsert(db, item, syncedAt));
        continue;
      }
      const coordinateChanged = realtimeCoordinateChanged(existing, item);
      if (coordinateChanged) {
        counts.coordinate += 1;
        statements.push(
          db
            .prepare(REALTIME_COORDINATE_SQL)
            .bind(item.lat, item.lng, item.id),
        );
      }
      if (realtimeMaterialChanged(existing, item)) {
        counts.changed += 1;
        statements.push(prepareRealtimeParkingUpsert(db, item, syncedAt));
      } else if (
        coordinateChanged ||
        realtimeHeartbeatDue(existing.last_seen_at, syncedAt)
      ) {
        // 좌표만 고친 회차에도 last_seen_at을 같이 밀어 준다. 좌표 UPDATE는
        // last_seen_at을 건드리지 않으므로 이게 없으면 prune 시계가 멈춘다.
        counts.heartbeat += 1;
        statements.push(
          db
            .prepare(REALTIME_HEARTBEAT_SQL)
            .bind(
              syncedAt,
              item.freshnessTimestamp ?? syncedAt,
              item.freshnessTimestamp ?? syncedAt,
              item.id,
            ),
        );
      } else {
        counts.unchangedSkipped += 1;
      }
    }
    if (statements.length > 0) await db.batch(statements);
    counts.writes += statements.length;
  }
  return counts;
}

export async function queryRealtimeParkingCache(
  db: D1Database,
  lat: number,
  lng: number,
  options: ParkingSearchOptions,
): Promise<ParkingLot[]> {
  return queryRealtimeParkingCacheItems(
    db,
    lat,
    lng,
    options,
    REALTIME_CACHE_RESULT_LIMIT,
  );
}

async function queryRealtimeParkingCacheItems(
  db: D1Database,
  lat: number,
  lng: number,
  options: ParkingSearchOptions,
  limit: number,
): Promise<ParkingLot[]> {
  const radiusMeters = options.radiusMeters;
  const latDelta = radiusMeters / 111320;
  const lngDelta =
    radiusMeters / Math.max(40000, 111320 * Math.cos((lat * Math.PI) / 180));
  const minSeenAt = new Date(
    Date.now() - REALTIME_CACHE_MAX_AGE_SECONDS * 1000,
  ).toISOString();
  const rows = await db
    .prepare(
      `SELECT *
       FROM realtime_parking_status
       WHERE lat BETWEEN ? AND ?
         AND lng BETWEEN ? AND ?
         AND last_seen_at >= ?
       LIMIT ?`,
    )
    .bind(
      lat - latDelta,
      lat + latDelta,
      lng - lngDelta,
      lng + lngDelta,
      minSeenAt,
      Math.max(limit + 500, limit),
    )
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
  clusterMeters: number,
): Promise<RealtimeParkingCluster[]> {
  const items = await queryRealtimeParkingCacheItems(
    db,
    lat,
    lng,
    options,
    REALTIME_CLUSTER_RESULT_LIMIT,
  );
  const latStep = clusterMeters / 111320;
  const lngStep =
    clusterMeters / Math.max(40000, 111320 * Math.cos((lat * Math.PI) / 180));
  const clusters = new Map<string, ParkingLot[]>();

  for (const item of items) {
    const key = `${Math.round(item.lat / latStep)}:${Math.round(item.lng / lngStep)}`;
    clusters.set(key, [...(clusters.get(key) ?? []), item]);
  }

  return [...clusters.entries()].map(([id, clusterItems]) =>
    summarizeCluster(id, clusterItems),
  );
}

// D1 쓰기 예산: 이 upsert는 하루 11만 건 넘게 돌아 쓰기 1위다. `ON CONFLICT DO UPDATE`는
// SET에 등장하는 컬럼의 인덱스만 다시 쓰므로, `lat`/`lng`를 SET에서 빼면 (lat, lng) 인덱스
// 갱신이 통째로 사라진다(행당 3행 → 2행, `0028`이 (last_seen_at) 인덱스를 지워 최종 1행).
// 대가: 원본이 좌표를 고쳐도 기존 행에는 반영되지 않는다. 피드에서 한 번 빠진 주차장은
// pruneUnseenRealtimeParking이 지우고 다음 회차에 새 좌표로 다시 INSERT된다.
const REALTIME_PARKING_UPSERT_SQL = `INSERT INTO realtime_parking_status (
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
        updated_at = excluded.updated_at`;

function prepareRealtimeParkingUpsert(
  db: D1Database,
  item: ParkingLot,
  now: string,
): D1PreparedStatement {
  return db
    .prepare(REALTIME_PARKING_UPSERT_SQL)
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
      item.freshnessTimestamp ?? now,
    );
}

/// 예전에는 "이번 회차에 안 보인 행"을 즉시 지웠다. 조건부 쓰기 이후로는
/// 값이 안 바뀐 행이 매 회차 last_seen_at을 쓰지 않으므로 그 기준을 그대로
/// 두면 살아 있는 주차장을 지운다. 그래서 보존 기간(90분) 기준으로 바꿨다.
/// heartbeat 30분 + 회차 간격이 90분을 넘지 않으므로 계속 공급되는 행은
/// 절대 걸리지 않고, 피드에서 사라진 행은 45분 뒤 조회에서 빠진 다음
/// 90분 뒤 실제로 지워진다.
async function pruneUnseenRealtimeParking(
  db: D1Database,
  syncedAt: string,
): Promise<number> {
  const cutoff = new Date(
    Date.parse(syncedAt) - REALTIME_PRUNE_RETENTION_MS,
  ).toISOString();
  const result = await db
    .prepare(
      `DELETE FROM realtime_parking_status
       WHERE source IN ('seoul-realtime', 'seoul-seongdong-iot', 'seoul-hangang-parking', 'daejeon-realtime', 'suseong-realtime', 'kac-airport-realtime', 'incheon-airport-realtime')
         AND last_seen_at < ?`,
    )
    .bind(cutoff)
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

function mapRealtimeStatusRow(
  row: RealtimeParkingStatusRow,
  lat: number,
  lng: number,
): ParkingLot {
  const stale = isStale(row.last_seen_at, REALTIME_CACHE_MAX_AGE_SECONDS);
  const realtimeAvailable = Boolean(row.realtime_available) && !stale;
  const totalCapacity = row.total_capacity ?? null;
  const availableSpaces = row.available_spaces ?? null;
  const occupancyRate =
    totalCapacity !== null && totalCapacity > 0 && availableSpaces !== null
      ? Math.max(0, Math.min(1, 1 - availableSpaces / totalCapacity))
      : (row.occupancy_rate ?? null);
  const congestionStatus =
    row.congestion_status ?? inferCongestion(availableSpaces, occupancyRate);
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
    displayStatus: displayStatus({
      realtimeAvailable,
      stale,
      availableSpaces,
      congestionStatus,
    }),
    score: 0,
    provenance: [
      {
        source: row.source,
        sourceParkingId: row.source_parking_id,
        freshnessTimestamp: row.freshness_timestamp ?? row.last_seen_at,
      },
    ],
    rawSourcePayload: undefined,
  };
}

function summarizeCluster(
  id: string,
  items: ParkingLot[],
): RealtimeParkingCluster {
  const totalAvailable = sumNullable(items.map((item) => item.availableSpaces));
  const totalCapacity = sumNullable(items.map((item) => item.totalCapacity));
  return {
    id,
    lat: average(items.map((item) => item.lat)),
    lng: average(items.map((item) => item.lng)),
    count: items.length,
    availableSpaces: totalAvailable,
    totalCapacity,
    congestionStatus: inferCongestion(
      totalAvailable,
      clusterOccupancy(totalAvailable, totalCapacity),
    ),
  };
}

function sumNullable(values: Array<number | null>): number | null {
  const numeric = values.filter((value): value is number => value !== null);
  if (numeric.length === 0) return null;
  return numeric.reduce((sum, value) => sum + value, 0);
}

function average(values: number[]): number {
  return (
    values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
  );
}

function clusterOccupancy(
  availableSpaces: number | null,
  totalCapacity: number | null,
): number | null {
  if (availableSpaces === null || totalCapacity === null || totalCapacity <= 0)
    return null;
  return Math.max(0, Math.min(1, 1 - availableSpaces / totalCapacity));
}

function isStale(
  timestamp: string | null | undefined,
  thresholdSeconds: number,
): boolean {
  if (!timestamp) return true;
  const time = new Date(timestamp).getTime();
  return Number.isNaN(time) || Date.now() - time > thresholdSeconds * 1000;
}

function inferCongestion(
  availableSpaces: number | null,
  occupancyRate: number | null,
): ParkingLot["congestionStatus"] {
  if (occupancyRate !== null) {
    if (occupancyRate >= 0.98) return "full";
    if (occupancyRate >= 0.85) return "busy";
    if (occupancyRate >= 0.6) return "moderate";
    return "available";
  }
  if (availableSpaces !== null)
    return availableSpaces <= 2 ? "busy" : "available";
  return "unknown";
}

function displayStatus(input: {
  realtimeAvailable: boolean;
  stale: boolean;
  availableSpaces: number | null;
  congestionStatus: ParkingLot["congestionStatus"];
}): string {
  if (input.stale) return "업데이트 지연 가능";
  if (input.realtimeAvailable && input.availableSpaces !== null)
    return `실시간 ${input.availableSpaces}면`;
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
