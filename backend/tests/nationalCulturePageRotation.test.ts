import { afterEach, describe, expect, it, vi } from "vitest";
import { NationalCultureFestivalProvider } from "../src/features/discover/festivals/NationalCultureFestivalProvider.js";

const MAX_PAGES = 2;
const PAGE_CYCLES = 3;

describe("national culture festival page rotation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reads one rotated window sequentially instead of the whole feed at once", async () => {
    // slot = floor(epochHours) % 3 === 1 -> startPage = 1 * 2 + 1 = 3
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1 * 3_600_000));

    const pages = stubFetch(() => fullPage());
    await newProvider().festivals(query());

    expect(pages).toEqual(["3", "4"]);
  });

  it("falls back to page 1 when the rotated window is past the end of the feed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1 * 3_600_000));

    const pages = stubFetch((page) => (page === "1" ? shortPage() : emptyPage()));
    await newProvider().festivals(query());

    expect(pages).toEqual(["3", "1"]);
  });
});

function newProvider(): NationalCultureFestivalProvider {
  return new NationalCultureFestivalProvider(
    "test-key",
    "https://api.data.go.kr",
    MAX_PAGES,
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

function stubFetch(body: (page: string) => string): string[] {
  const pages: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const page = url.searchParams.get("pageNo") ?? "";
      pages.push(page);
      return new Response(body(page), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return pages;
}

function page(rows: number): string {
  return JSON.stringify({
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
      body: {
        totalCount: 6000,
        items: Array.from({ length: rows }, (_, index) => ({
          fstvlNm: `축제 ${index}`,
          fstvlStartDate: "2099-05-01",
          fstvlEndDate: "2099-05-05",
          rdnmadr: "서울 중구 샘플로 1",
          latitude: "37.5665",
          longitude: "126.9780",
        })),
      },
    },
  });
}

function fullPage(): string {
  return page(1000);
}

function shortPage(): string {
  return page(1);
}

function emptyPage(): string {
  return page(0);
}
