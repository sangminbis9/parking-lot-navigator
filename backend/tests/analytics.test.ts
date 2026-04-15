import { describe, expect, it } from "vitest";
import { normalizePlaceCategory } from "../src/features/analytics/categoryNormalization.js";

describe("category normalization", () => {
  it("maps provider category strings to normalized categories", () => {
    expect(normalizePlaceCategory("음식점 > 한식")).toBe("restaurant");
    expect(normalizePlaceCategory("카페 > 커피전문점")).toBe("cafe");
    expect(normalizePlaceCategory("교통 > 지하철역")).toBe("station");
    expect(normalizePlaceCategory(null, "서울대학교")).toBe("school");
  });

  it("falls back to other for unknown categories", () => {
    expect(normalizePlaceCategory("unknown")).toBe("other");
  });
});
