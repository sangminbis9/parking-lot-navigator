import { afterEach, describe, expect, it, vi } from "vitest";
import { runCityFestivalDiscovery } from "../src/cityFestivalDiscovery.js";
import type { CitySiteConfig } from "../src/cityFestivalParsers/types.js";
import type { Env } from "../src/index.js";

function fakeDb(): { db: D1Database; batch: ReturnType<typeof vi.fn> } {
  const batch = vi.fn(async () => []);
  const db = {
    prepare: () => ({ bind: () => ({}) }),
    batch
  } as unknown as D1Database;
  return { db, batch };
}

function fakeEnv(): Env {
  return {} as Env;
}

const tableSite: CitySiteConfig = {
  siteId: "site-a",
  cityName: "테스트시",
  listUrl: "https://example.com/festivals",
  fallbackLat: 37.5,
  fallbackLng: 127.0,
  robotsCheckedAt: "2026-07-28",
  selectors: {
    itemSelector: "tr.row",
    titleSelector: "td.title a",
    dateSelector: "td.date",
    linkSelector: "td.title a"
  }
};

const VALID_HTML = `
  <table><tbody>
    <tr class="row">
      <td class="title"><a href="/detail/1">가짜 축제</a></td>
      <td class="date">2026.09.01 ~ 2026.09.03</td>
    </tr>
  </tbody></table>
`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runCityFestivalDiscovery", () => {
  it("processes a site, scores its candidate above threshold, and upserts it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(VALID_HTML, { status: 200 })
    );
    const { db, batch } = fakeDb();

    const result = await runCityFestivalDiscovery(db, fakeEnv(), [tableSite]);

    expect(result.processed).toBe(1);
    expect(result.published).toBe(1);
    expect(result.failedSites).toEqual([]);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toHaveLength(1);
  });

  it("records a failing site in failedSites and still processes the remaining sites", async () => {
    const otherSite: CitySiteConfig = { ...tableSite, siteId: "site-b", listUrl: "https://example.org/festivals" };
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(new Response(VALID_HTML, { status: 200 }));
    const { db, batch } = fakeDb();

    const result = await runCityFestivalDiscovery(db, fakeEnv(), [tableSite, otherSite]);

    expect(result.failedSites).toEqual(["site-a"]);
    expect(result.published).toBe(1);
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("treats a non-ok HTTP response as a site failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    const { db } = fakeDb();

    const result = await runCityFestivalDiscovery(db, fakeEnv(), [tableSite]);

    expect(result.failedSites).toEqual(["site-a"]);
    expect(result.published).toBe(0);
  });
});
