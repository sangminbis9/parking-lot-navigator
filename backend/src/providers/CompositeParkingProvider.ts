import type { ParkingLot, ParkingSearchOptions, ProviderHealth } from "@parking/shared-types";
import type { ParkingProvider, RawParkingRecord } from "../types/provider.js";
import { config } from "../config/env.js";
import { normalizeParkingRecord } from "../normalization/normalizeParking.js";
import { deduplicateParkingLots } from "../deduplication/deduplicateParking.js";
import { rankParkingLots } from "../ranking/rankParking.js";

export class CompositeParkingProvider {
  constructor(private readonly providers: ParkingProvider[]) {}

  async nearby(lat: number, lng: number, options: ParkingSearchOptions): Promise<ParkingLot[]> {
    const records = (
      await Promise.all(this.providers.map((provider) => provider.fetchNearby(lat, lng, options)))
    ).flat();
    const normalized = mergeRawRecords(records)
      .filter((record) => hasCoordinates(record))
      .map((record) => normalizeParkingRecord(record, lat, lng, config.STALE_THRESHOLD_SECONDS))
      .filter((item) => item.distanceFromDestinationMeters <= options.radiusMeters);
    const deduped = deduplicateParkingLots(preferRealLots(normalized));
    return rankParkingLots(deduped, options);
  }

  health(): ProviderHealth[] {
    return this.providers.map((provider) => provider.health());
  }
}

function preferRealLots(items: ParkingLot[]): ParkingLot[] {
  const realItems = items.filter((item) => item.source !== "mock");
  return realItems.length > 0 ? realItems : items;
}

function mergeRawRecords(records: RawParkingRecord[]): RawParkingRecord[] {
  const byId = new Map<string, RawParkingRecord>();
  for (const record of records) {
    const key = record.sourceParkingId || `${record.name}:${record.address ?? ""}`;
    const existing = byId.get(key);
    byId.set(key, existing ? mergeRecord(existing, record) : record);
  }
  return [...byId.values()];
}

function mergeRecord(a: RawParkingRecord, b: RawParkingRecord): RawParkingRecord {
  const richerRealtime = b.realtimeAvailable && !a.realtimeAvailable ? b : a;
  return {
    ...a,
    ...b,
    source: richerRealtime.source,
    sourceParkingId: a.sourceParkingId || b.sourceParkingId,
    name: a.name || b.name,
    address: a.address ?? b.address,
    lat: validCoord(a.lat) ? a.lat : b.lat,
    lng: validCoord(a.lng) ? a.lng : b.lng,
    totalCapacity: b.totalCapacity ?? a.totalCapacity,
    availableSpaces: b.availableSpaces ?? a.availableSpaces,
    realtimeAvailable: Boolean(a.realtimeAvailable || b.realtimeAvailable),
    freshnessTimestamp: freshest(a.freshnessTimestamp, b.freshnessTimestamp),
    operatingHours: a.operatingHours ?? b.operatingHours,
    feeSummary: a.feeSummary ?? b.feeSummary,
    rawSourcePayload: { merged: [a.rawSourcePayload ?? a, b.rawSourcePayload ?? b] }
  };
}

function hasCoordinates(record: RawParkingRecord): record is RawParkingRecord & { lat: number; lng: number } {
  return validCoord(record.lat) && validCoord(record.lng);
}

function validCoord(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value !== 0;
}

function freshest(a?: string | null, b?: string | null): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}
