import { describe, expect, it, vi } from "vitest";
import type { ParkingLot } from "@parking/shared-types";
import type { CompositeParkingProvider } from "../../backend/src/providers/CompositeParkingProvider.js";
import { publishRealtimeShard, realtimeItemsInRegion, type RealtimeShard } from "../src/realtimeSnapshot.js";
import { syncRealtimeParkingCache } from "../src/realtimeParkingCache.js";
import { FakeD1, REALTIME_COLUMNS } from "./fakeD1.js";
function lot(overrides: Partial<ParkingLot> = {}): ParkingLot {
  return {
    id: "daejeon-realtime:1",
    source: "daejeon-realtime",
    sourceParkingId: "1",
    name: "시청 주차장",
    address: "대전 서구",
    lat: 36.35,
    lng: 127.38,
    distanceFromDestinationMeters: 0,
    totalCapacity: 100,
    availableSpaces: 20,
    occupancyRate: 0.8,
    congestionStatus: "moderate",
    realtimeAvailable: true,
    // 대전 피드는 원본에 시각이 없어 provider가 매 회차 now를 채운다.
    freshnessTimestamp: new Date().toISOString(),
    operatingHours: null,
    feeSummary: null,
    supportsEv: false,
    supportsAccessible: false,
    isPublic: true,
    isPrivate: false,
    stale: false,
    displayStatus: "여유",
    score: 0,
    provenance: [],
    ...overrides,
  };
}


describe("shared realtime snapshot", () => {
  it("keeps more than the old 1000-pin cap and filters only the requested area", () => {
    const items = Array.from({ length: 1500 }, (_, i) => lot({ id: String(i) }));
    items.push(lot({ id: "far", lat: 33.4, lng: 126.5 }));
    const shard: RealtimeShard = { schemaVersion: 1, generatedAt: new Date().toISOString(), items };
    expect(realtimeItemsInRegion([shard], 36.35, 127.38, 20_000)).toHaveLength(1500);
  });
  it("retains old pins but clears misleading availability during provider outage", () => {
    const shard: RealtimeShard = { schemaVersion: 1, generatedAt: "2020-01-01", items: [lot({ freshnessTimestamp: "2020-01-01" })] };
    expect(realtimeItemsInRegion([shard], 36.35, 127.38, 1000)[0])
      .toMatchObject({ id: "daejeon-realtime:1", stale: true, availableSpaces: null, realtimeAvailable: false });
  });
  it("exports only public fields and prevents delayed publishers rolling back a shard", async () => {
    let saved: string | undefined;
    const put = vi.fn(async (_key: string, value: string) => { saved = value; return {}; });
    const bucket = { get: async () => saved ? { etag: "x", json: async () => JSON.parse(saved!) } : null, put } as unknown as R2Bucket;
    await publishRealtimeShard(bucket, 1, [lot({ rawSourcePayload: { apiKey: "secret" } })], "2026-09-13T01:00:00Z");
    expect(saved).not.toContain("secret"); expect(saved).not.toContain("rawSourcePayload");
    await publishRealtimeShard(bucket, 1, [], "2026-09-13T00:00:00Z");
    expect(put).toHaveBeenCalledTimes(1);
  });
  it("does not publish when a provider swallows a failed fetch or returns empty", async () => {
    const publish = vi.fn();
    const fake = new FakeD1(REALTIME_COLUMNS);
    const provider = { nearby: async () => [lot()], health: () => [{ status: "down", stale: true, lastSuccessAt: null }] } as unknown as CompositeParkingProvider;
    await syncRealtimeParkingCache(fake.asD1(), provider, { publish, prune: false });
    expect(publish).not.toHaveBeenCalled();
    provider.health = () => [{ name: "test", status: "up", stale: false, lastError: null, qualityScore: 1, lastSuccessAt: new Date().toISOString() }];
    await syncRealtimeParkingCache(fake.asD1(), provider, { publish, prune: false });
    expect(publish).toHaveBeenCalledTimes(1);
    provider.nearby = async () => [];
    await syncRealtimeParkingCache(fake.asD1(), provider, { publish, prune: false });
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
