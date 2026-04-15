import { describe, expect, it } from "vitest";
import type { ParkingSearchOptions, ProviderHealth } from "@parking/shared-types";
import { CompositeParkingProvider } from "../src/providers/CompositeParkingProvider.js";
import type { ParkingProvider, RawParkingRecord } from "../src/types/provider.js";

describe("CompositeParkingProvider", () => {
  it("uses mock records only as fallback when real provider data exists", async () => {
    const now = new Date().toISOString();
    const provider = new CompositeParkingProvider([
      new StaticProvider("mock", [
        record("mock", "mock-1", "Mock Parking", 37.567, 126.979, now)
      ]),
      new StaticProvider("seoul-metadata", [
        record("seoul-metadata", "real-1", "Real Parking", 37.5667, 126.9785, now)
      ])
    ]);

    const items = await provider.nearby(37.5665, 126.9780, { radiusMeters: 800 });

    expect(items.map((item) => item.source)).toEqual(["seoul-metadata"]);
    expect(items[0].name).toBe("Real Parking");
  });

  it("keeps mock records when every real provider is empty", async () => {
    const now = new Date().toISOString();
    const provider = new CompositeParkingProvider([
      new StaticProvider("mock", [
        record("mock", "mock-1", "Mock Parking", 37.567, 126.979, now)
      ]),
      new StaticProvider("seoul-metadata", [])
    ]);

    const items = await provider.nearby(37.5665, 126.9780, { radiusMeters: 800 });

    expect(items.map((item) => item.source)).toEqual(["mock"]);
  });

  it("keeps mock fallback when real provider records are outside the requested radius", async () => {
    const now = new Date().toISOString();
    const provider = new CompositeParkingProvider([
      new StaticProvider("mock", [
        record("mock", "mock-1", "Mock Parking", 37.567, 126.979, now)
      ]),
      new StaticProvider("seoul-metadata", [
        record("seoul-metadata", "real-far", "Far Real Parking", 37.7, 127.1, now)
      ])
    ]);

    const items = await provider.nearby(37.5665, 126.9780, { radiusMeters: 800 });

    expect(items.map((item) => item.source)).toEqual(["mock"]);
  });
});

class StaticProvider implements ParkingProvider {
  constructor(
    readonly name: ParkingProvider["name"],
    private readonly records: RawParkingRecord[]
  ) {}

  async fetchNearby(_lat: number, _lng: number, _options: ParkingSearchOptions): Promise<RawParkingRecord[]> {
    return this.records;
  }

  health(): ProviderHealth {
    return {
      name: this.name,
      status: "up",
      lastSuccessAt: null,
      lastError: null,
      qualityScore: 1,
      stale: false
    };
  }
}

function record(
  source: RawParkingRecord["source"],
  sourceParkingId: string,
  name: string,
  lat: number,
  lng: number,
  freshnessTimestamp: string
): RawParkingRecord {
  return {
    source,
    sourceParkingId,
    name,
    lat,
    lng,
    totalCapacity: 100,
    availableSpaces: 20,
    realtimeAvailable: true,
    freshnessTimestamp,
    isPublic: true,
    isPrivate: false
  };
}
