import { describe, expect, it } from "vitest";
import { D1ParkingProvider, type D1DatabaseLike } from "../src/providers/D1ParkingProvider.js";

describe("D1ParkingProvider", () => {
  it("queries a bounding box and returns national static records within the requested radius", async () => {
    const db = new MockD1Database([
      {
        id: "national:near",
        source: "public-data",
        source_parking_id: "near",
        name: "Busan Station Parking",
        address: "Busan",
        road_address: "Busan road",
        lat: 35.115,
        lng: 129.041,
        total_capacity: 120,
        fee_summary: "paid",
        operating_hours: "00:00-24:00",
        supports_ev: 1,
        supports_accessible: 0,
        is_public: 1,
        is_private: 0,
        region1: "Busan",
        region2: "Dong-gu",
        raw_payload: "{\"source\":\"fixture\"}",
        data_updated_at: "2026-04-17T00:00:00.000Z",
        synced_at: "2026-04-17T00:00:00.000Z"
      },
      {
        id: "national:far",
        source: "public-data",
        source_parking_id: "far",
        name: "Far Parking",
        address: "Far",
        road_address: null,
        lat: 35.2,
        lng: 129.2,
        total_capacity: null,
        fee_summary: null,
        operating_hours: null,
        supports_ev: 0,
        supports_accessible: 0,
        is_public: 0,
        is_private: 1,
        region1: "Busan",
        region2: null,
        raw_payload: null,
        data_updated_at: null,
        synced_at: "2026-04-17T00:00:00.000Z"
      }
    ]);

    const provider = new D1ParkingProvider(db);
    const records = await provider.fetchNearby(35.115, 129.041, { radiusMeters: 800 });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      source: "national-static",
      sourceParkingId: "national:near",
      name: "Busan Station Parking",
      address: "Busan road",
      totalCapacity: 120,
      realtimeAvailable: false,
      supportsEv: true,
      isPublic: true
    });
    expect(db.lastSql).toContain("FROM parking_lots");
    expect(db.lastBindings).toHaveLength(5);
  });
});

class MockD1Database implements D1DatabaseLike {
  lastSql = "";
  lastBindings: unknown[] = [];

  constructor(private readonly rows: unknown[]) {}

  prepare(query: string) {
    this.lastSql = query;
    return new MockD1Statement(this.rows, (values) => {
      this.lastBindings = values;
    });
  }
}

class MockD1Statement {
  constructor(
    private readonly rows: unknown[],
    private readonly captureBindings: (values: unknown[]) => void
  ) {}

  bind(...values: unknown[]) {
    this.captureBindings(values);
    return this;
  }

  async all<T>() {
    return { results: this.rows as T[] };
  }
}
