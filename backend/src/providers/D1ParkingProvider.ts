import type { ParkingSearchOptions } from "@parking/shared-types";
import type { ParkingProvider, RawParkingRecord } from "../types/provider.js";
import { distanceMeters } from "../services/geo.js";
import { BaseProviderHealth } from "./BaseProviderHealth.js";

const MAX_D1_CANDIDATES = 500;
const EARTH_RADIUS_METERS = 6371000;

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T = unknown>(): Promise<{ results?: T[] }>;
}

interface D1ParkingLotRow {
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
  region1: string | null;
  region2: string | null;
  raw_payload: string | null;
  data_updated_at: string | null;
  synced_at: string;
}

export class D1ParkingProvider extends BaseProviderHealth implements ParkingProvider {
  readonly name = "national-static";

  constructor(private readonly db: D1DatabaseLike) {
    super("national-static");
  }

  async fetchNearby(lat: number, lng: number, options: ParkingSearchOptions): Promise<RawParkingRecord[]> {
    try {
      const box = boundingBox(lat, lng, options.radiusMeters);
      const result = await this.db
        .prepare(
          `
          SELECT
            id,
            source,
            source_parking_id,
            name,
            address,
            road_address,
            lat,
            lng,
            total_capacity,
            fee_summary,
            operating_hours,
            supports_ev,
            supports_accessible,
            is_public,
            is_private,
            region1,
            region2,
            raw_payload,
            data_updated_at,
            synced_at
          FROM parking_lots
          WHERE lat BETWEEN ? AND ?
            AND lng BETWEEN ? AND ?
          LIMIT ?
          `
        )
        .bind(box.minLat, box.maxLat, box.minLng, box.maxLng, MAX_D1_CANDIDATES)
        .all<D1ParkingLotRow>();

      const records = (result.results ?? [])
        .map(mapD1Row)
        .filter((record): record is RawParkingRecord & { lat: number; lng: number } => Boolean(record?.lat && record.lng))
        .filter((record) => distanceMeters(lat, lng, record.lat, record.lng) <= options.radiusMeters);

      this.markSuccess(records.length > 0 ? 0.78 : 0.5);
      return records;
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }
}

function mapD1Row(row: D1ParkingLotRow): RawParkingRecord | null {
  const lat = toNumber(row.lat);
  const lng = toNumber(row.lng);
  if (!row.id || !row.source_parking_id || !row.name || lat === null || lng === null) return null;

  return {
    source: "national-static",
    sourceParkingId: row.id,
    name: row.name,
    address: row.road_address || row.address || null,
    lat,
    lng,
    totalCapacity: toNumber(row.total_capacity),
    availableSpaces: null,
    congestionStatus: "unknown",
    realtimeAvailable: false,
    freshnessTimestamp: null,
    operatingHours: row.operating_hours,
    feeSummary: row.fee_summary,
    supportsEv: toBoolean(row.supports_ev),
    supportsAccessible: toBoolean(row.supports_accessible),
    isPublic: toBoolean(row.is_public),
    isPrivate: toBoolean(row.is_private),
    rawSourcePayload: parseRawPayload(row.raw_payload) ?? row
  };
}

function boundingBox(lat: number, lng: number, radiusMeters: number): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  const latDelta = radiansToDegrees(radiusMeters / EARTH_RADIUS_METERS);
  const lngDelta = radiansToDegrees(radiusMeters / (EARTH_RADIUS_METERS * Math.cos(degreesToRadians(lat))));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta
  };
}

function toNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number !== 0 ? number : null;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function parseRawPayload(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}
