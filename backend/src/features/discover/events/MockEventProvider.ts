import type { FreeEvent, ProviderHealth } from "@parking/shared-types";
import { distanceMeters } from "../../../services/geo.js";
import type { DiscoverQuery, EventProvider } from "../common/discoverProvider.js";
import { sortByStatusThenDistance } from "../common/sortDiscover.js";

export class MockEventProvider implements EventProvider {
  async events(query: DiscoverQuery): Promise<FreeEvent[]> {
    const items: FreeEvent[] = [
      {
        id: "mock-event-gallery",
        title: "무료 시민 전시",
        eventType: "exhibition",
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        status: "ongoing",
        isFree: true,
        venueName: "시민청",
        address: "서울 중구 세종대로 110",
        lat: query.lat + 0.0015,
        lng: query.lng - 0.001,
        distanceMeters: distanceMeters(query.lat, query.lng, query.lat + 0.0015, query.lng - 0.001),
        source: "mock",
        sourceUrl: null,
        imageUrl: null,
        shortDescription: "누구나 관람할 수 있는 무료 공공 전시"
      }
    ];
    return sortByStatusThenDistance(items).filter((item) => item.distanceMeters <= query.radiusMeters);
  }

  health(): ProviderHealth {
    return {
      name: "mock-event",
      status: "up",
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      qualityScore: 1,
      stale: false
    };
  }
}
