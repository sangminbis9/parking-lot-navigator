import { describe, expect, it } from "vitest";
import type { Festival } from "@parking/shared-types";
import { dedupeFestivals } from "../src/discoveryCache.js";

function makeFestival(overrides: Partial<Festival> & Pick<Festival, "id" | "title">): Festival {
  return {
    subtitle: null,
    startDate: "2026-08-01",
    endDate: "2026-08-10",
    status: "upcoming",
    venueName: "테스트 장소",
    address: "서울시 어딘가",
    lat: 37.5665,
    lng: 126.978,
    distanceMeters: 100,
    source: "test",
    sourceUrl: null,
    imageUrl: null,
    tags: [],
    ...overrides,
  };
}

describe("dedupeFestivals", () => {
  it("merges the same festival even when title word order differs across providers", () => {
    const festivals = [
      makeFestival({ id: "a", title: "제1회 봄꽃축제" }),
      makeFestival({ id: "b", title: "봄꽃축제 제1회", description: "풍부한 설명" }),
    ];

    const result = dedupeFestivals(festivals);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });

  it("keeps unrelated festivals separate even when nearby and overlapping in date", () => {
    const festivals = [
      makeFestival({ id: "a", title: "인천 펜타포트 락 페스티벌" }),
      makeFestival({ id: "b", title: "서울 국제 도서전" }),
    ];

    const result = dedupeFestivals(festivals);

    expect(result).toHaveLength(2);
  });

  it("does not merge same-titled events far apart", () => {
    const festivals = [
      makeFestival({ id: "a", title: "가을 문화 축제", lat: 37.5665, lng: 126.978 }),
      makeFestival({ id: "b", title: "가을 문화 축제", lat: 35.1796, lng: 129.0756 }),
    ];

    const result = dedupeFestivals(festivals);

    expect(result).toHaveLength(2);
  });

  it("does not merge same-titled events whose date ranges do not overlap", () => {
    const festivals = [
      makeFestival({
        id: "a",
        title: "가을 문화 축제",
        startDate: "2026-08-01",
        endDate: "2026-08-05",
      }),
      makeFestival({
        id: "b",
        title: "가을 문화 축제",
        startDate: "2026-09-01",
        endDate: "2026-09-05",
      }),
    ];

    const result = dedupeFestivals(festivals);

    expect(result).toHaveLength(2);
  });

  it("still merges exact-match titles as before", () => {
    const festivals = [
      makeFestival({ id: "a", title: "  가을   문화 축제 " }),
      makeFestival({ id: "b", title: "가을문화축제", description: "풍부한 설명" }),
    ];

    const result = dedupeFestivals(festivals);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });
});
