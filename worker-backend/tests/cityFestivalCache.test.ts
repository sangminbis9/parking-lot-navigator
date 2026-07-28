import { describe, expect, it } from "vitest";
import { mapCityFestivalRow } from "../src/cityFestivalCache.js";

describe("mapCityFestivalRow", () => {
  const baseRow = {
    id: "city:abc123",
    site_id: "test-city",
    source_url: "https://example.com/detail/1",
    title: "가을 단풍 축제",
    start_date: "2026-10-01",
    end_date: "2026-10-03",
    venue: "시청 광장",
    address: "테스트시 테스트로 1",
    lat: 37.5,
    lng: 127.0,
    image_url: "https://example.com/img/1.jpg"
  };

  it("maps a valid row to a Festival with source=city-scraped and a computed distance", () => {
    const result = mapCityFestivalRow(baseRow, 37.5, 127.0);
    expect(result).not.toBeNull();
    expect(result?.source).toBe("city-scraped");
    expect(result?.title).toBe("가을 단풍 축제");
    expect(result?.distanceMeters).toBe(0);
    expect(result?.sourceUrl).toBe("https://example.com/detail/1");
  });

  it("returns null when the row has no id", () => {
    expect(mapCityFestivalRow({ ...baseRow, id: "" }, 37.5, 127.0)).toBeNull();
  });

  it("returns null when lat/lng are not finite numbers", () => {
    expect(mapCityFestivalRow({ ...baseRow, lat: NaN }, 37.5, 127.0)).toBeNull();
  });
});
