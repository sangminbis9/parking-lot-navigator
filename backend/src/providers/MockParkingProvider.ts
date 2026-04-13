import type { ParkingSearchOptions } from "@parking/shared-types";
import type { ParkingProvider, RawParkingRecord } from "../types/provider.js";
import { BaseProviderHealth } from "./BaseProviderHealth.js";

export class MockParkingProvider extends BaseProviderHealth implements ParkingProvider {
  readonly name = "mock";

  constructor() {
    super("mock");
  }

  async fetchNearby(lat: number, lng: number, _options: ParkingSearchOptions): Promise<RawParkingRecord[]> {
    this.markSuccess(0.95);
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    return [
      {
        source: "mock",
        sourceParkingId: "seoul-station-public-1",
        name: "서울역 서부 공영주차장",
        address: "서울 용산구 청파로 378",
        lat: lat + 0.0012,
        lng: lng - 0.0011,
        totalCapacity: 120,
        availableSpaces: 18,
        realtimeAvailable: true,
        freshnessTimestamp: now,
        operatingHours: "24시간",
        feeSummary: "10분 500원",
        supportsEv: true,
        supportsAccessible: true,
        isPublic: true,
        isPrivate: false
      },
      {
        source: "mock",
        sourceParkingId: "nearby-private-1",
        name: "목적지 민영주차장",
        address: "서울 중구 통일로 1",
        lat: lat - 0.0008,
        lng: lng + 0.0009,
        totalCapacity: 60,
        availableSpaces: null,
        congestionStatus: "moderate",
        realtimeAvailable: true,
        freshnessTimestamp: now,
        operatingHours: "07:00-23:00",
        feeSummary: "30분 2,000원",
        supportsEv: false,
        supportsAccessible: false,
        isPublic: false,
        isPrivate: true
      },
      {
        source: "mock",
        sourceParkingId: "stale-public-1",
        name: "오래된 정보 공영주차장",
        address: "서울 중구 세종대로 110",
        lat: lat + 0.002,
        lng: lng + 0.0016,
        totalCapacity: 80,
        availableSpaces: 7,
        realtimeAvailable: true,
        freshnessTimestamp: old,
        operatingHours: "09:00-22:00",
        feeSummary: "1시간 3,000원",
        supportsEv: false,
        supportsAccessible: true,
        isPublic: true,
        isPrivate: false
      },
      {
        source: "mock",
        sourceParkingId: "unknown-1",
        name: "정보 제한 주차장",
        address: "서울 중구 남대문로 5",
        lat: lat - 0.0018,
        lng: lng - 0.0015,
        totalCapacity: 40,
        availableSpaces: null,
        congestionStatus: "unknown",
        realtimeAvailable: false,
        freshnessTimestamp: null,
        operatingHours: null,
        feeSummary: null,
        supportsEv: false,
        supportsAccessible: false,
        isPublic: false,
        isPrivate: true
      }
    ];
  }
}
