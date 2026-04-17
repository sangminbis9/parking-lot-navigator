import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/env.js";
import { KakaoParkingProvider } from "../src/providers/KakaoParkingProvider.js";

const config: AppConfig = {
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
  KAKAO_REST_API_KEY: "test-key",
  KAKAO_LOCAL_BASE_URL: "https://dapi.kakao.com",
  SEOUL_OPEN_DATA_KEY: "test-seoul",
  SEOUL_OPEN_DATA_BASE_URL: "http://openapi.seoul.go.kr:8088",
  PUBLIC_DATA_SERVICE_KEY: "test-public",
  PUBLIC_DATA_ENV: "development",
  PUBLIC_DATA_BASE_URL: "https://apis.data.go.kr"
};

describe("KakaoParkingProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("queries Kakao parking category search around the destination", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          meta: { is_end: true },
          documents: [
            {
              id: "kakao-1",
              place_name: "Daejeon Station Parking",
              road_address_name: "Daejeon road",
              address_name: "Daejeon",
              x: "127.431",
              y: "36.332"
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new KakaoParkingProvider(config);
    const records = await provider.fetchNearby(36.331, 127.43, { radiusMeters: 30000 });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      source: "kakao-local",
      sourceParkingId: "kakao-1",
      name: "Daejeon Station Parking",
      totalCapacity: null,
      availableSpaces: null,
      realtimeAvailable: false
    });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/v2/local/search/category.json");
    expect(url.searchParams.get("category_group_code")).toBe("PK6");
    expect(url.searchParams.get("x")).toBe("127.43");
    expect(url.searchParams.get("y")).toBe("36.331");
    expect(url.searchParams.get("radius")).toBe("20000");
    expect(url.searchParams.get("sort")).toBe("distance");
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "KakaoAK test-key"
    });
  });

  it("keeps fetching nearby pages until Kakao says the result is complete", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ meta: { is_end: false }, documents: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ meta: { is_end: true }, documents: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new KakaoParkingProvider(config);
    await provider.fetchNearby(35.1796, 129.0756, { radiusMeters: 800 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("page")).toBe("1");
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get("page")).toBe("2");
  });
});
