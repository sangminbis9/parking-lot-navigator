import { describe, expect, it } from "vitest";
import { fallbackTag, festivalOverrideForEtc } from "../src/llmTaggingFallback.js";
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

  it("classifies a bare '-축제' title with no theme keyword as general_event via the generic catch-all", () => {
    const result = fallbackTag({
      domain: "festival",
      id: "e",
      title: "보령머드축제",
      source: "public-data-culture-festival",
    });

    expect(result.primaryCategory).toBe("general_event");
  });

  it("still prioritizes a specific theme (nature_flower) over the generic 축제 catch-all", () => {
    const result = fallbackTag({
      domain: "festival",
      id: "f",
      title: "여의도 벚꽃축제",
      source: "tourapi",
    });

    expect(result.primaryCategory).toBe("nature_flower");
  });
});

describe("festivalOverrideForEtc", () => {
  it("forces kopis rows to music_performance regardless of title text", () => {
    const override = festivalOverrideForEtc({
      domain: "festival",
      id: "g",
      title: "국내 도서관 사용자 이용통계 시스템",
      source: "kopis",
    });

    expect(override).toEqual({ category: "music_performance", tag: "공연" });
  });

  it("catches a bare '-축제' title an LLM already tagged etc", () => {
    const override = festivalOverrideForEtc({
      domain: "festival",
      id: "h",
      title: "소래포구축제",
      source: "city-scraped",
    });

    expect(override).toEqual({ category: "general_event", tag: "지역행사" });
  });

  it("returns null when no rule matches, leaving the LLM's etc verdict untouched", () => {
    const override = festivalOverrideForEtc({
      domain: "festival",
      id: "i",
      title: "구청 정기 회의",
      source: "seoul_open_data",
    });

    expect(override).toBeNull();
  });
});

// 수집 시점에 소스가 결정적으로 확정하는 카테고리 — LLM이 추측 배정하지 않으므로
// llmTaggingSchema.ts의 태깅 스키마에는 의도적으로 포함하지 않는다.
const DETERMINISTIC_ONLY_CATEGORIES = new Set(["trade_expo"]);

describe("FESTIVAL_PRIMARY_CATEGORIES sync", () => {
  it("keeps shared-types and llmTaggingSchema category sets identical outside deterministic-only categories", () => {
    const shared = new Set(SHARED_CATEGORIES);
    for (const deterministic of DETERMINISTIC_ONLY_CATEGORIES) {
      expect(SHARED_CATEGORIES).toContain(deterministic);
      shared.delete(deterministic);
    }
    expect(new Set(SCHEMA_CATEGORIES)).toEqual(shared);
  });
});
