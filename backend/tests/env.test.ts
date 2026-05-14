import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env.js";
import { assertProductionSecrets } from "../src/config/env.js";

describe("assertProductionSecrets", () => {
  it("does not report PUBLIC_DATA_SERVICE_KEY more than once", () => {
    const missing = assertProductionSecrets({
      ...testConfig(),
      PARKING_PROVIDER_MODE: "real",
      FESTIVAL_PROVIDER_ENABLED: true,
      EVENT_PROVIDER_ENABLED: true,
      SEOUL_OPEN_DATA_KEY: undefined,
      PUBLIC_DATA_SERVICE_KEY: undefined
    });

    expect(missing.filter((key) => key === "PUBLIC_DATA_SERVICE_KEY")).toHaveLength(1);
  });
});

function testConfig(): AppConfig {
  return {
    NODE_ENV: "test",
    PORT: 4000,
    HOST: "0.0.0.0",
    LOG_LEVEL: "silent",
    PARKING_PROVIDER_MODE: "mock",
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
    CULTURE_PORTAL_API_KEY: undefined,
    KOPIS_API_KEY: undefined,
    KOPIS_BASE_URL: "http://www.kopis.or.kr",
    KCISA_428_API_KEY: undefined,
    KCISA_196_API_KEY: undefined,
    KCISA_BASE_URL: "https://api.kcisa.kr"
  };
}
