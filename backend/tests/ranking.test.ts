import { describe, expect, it } from "vitest";
import type { ParkingLot } from "@parking/shared-types";
import { rankParkingLots } from "../src/ranking/rankParking.js";

describe("주차장 랭킹", () => {
  it("가깝고 실시간 가능 대수가 있는 주차장을 우선한다", () => {
    const base: ParkingLot = {
      id: "a",
      source: "mock",
      sourceParkingId: "a",
      name: "A",
      address: "서울",
      lat: 0,
      lng: 0,
      distanceFromDestinationMeters: 100,
      totalCapacity: 100,
      availableSpaces: 20,
      occupancyRate: 0.8,
      congestionStatus: "available",
      realtimeAvailable: true,
      freshnessTimestamp: new Date().toISOString(),
      operatingHours: null,
      feeSummary: "무료",
      supportsEv: true,
      supportsAccessible: true,
      isPublic: true,
      isPrivate: false,
      stale: false,
      displayStatus: "실시간 20면",
      score: 0,
      provenance: []
    };
    const far = { ...base, id: "b", distanceFromDestinationMeters: 780, availableSpaces: 2, feeSummary: null };
    const ranked = rankParkingLots([far, base], { radiusMeters: 800, preferPublic: true });
    expect(ranked[0].id).toBe("a");
  });
});
