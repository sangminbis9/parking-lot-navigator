import { afterEach, describe, expect, it, vi } from "vitest";
import { KopisEventProvider } from "../src/features/discover/events/KopisEventProvider.js";

const MAX_PAGES = 2;
const PAGE_CYCLES = 3;

describe("KOPIS page rotation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("starts from a rotated page so later pages eventually get refreshed", async () => {
    // slot = floor(epochHours) % 3 === 1 -> startPage = 1 * 2 + 1 = 3
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1 * 3_600_000));

    const pages = stubFetch(() => fullPage());
    await newProvider().events(query());

    expect(pages).toEqual(["3", "4"]);
  });

  it("falls back to page 1 when the rotated window is past the end of the feed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1 * 3_600_000));

    const pages = stubFetch((page) => (page === "1" ? shortPage() : "<dbs></dbs>"));
    await newProvider().events(query());

    expect(pages).toEqual(["3", "1"]);
  });
});

function newProvider(): KopisEventProvider {
  return new KopisEventProvider(
    "test-key",
    "https://kopis.example",
    undefined,
    MAX_PAGES,
    0,
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
      const page = url.searchParams.get("cpage") ?? "";
      pages.push(page);
      return new Response(body(page), {
        headers: { "content-type": "application/xml" },
      });
    }),
  );
  return pages;
}

function row(index: number): string {
  return `<db><mt20id>PF${index}</mt20id><prfnm>공연 ${index}</prfnm><fcltynm>서울 극장</fcltynm><prfpdfrom>2026.08.20</prfpdfrom><prfpdto>2026.08.25</prfpdto><area>서울</area></db>`;
}

function fullPage(): string {
  return `<dbs>${Array.from({ length: 100 }, (_, i) => row(i)).join("")}</dbs>`;
}

function shortPage(): string {
  return `<dbs>${row(0)}</dbs>`;
}
