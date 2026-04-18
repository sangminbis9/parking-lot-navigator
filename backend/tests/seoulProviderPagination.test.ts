import { afterEach, describe, expect, it, vi } from "vitest";
import { SeoulRealtimeParkingProvider } from "../src/providers/SeoulRealtimeParkingProvider.js";
import type { AppConfig } from "../src/config/env.js";

describe("Seoul realtime provider pagination", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches Seoul realtime rows beyond the first 1000 records", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requestedUrls.push(url);
        const isFirstPage = url.includes("/1/1000/");
        return Response.json({
          GetParkingInfo: {
            list_total_count: 1001,
            row: [
              {
                PKLT_CD: isFirstPage ? "first" : "second",
                PKLT_NM: isFirstPage ? "First Parking" : "Second Parking",
                TPKCT: 10,
                NOW_PRK_VHCL_CNT: isFirstPage ? 6 : 4,
                NOW_PRK_VHCL_UPDT_TM: "2026-04-18 12:00:00",
                PRK_STTS_YN: "1"
              }
            ]
          }
        });
      })
    );

    const provider = new SeoulRealtimeParkingProvider(testConfig());
    const records = await provider.fetchNearby(37.5665, 126.978, { radiusMeters: 800 });
    const realtimeUrls = requestedUrls.filter((url) => url.includes("/GetParkingInfo/"));

    expect(realtimeUrls).toHaveLength(2);
    expect(realtimeUrls[1]).toContain("/1001/1001/");
    expect(records.map((record) => record.sourceParkingId)).toEqual(["first", "second"]);
    expect(records.map((record) => record.availableSpaces)).toEqual([4, 6]);
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
    KAKAO_REST_API_KEY: "test",
    KAKAO_LOCAL_BASE_URL: "https://dapi.kakao.com",
    SEOUL_OPEN_DATA_KEY: "test",
    SEOUL_OPEN_DATA_BASE_URL: "https://example.com",
    PUBLIC_DATA_SERVICE_KEY: "test",
    PUBLIC_DATA_ENV: "development",
    PUBLIC_DATA_BASE_URL: "https://apis.data.go.kr"
  };
}
