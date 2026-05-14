import { describe, expect, it } from "vitest";
import { normalizeParkingRecord, isStale } from "../src/normalization/normalizeParking.js";

describe("parking normalization", () => {
  it("calculates occupancy when available spaces and capacity are present", () => {
    const item = normalizeParkingRecord(
      {
        source: "mock",
        sourceParkingId: "a",
        name: "Test parking",
        lat: 37.55,
        lng: 126.97,
        totalCapacity: 100,
        availableSpaces: 25,
        realtimeAvailable: true,
        freshnessTimestamp: new Date().toISOString()
      },
      37.55,
      126.97,
      600
    );

    expect(item.occupancyRate).toBe(0.75);
    expect(item.realtimeAvailable).toBe(true);
  });

  it("treats old freshness as stale", () => {
    const old = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    expect(isStale(old, 600)).toBe(true);
  });

  it("treats missing freshness as stale and disables realtime availability", () => {
    const item = normalizeParkingRecord(
      {
        source: "mock",
        sourceParkingId: "missing-freshness",
        name: "Missing freshness parking",
        lat: 37.55,
        lng: 126.97,
        availableSpaces: 12,
        realtimeAvailable: true,
        freshnessTimestamp: null
      },
      37.55,
      126.97,
      600
    );

    expect(isStale(null, 600)).toBe(true);
    expect(item.stale).toBe(true);
    expect(item.realtimeAvailable).toBe(false);
  });
});
