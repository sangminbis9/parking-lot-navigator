import { describe, expect, it } from "vitest";
import { normalizeParkingRecord, isStale } from "../src/normalization/normalizeParking.js";

describe("주차장 정규화", () => {
  it("가능 대수와 총면수가 있으면 점유율을 계산한다", () => {
    const item = normalizeParkingRecord(
      {
        source: "mock",
        sourceParkingId: "a",
        name: "테스트 주차장",
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
    expect(item.displayStatus).toBe("실시간 25면");
  });

  it("오래된 freshness를 stale로 판정한다", () => {
    const old = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    expect(isStale(old, 600)).toBe(true);
  });
});
