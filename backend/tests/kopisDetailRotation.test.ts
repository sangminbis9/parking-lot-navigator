import { afterEach, describe, expect, it, vi } from "vitest";
import { KopisEventProvider } from "../src/features/discover/events/KopisEventProvider.js";

const MAX_PAGES = 1;
const PAGE_CYCLES = 1;
const DETAIL_MAX_ITEMS = 5;

describe("KOPIS detail rotation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("moves the detail window forward each hour so every row eventually gets enriched", async () => {
    const first = await detailIdsAtHour(0);
    const second = await detailIdsAtHour(1);

    expect(first).toEqual(["PF0", "PF1", "PF2", "PF3", "PF4"]);
    expect(second).toEqual(["PF5", "PF6", "PF7", "PF8", "PF9"]);
  });

  it("wraps around the end of the page window", async () => {
    // slot 20 * 5 = 100 -> 100 % 100 === 0
    expect(await detailIdsAtHour(19)).toEqual([
      "PF95",
      "PF96",
      "PF97",
      "PF98",
      "PF99",
    ]);
    expect(await detailIdsAtHour(20)).toEqual([
      "PF0",
      "PF1",
      "PF2",
      "PF3",
      "PF4",
    ]);
  });
});

async function detailIdsAtHour(hour: number): Promise<string[]> {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(hour * 3_600_000));
  const detailIds = stubFetch();
  await newProvider().events(query());
  vi.unstubAllGlobals();
  vi.useRealTimers();
  return [...detailIds].sort(byRowIndex);
}

function byRowIndex(a: string, b: string): number {
  return Number(a.slice(2)) - Number(b.slice(2));
}

function newProvider(): KopisEventProvider {
  return new KopisEventProvider(
    "test-key",
    "https://kopis.example",
    undefined,
    MAX_PAGES,
    DETAIL_MAX_ITEMS,
    PAGE_CYCLES,
  );
}

function query() {
  return {
    lat: 37.5665,
    lng: 126.978,
    radiusMeters: 20000,
    upcomingWithinDays: 30,
  };
}

/// 목록 요청에는 100건짜리 한 페이지를, 상세 요청에는 빈 응답을 준다.
/// 반환값은 이번 회차에 상세를 조회한 공연 id 목록이다.
function stubFetch(): string[] {
  const detailIds: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const id = url.pathname.split("/").pop() ?? "";
      const isDetail = id !== "pblprfr";
      if (isDetail) detailIds.push(id);
      return new Response(isDetail ? "<dbs></dbs>" : fullPage(), {
        headers: { "content-type": "application/xml" },
      });
    }),
  );
  return detailIds;
}

function row(index: number): string {
  return `<db><mt20id>PF${index}</mt20id><prfnm>공연 ${index}</prfnm><fcltynm>서울 극장</fcltynm><prfpdfrom>2026.08.20</prfpdfrom><prfpdto>2026.08.25</prfpdto><area>서울</area></db>`;
}

function fullPage(): string {
  return `<dbs>${Array.from({ length: 100 }, (_, i) => row(i)).join("")}</dbs>`;
}
