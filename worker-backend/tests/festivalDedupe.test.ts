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

  it("does not merge lexically similar but distinct festival titles (false-positive regression)", () => {
    const pairs: [string, string][] = [
      ["가을 축제", "가을꽃 축제"],
      ["제1회 전통시장 축제", "제2회 전통시장 축제"],
      ["송도 벚꽃축제", "송도 불꽃축제"],
      ["서울 빛초롱 축제", "서울 빛 축제"],
      ["김장 문화 축제", "장 문화 축제"],
      ["문화의 날 축제", "문화의 밤 축제"],
    ];

    for (const [titleA, titleB] of pairs) {
      const festivals = [
        makeFestival({ id: "a", title: titleA }),
        makeFestival({ id: "b", title: titleB }),
      ];

      const result = dedupeFestivals(festivals);

      expect(result, `"${titleA}" vs "${titleB}" should stay separate`).toHaveLength(2);
    }
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

  // 좌표 미상 축제가 지역 대표 좌표 한 점에 수천 건 쌓여도 CPU 한도 안에서 끝나야 한다.
  // 전수 비교(O(n²)) 시절 이 입력이 Worker에서 503(error code 1102)을 냈다.
  it("dedupes thousands of festivals stacked on one coordinate quickly", () => {
    const festivals = Array.from({ length: 3000 }, (_, i) =>
      makeFestival({ id: `f${i}`, title: `축제 ${i}` }),
    );

    const startedAt = Date.now();
    const result = dedupeFestivals(festivals);

    expect(result).toHaveLength(3000);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});
