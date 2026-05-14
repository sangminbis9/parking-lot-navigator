import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/env.js";
import { KakaoEventCoordinateResolver } from "../src/features/discover/events/eventProviderUtils.js";

describe("KakaoEventCoordinateResolver", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tries fallback queries in order until one resolves", async () => {
    const fetchMock = vi.fn(async (url: URL) => {
      const query = url.searchParams.get("query");
      if (query === "bad address") {
        return Response.json({ documents: [] });
      }
      return Response.json({
        documents: [
          {
            place_name: "Fallback Venue",
            road_address_name: "Seoul fallback road",
            x: "126.9780",
            y: "37.5665"
          }
        ]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const resolver = new KakaoEventCoordinateResolver(testConfig());
    const resolved = await resolver.resolve({
      title: "Fallback Event",
      address: "bad address",
      venue: "Fallback Venue",
      region: "Seoul"
    });

    expect(resolved).toMatchObject({ lat: 37.5665, lng: 126.978 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => (url as URL).searchParams.get("query"))).toEqual([
      "bad address",
      "Seoul Fallback Venue"
    ]);
  });
});

function testConfig(): AppConfig {
  return {
    NODE_ENV: "test",
    PORT: 4000,
    HOST: "0.0.0.0",
    LOG_LEVEL: "silent",
    PARKING_PROVIDER_MODE: "real",
    DEFAULT_SEARCH_RADIUS_METERS: 800,
    DEFAULT_DISCOVER_RADIUS_METERS: 20000,
    STALE_THRESHOLD_SECONDS: 600,
    CACHE_TTL_SECONDS: 60,
    DISCOVER_CACHE_TTL_SECONDS: 21600,
    FESTIVAL_PROVIDER_ENABLED: true,
    EVENT_PROVIDER_ENABLED: true,
    KAKAO_REST_API_KEY: "test-kakao",
    KAKAO_LOCAL_BASE_URL: "https://dapi.kakao.com",
    SEOUL_OPEN_DATA_KEY: "test-seoul",
    SEOUL_OPEN_DATA_BASE_URL: "http://openapi.seoul.go.kr:8088",
    PUBLIC_DATA_SERVICE_KEY: "test-public",
    PUBLIC_DATA_ENV: "development",
    PUBLIC_DATA_BASE_URL: "https://apis.data.go.kr",
    CULTURE_PORTAL_API_KEY: "test-culture",
    KOPIS_API_KEY: "test-kopis",
    KOPIS_BASE_URL: "http://www.kopis.or.kr",
    KCISA_428_API_KEY: "test-kcisa-428",
    KCISA_196_API_KEY: "test-kcisa-196",
    KCISA_BASE_URL: "https://api.kcisa.kr"
  };
}
