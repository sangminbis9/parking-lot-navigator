import type { ParkingLot, ParkingSearchOptions } from "@parking/shared-types";
import { normalizeFeeSummaryText, normalizeOperatingHoursText } from "../../backend/src/formatting/parkingDisplayText.js";
import { rankParkingLots } from "../../backend/src/ranking/rankParking.js";
import { distanceMeters } from "../../backend/src/services/geo.js";

const STATIC_PARKING_RESULT_LIMIT = 1000;

interface StaticParkingRow {
  id: string;
  source: string;
  source_parking_id: string;
  name: string;
  address: string | null;
  road_address: string | null;
  lat: number;
  lng: number;
  total_capacity: number | null;
  fee_summary: string | null;
  operating_hours: string | null;
  supports_ev: number | null;
  supports_accessible: number | null;
  is_public: number | null;
  is_private: number | null;
  data_updated_at: string | null;
  synced_at: string;
}

export async function queryStaticParkingCache(
  db: D1Database,
  lat: number,
  lng: number,
  options: ParkingSearchOptions
): Promise<ParkingLot[]> {
  const radiusMeters = options.radiusMeters;
  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / Math.max(40000, 111320 * Math.cos((lat * Math.PI) / 180));
  const rows = await db
    .prepare(
      `SELECT
        id, source, source_parking_id, name, address, road_address, lat, lng,
        total_capacity, fee_summary, operating_hours, supports_ev, supports_accessible,
        is_public, is_private, data_updated_at, synced_at
       FROM parking_lots
       WHERE lat BETWEEN ? AND ?
         AND lng BETWEEN ? AND ?
       LIMIT ?`
    )
    .bind(lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta, STATIC_PARKING_RESULT_LIMIT + 500)
    .all<StaticParkingRow>();

  const items = (rows.results ?? [])
    .map((row) => mapStaticParkingRow(row, lat, lng))
    .filter((item): item is ParkingLot => item !== null)
    .filter((item) => item.distanceFromDestinationMeters <= radiusMeters)
    .filter((item) => !options.evOnly || item.supportsEv)
    .filter((item) => !options.accessibleOnly || item.supportsAccessible)
    .filter((item) => !options.preferPublic || item.isPublic);

  return rankParkingLots(items, options).slice(0, STATIC_PARKING_RESULT_LIMIT);
}

function mapStaticParkingRow(row: StaticParkingRow, lat: number, lng: number): ParkingLot | null {
  if (!row.id || !row.name || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return null;
  const totalCapacity = toNumber(row.total_capacity);
  return {
    id: row.id,
    source: "national-static",
    sourceParkingId: row.source_parking_id || row.id,
    name: row.name,
    address: row.road_address || row.address || "",
    lat: row.lat,
    lng: row.lng,
    distanceFromDestinationMeters: distanceMeters(lat, lng, row.lat, row.lng),
    totalCapacity,
    availableSpaces: null,
    occupancyRate: null,
    congestionStatus: "unknown",
    realtimeAvailable: false,
    freshnessTimestamp: row.data_updated_at ?? row.synced_at,
    operatingHours: normalizeOperatingHoursText(row.operating_hours),
    feeSummary: normalizeFeeSummaryText(row.fee_summary),
    supportsEv: toBoolean(row.supports_ev),
    supportsAccessible: toBoolean(row.supports_accessible),
    isPublic: toBoolean(row.is_public),
    isPrivate: toBoolean(row.is_private),
    stale: false,
    displayStatus: totalCapacity ? `${totalCapacity} spaces` : "Static info",
    score: 0,
    provenance: [
      {
        source: "national-static",
        sourceParkingId: row.source_parking_id || row.id,
        freshnessTimestamp: row.data_updated_at ?? row.synced_at
      }
    ],
    rawSourcePayload: undefined
  };
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}
