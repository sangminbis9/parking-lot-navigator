import { describe, expect, it } from "vitest";
import { fallbackTag } from "../src/llmTaggingFallback.js";
import { FESTIVAL_PRIMARY_CATEGORIES as SCHEMA_CATEGORIES } from "../src/llmTaggingSchema.js";
import { FESTIVAL_PRIMARY_CATEGORIES as SHARED_CATEGORIES } from "@parking/shared-types";

describe("fallbackTag - festival domain", () => {
  it("classifies expo/trade-fair titles as general_event", () => {
    const result = fallbackTag({
      domain: "festival",
      id: "a",
      title: "2026 서울 국제 산업박람회",
      source: "tourapi",
    });

    expect(result.primaryCategory).toBe("general_event");
  });

  it("classifies expo keyword in description even when title has no signal", () => {
    const result = fallbackTag({
      domain: "festival",
      id: "b",
      title: "가을맞이 큰 마당",
      description: "이번 행사는 지역 상공인 취업박람회와 함께 진행됩니다.",
      source: "tourapi",
    });

    expect(result.primaryCategory).toBe("general_event");
  });

  it("does not classify generic '행사' wording alone as general_event (over-triggering regression)", () => {
    const result = fallbackTag({
      domain: "festival",
      id: "c",
      title: "가을 문화 행사",
      description: "우리 동네에서 열리는 즐거운 행사입니다.",
      source: "tourapi",
    });

    expect(result.primaryCategory).toBe("etc");
  });

  it("prioritizes general_event over art_exhibition when both keywords appear (rule order regression)", () => {
    const result = fallbackTag({
      domain: "festival",
      id: "d",
      title: "산업박람회 및 미술 전시",
      source: "tourapi",
    });

    expect(result.primaryCategory).toBe("general_event");
  });
});

describe("FESTIVAL_PRIMARY_CATEGORIES sync", () => {
  it("keeps shared-types and llmTaggingSchema category sets identical", () => {
    expect(new Set(SCHEMA_CATEGORIES)).toEqual(new Set(SHARED_CATEGORIES));
  });
});
