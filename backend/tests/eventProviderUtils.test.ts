import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/env.js";
import {
  KakaoEventCoordinateResolver,
  setGeocodeStore
} from "../src/features/discover/events/eventProviderUtils.js";
import type { GeocodeStoreEntry } from "../src/features/discover/events/eventProviderUtils.js";

describe("KakaoEventCoordinateResolver", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setGeocodeStore(null);
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

  it("retries the venue with parentheses and 일원 stripped", async () => {
    const fetchMock = vi.fn(async (url: URL) => {
      const query = url.searchParams.get("query");
      if (query !== "화성행궁 광장") return Response.json({ documents: [] });
      return Response.json({
        documents: [
          {
            place_name: "화성행궁 광장",
            road_address_name: "경기도 수원시 팔달구 정조로 825",
            x: "127.0128",
            y: "37.2814"
          }
        ]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const resolver = new KakaoEventCoordinateResolver(testConfig());
    const resolved = await resolver.resolve({
      title: "수원문화제",
      venue: "화성행궁 광장 일원(주차장 옆)",
      region: "수원"
    });

    expect(resolved).toMatchObject({ lat: 37.2814, lng: 127.0128 });
    expect(fetchMock.mock.calls.map(([url]) => (url as URL).searchParams.get("query"))).toEqual([
      "수원 화성행궁 광장 일원(주차장 옆)",
      "화성행궁 광장 일원(주차장 옆)",
      "수원 화성행궁 광장 일원",
      "화성행궁 광장 일원",
      "수원 화성행궁 광장",
      "화성행궁 광장"
    ]);
  });

  it("takes only the first place when the venue lists several", async () => {
    const fetchMock = vi.fn(async (url: URL) => {
      const query = url.searchParams.get("query");
      if (query !== "울산 태화강국가정원") return Response.json({ documents: [] });
      return Response.json({
        documents: [{ place_name: "태화강국가정원", x: "129.3167", y: "35.5478" }]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const resolver = new KakaoEventCoordinateResolver(testConfig());
    const resolved = await resolver.resolve({
      title: "태화강 축제",
      venue: "태화강국가정원 및 십리대숲",
      region: "울산"
    });

    expect(resolved).toMatchObject({ lat: 35.5478, lng: 129.3167 });
  });

  it("caches a genuine empty result but not a failed request", async () => {
    const writes: Array<{ query: string; entry: GeocodeStoreEntry }> = [];
    setGeocodeStore({
      getMany: async () => new Map(),
      setMany: async (entries) => {
        writes.push(...entries);
      }
    });

    const fetchMock = vi.fn(async (url: URL) => {
      const query = url.searchParams.get("query");
      if (query === "없는 장소") return Response.json({ documents: [] });
      return new Response("upstream down", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const resolver = new KakaoEventCoordinateResolver(testConfig());
    expect(await resolver.resolve({ title: "무제", venue: "없는 장소" })).toBeNull();
    expect(await resolver.resolve({ title: "무제", venue: "실패하는 장소" })).toBeNull();
    await resolver.flush();

    expect(writes.map((write) => write.query)).toEqual(["없는 장소"]);
    expect(writes[0].entry.found).toBe(false);
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
