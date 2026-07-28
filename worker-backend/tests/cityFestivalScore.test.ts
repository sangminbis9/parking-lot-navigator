import { describe, expect, it } from "vitest";
import { isWithinKoreaBounds, scoreCandidate } from "../src/cityFestivalScore.js";
import type { NormalizedCityFestival } from "../src/cityFestivalNormalize.js";

const full: NormalizedCityFestival = {
  siteId: "test-city",
  sourceUrl: "https://example.com/detail/1",
  hasDetailUrl: true,
  title: "가을 단풍 축제",
  startDate: "2026-10-01",
  endDate: "2026-10-03",
  venue: "시청 광장",
  address: "테스트시 테스트로 1",
  lat: 37.5,
  lng: 127.0,
  imageUrl: "https://example.com/img/1.jpg"
};

describe("isWithinKoreaBounds", () => {
  it("accepts coordinates inside the Korean peninsula bounding box", () => {
    expect(isWithinKoreaBounds(37.5, 127.0)).toBe(true);
  });

  it("rejects coordinates far outside Korea", () => {
    expect(isWithinKoreaBounds(0, 0)).toBe(false);
  });
});

describe("scoreCandidate", () => {
  it("scores a fully populated candidate at 1.0", () => {
    expect(scoreCandidate(full)).toBeCloseTo(1.0);
  });

  it("drops the 0.2 detail-url bonus when hasDetailUrl is false", () => {
    expect(scoreCandidate({ ...full, hasDetailUrl: false })).toBeCloseTo(0.8);
  });

  it("drops the 0.2 korea-bounds bonus when coordinates are out of range", () => {
    expect(scoreCandidate({ ...full, lat: 0, lng: 0 })).toBeCloseTo(0.8);
  });

  it("drops the 0.3 title bonus when the title is a single character", () => {
    expect(scoreCandidate({ ...full, title: "축" })).toBeCloseTo(0.7);
  });

  it("drops the 0.3 date bonus when startDate is after endDate", () => {
    expect(scoreCandidate({ ...full, startDate: "2026-10-05", endDate: "2026-10-01" })).toBeCloseTo(0.7);
  });
});
