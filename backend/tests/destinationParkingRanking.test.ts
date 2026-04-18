import { describe, expect, it } from "vitest";
import type { ParkingLot } from "@parking/shared-types";
import { rankParkingLots } from "../src/ranking/rankParking.js";

describe("destination parking ranking", () => {
  it("puts parking at the destination before higher scoring nearby alternatives", () => {
    const destinationParking: ParkingLot = {
      id: "destination",
      source: "kakao-local",
      sourceParkingId: "destination",
      name: "Destination Parking",
      address: "Busan",
      lat: 0,
      lng: 0,
      distanceFromDestinationMeters: 30,
      totalCapacity: null,
      availableSpaces: null,
      occupancyRate: null,
      congestionStatus: "unknown",
      realtimeAvailable: false,
      freshnessTimestamp: null,
      operatingHours: null,
      feeSummary: null,
      supportsEv: false,
      supportsAccessible: false,
      isPublic: false,
      isPrivate: true,
      stale: false,
      displayStatus: "정보 없음",
      score: 0,
      provenance: []
    };
    const strongerNearby: ParkingLot = {
      ...destinationParking,
      id: "stronger",
      sourceParkingId: "stronger",
      distanceFromDestinationMeters: 250,
      totalCapacity: 100,
      availableSpaces: 40,
      congestionStatus: "available",
      realtimeAvailable: true,
      freshnessTimestamp: new Date().toISOString(),
      feeSummary: "무료",
      supportsEv: true,
      supportsAccessible: true,
      isPublic: true,
      isPrivate: false
    };

    const ranked = rankParkingLots([strongerNearby, destinationParking], { radiusMeters: 1000, preferPublic: true });

    expect(ranked[0].id).toBe("destination");
    expect(ranked[1].score).toBeGreaterThan(ranked[0].score);
  });
});
