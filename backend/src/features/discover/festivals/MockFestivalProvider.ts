import type { Festival, ProviderHealth } from "@parking/shared-types";
import { distanceMeters } from "../../../services/geo.js";
import type { DiscoverQuery, FestivalProvider } from "../common/discoverProvider.js";
import { sortByStatusThenDistance } from "../common/sortDiscover.js";

export class MockFestivalProvider implements FestivalProvider {
  async festivals(query: DiscoverQuery): Promise<Festival[]> {
    const items: Festival[] = [
      {
        id: "mock-festival-seoul-light",
        title: "서울 빛 축제",
        subtitle: "도심 야간 산책형 축제",
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        status: "ongoing",
        venueName: "서울광장",
        address: "서울 중구 세종대로 110",
        lat: query.lat + 0.001,
        lng: query.lng + 0.001,
        distanceMeters: distanceMeters(query.lat, query.lng, query.lat + 0.001, query.lng + 0.001),
        source: "mock",
        sourceUrl: null,
        imageUrl: null,
        tags: ["festival", "night"]
      }
    ];
    return sortByStatusThenDistance(items).filter((item) => item.distanceMeters <= query.radiusMeters);
  }

  health(): ProviderHealth {
    return {
      name: "mock-festival",
      status: "up",
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      qualityScore: 1,
      stale: false
    };
  }
}
