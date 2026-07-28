import { afterEach, describe, expect, it } from "vitest";
import { setGeocodeStore } from "../../backend/src/features/discover/events/eventProviderUtils.js";
import type { GeocodeStore, GeocodeStoreEntry } from "../../backend/src/features/discover/events/eventProviderUtils.js";
import { normalizeCandidate, parseCityDateRange } from "../src/cityFestivalNormalize.js";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../src/cityFestivalParsers/types.js";

const config: CitySiteConfig = {
  siteId: "test-city",
  cityName: "테스트시",
  listUrl: "https://example.com/festivals",
  fallbackLat: 37.5,
  fallbackLng: 127.0,
  robotsCheckedAt: "2026-07-28"
};

afterEach(() => {
  setGeocodeStore(null);
});

describe("parseCityDateRange", () => {
  it("extracts a start/end pair from a single combined range string", () => {
    expect(parseCityDateRange("2026.10.01 ~ 2026.10.03", "2026.10.01 ~ 2026.10.03")).toEqual({
      startDate: "2026-10-01",
      endDate: "2026-10-03"
    });
  });

  it("falls back to the same date for both ends when only one date is present", () => {
    expect(parseCityDateRange("2026-11-05", null)).toEqual({
      startDate: "2026-11-05",
      endDate: "2026-11-05"
    });
  });

  it("returns null when no recognizable date is present", () => {
    expect(parseCityDateRange("상시", null)).toBeNull();
  });
});

describe("normalizeCandidate", () => {
  const baseCandidate: RawCityFestivalCandidate = {
    title: "가을 단풍 축제",
    startDateRaw: "2026.10.01 ~ 2026.10.03",
    endDateRaw: "2026.10.01 ~ 2026.10.03",
    venueRaw: null,
    addressRaw: null,
    detailUrl: "https://example.com/detail/1",
    imageUrl: "https://example.com/img/1.jpg"
  };

  it("returns null when title is missing", async () => {
    const result = await normalizeCandidate({ ...baseCandidate, title: null }, config);
    expect(result).toBeNull();
  });

  it("returns null when no date can be parsed", async () => {
    const result = await normalizeCandidate(
      { ...baseCandidate, startDateRaw: "상시", endDateRaw: "상시" },
      config
    );
    expect(result).toBeNull();
  });

  it("falls back to config coordinates when there is no address", async () => {
    const result = await normalizeCandidate(baseCandidate, config);
    expect(result).toEqual({
      siteId: "test-city",
      sourceUrl: "https://example.com/detail/1",
      hasDetailUrl: true,
      title: "가을 단풍 축제",
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      venue: null,
      address: null,
      lat: 37.5,
      lng: 127.0,
      imageUrl: "https://example.com/img/1.jpg"
    });
  });

  it("uses the geocode cache when an address is present and a cached entry is found", async () => {
    const fakeStore: GeocodeStore = {
      async getMany(queries: string[]) {
        const map = new Map<string, GeocodeStoreEntry>();
        for (const query of queries) {
          map.set(query, { found: true, lat: 36.1, lng: 128.4, address: query, venue: null });
        }
        return map;
      },
      async setMany() {}
    };
    setGeocodeStore(fakeStore);

    const result = await normalizeCandidate(
      { ...baseCandidate, addressRaw: "테스트시 테스트로 1" },
      config
    );
    expect(result?.lat).toBe(36.1);
    expect(result?.lng).toBe(128.4);
  });

  it("falls back to config coordinates when the address has no cached geocode entry", async () => {
    const fakeStore: GeocodeStore = {
      async getMany() {
        return new Map();
      },
      async setMany() {}
    };
    setGeocodeStore(fakeStore);

    const result = await normalizeCandidate(
      { ...baseCandidate, addressRaw: "미등록 주소" },
      config
    );
    expect(result?.lat).toBe(37.5);
    expect(result?.lng).toBe(127.0);
  });

  it("marks hasDetailUrl false and falls back sourceUrl to the site's listUrl when detailUrl is missing", async () => {
    const result = await normalizeCandidate({ ...baseCandidate, detailUrl: null }, config);
    expect(result?.hasDetailUrl).toBe(false);
    expect(result?.sourceUrl).toBe("https://example.com/festivals");
  });
});
