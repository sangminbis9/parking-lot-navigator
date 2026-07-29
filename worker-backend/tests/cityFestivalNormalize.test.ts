import { describe, expect, it } from "vitest";
import type { EventCoordinateResolver } from "../../backend/src/features/discover/events/eventProviderUtils.js";
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

  it("falls back to config coordinates when there is no address or venue", async () => {
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

  it("falls back to config coordinates when there is an address but no resolver is given", async () => {
    const result = await normalizeCandidate(
      { ...baseCandidate, addressRaw: "테스트시 테스트로 1" },
      config
    );
    expect(result?.lat).toBe(37.5);
    expect(result?.lng).toBe(127.0);
  });

  it("uses the resolver's coordinates when an address is present and the resolver finds a match", async () => {
    const fakeResolver: EventCoordinateResolver = {
      async resolve(input) {
        expect(input).toEqual({
          title: "가을 단풍 축제",
          venue: null,
          address: "테스트시 테스트로 1",
          region: "테스트시"
        });
        return { lat: 36.1, lng: 128.4, address: input.address ?? null, venue: null };
      }
    };

    const result = await normalizeCandidate(
      { ...baseCandidate, addressRaw: "테스트시 테스트로 1" },
      config,
      fakeResolver
    );
    expect(result?.lat).toBe(36.1);
    expect(result?.lng).toBe(128.4);
  });

  it("falls back to config coordinates when the resolver cannot find a match", async () => {
    const fakeResolver: EventCoordinateResolver = {
      async resolve() {
        return null;
      }
    };

    const result = await normalizeCandidate(
      { ...baseCandidate, addressRaw: "미등록 주소" },
      config,
      fakeResolver
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
