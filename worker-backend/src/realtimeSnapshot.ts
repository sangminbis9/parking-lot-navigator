import type { ParkingLot } from "@parking/shared-types";
import { distanceMeters } from "../../backend/src/services/geo.js";

export const realtimeShardKey = (shard: number) => `parking/v1/shard-${shard}.json`;
export interface RealtimeShard { schemaVersion: 1; generatedAt: string; items: ParkingLot[] }

/** Existing provider output, never another D1 export. Publish only a healthy shard. */
export async function publishRealtimeShard(bucket: R2Bucket, shard: number, items: ParkingLot[], generatedAt: string, retainSources: string[] = []) {
  const previousObject = await bucket.get(realtimeShardKey(shard));
  const previous = previousObject ? await previousObject.json<RealtimeShard>() : null;
  if (previous && Date.parse(previous.generatedAt) >= Date.parse(generatedAt)) return;
  const old = new Map(previous?.items.map(item => [item.id, item]) ?? []);
  const merged = [...items, ...(previous?.items.filter(item => retainSources.includes(item.source)
    && !items.some(next => next.id === item.id)) ?? [])];
  const publicItems: ParkingLot[] = merged.map(item => {
    const saved = old.get(item.id);
    const position = item.coordinateIsApproximate && saved && !saved.coordinateIsApproximate ? saved : item;
    // Explicit public allowlist: provider raw payloads may contain internal URLs/keys.
    return { id: item.id, source: item.source, sourceParkingId: item.sourceParkingId,
      name: item.name, address: item.address, lat: position.lat, lng: position.lng,
      coordinateIsApproximate: position.coordinateIsApproximate, distanceFromDestinationMeters: 0,
      totalCapacity: item.totalCapacity, availableSpaces: item.availableSpaces,
      occupancyRate: item.occupancyRate, congestionStatus: item.congestionStatus,
      realtimeAvailable: item.realtimeAvailable, freshnessTimestamp: item.freshnessTimestamp,
      operatingHours: item.operatingHours, feeSummary: item.feeSummary, supportsEv: item.supportsEv,
      supportsAccessible: item.supportsAccessible, isPublic: item.isPublic, isPrivate: item.isPrivate,
      stale: item.stale, displayStatus: item.displayStatus, score: 0,
      provenance: item.provenance.map(p => ({ source: p.source, sourceParkingId: p.sourceParkingId, freshnessTimestamp: p.freshnessTimestamp })) };
  });
  const body = JSON.stringify({ schemaVersion: 1, generatedAt, items: publicItems } satisfies RealtimeShard);
  if (new TextEncoder().encode(body).length > 8 * 1024 * 1024) throw new Error("realtime_shard_size_budget");
  const saved = await bucket.put(realtimeShardKey(shard), body, {
    onlyIf: previousObject ? { etagMatches: previousObject.etag } : { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=30" },
  });
  if (!saved) throw new Error("realtime_shard_conflict");
}

/** No SQL or pin-count limit. Old positions survive an outage; availability becomes unknown. */
export function realtimeItemsInRegion(shards: RealtimeShard[], lat: number, lng: number, radius: number, now = Date.now()): ParkingLot[] {
  const unique = new Map<string, ParkingLot>();
  for (const shard of shards) for (const item of shard.items) {
    const distance = distanceMeters(lat, lng, item.lat, item.lng);
    if (!Number.isFinite(distance) || distance > radius) continue;
    const timestamp = Date.parse(item.freshnessTimestamp ?? shard.generatedAt);
    const stale = item.stale || !Number.isFinite(timestamp) || now - timestamp > 10 * 60_000;
    unique.set(item.id, { ...item, distanceFromDestinationMeters: distance,
      ...(stale ? { stale: true, realtimeAvailable: false, availableSpaces: null,
        occupancyRate: null, congestionStatus: "unknown" as const, displayStatus: "업데이트 지연 가능" } : {}) });
  }
  return [...unique.values()].sort((a, b) => a.distanceFromDestinationMeters - b.distanceFromDestinationMeters);
}
