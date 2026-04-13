import { describe, expect, it } from "vitest";
import type { ParkingLot } from "@parking/shared-types";
import { deduplicateParkingLots } from "../src/deduplication/deduplicateParking.js";

describe("주차장 중복 제거", () => {
  it("가깝고 이름이 유사한 주차장을 병합하고 provenance를 보존한다", () => {
    const a = lot("mock:a", "서울역 공영주차장", 37.55, 126.97, true);
    const b = lot("seoul-realtime:b", "서울역 주차장", 37.5501, 126.9701, false);
    const result = deduplicateParkingLots([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].provenance).toHaveLength(2);
  });
});

function lot(id: string, name: string, lat: number, lng: number, realtime: boolean): ParkingLot {
  return {
    id,
    source: id.startsWith("mock") ? "mock" : "seoul-realtime",
    sourceParkingId: id,
    name,
    address: "서울",
    lat,
    lng,
    distanceFromDestinationMeters: 100,
    totalCapacity: 100,
    availableSpaces: realtime ? 10 : null,
    occupancyRate: realtime ? 0.9 : null,
    congestionStatus: "available",
    realtimeAvailable: realtime,
    freshnessTimestamp: realtime ? new Date().toISOString() : null,
    operatingHours: null,
    feeSummary: null,
    supportsEv: false,
    supportsAccessible: false,
    isPublic: true,
    isPrivate: false,
    stale: false,
    displayStatus: "테스트",
    score: 0,
    provenance: [{ source: id.startsWith("mock") ? "mock" : "seoul-realtime", sourceParkingId: id }]
  };
}
