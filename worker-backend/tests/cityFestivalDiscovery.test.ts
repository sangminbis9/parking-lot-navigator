import { afterEach, describe, expect, it, vi } from "vitest";
import { runCityFestivalDiscovery } from "../src/cityFestivalDiscovery.js";
import type { CitySiteConfig } from "../src/cityFestivalParsers/types.js";
import type { Env } from "../src/index.js";

function fakeDb(): {
  db: D1Database;
  batch: ReturnType<typeof vi.fn>;
  prepareCalls: unknown[][];
} {
  const batch = vi.fn(async () => []);
  const prepareCalls: unknown[][] = [];
  const db = {
    prepare: () => ({
      bind: (...args: unknown[]) => {
        prepareCalls.push(args);
        return {};
      }
    }),
    batch
  } as unknown as D1Database;
  return { db, batch, prepareCalls };
}

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return { ...overrides } as Env;
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

  it("fetches a shared listUrl only once when multiple sites use the same URL", async () => {
    const siteB: CitySiteConfig = { ...tableSite, siteId: "site-b", cityName: "테스트시" };
    const fetchMock = vi.fn(async () => new Response(VALID_HTML, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { db } = fakeDb();

    const result = await runCityFestivalDiscovery(db, fakeEnv(), [tableSite, siteB]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.failedSites).toEqual([]);
    expect(result.processed).toBe(2);
  });

  it("does not call the Kakao geocoding API when candidates have no address or venue", async () => {
    const fetchMock = vi.fn(async () => new Response(VALID_HTML, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { db } = fakeDb();
    const envWithKey = fakeEnv({
      KAKAO_REST_API_KEY: "test-key",
      PARKING_PROVIDER_MODE: "real",
      KAKAO_LOCAL_BASE_URL: "https://dapi.kakao.com"
    });

    await runCityFestivalDiscovery(db, envWithKey, [tableSite]);

    const calledUrls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(calledUrls.every((url) => !url.includes("dapi.kakao.com"))).toBe(true);
  });

  it("uses the resolved Kakao coordinates when a candidate has an address and the API finds a match", async () => {
    const siteWithAddress: CitySiteConfig = {
      ...tableSite,
      siteId: "site-with-address",
      selectors: { ...tableSite.selectors!, addressSelector: "td.address" }
    };
    const htmlWithAddress = `
      <table><tbody>
        <tr class="row">
          <td class="title"><a href="/detail/1">가짜 축제</a></td>
          <td class="date">2026.09.01 ~ 2026.09.03</td>
          <td class="address">테스트시 테스트로 1</td>
        </tr>
      </tbody></table>
    `;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const urlString = String(url);
      if (urlString.includes("dapi.kakao.com")) {
        return Response.json({
          documents: [
            {
              place_name: "테스트 광장",
              road_address_name: "테스트시 테스트로 1",
              x: "128.4",
              y: "36.1"
            }
          ]
        });
      }
      return new Response(htmlWithAddress, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, prepareCalls } = fakeDb();
    const envWithKey = fakeEnv({
      KAKAO_REST_API_KEY: "test-key",
      PARKING_PROVIDER_MODE: "real",
      KAKAO_LOCAL_BASE_URL: "https://dapi.kakao.com"
    });

    const result = await runCityFestivalDiscovery(db, envWithKey, [siteWithAddress]);

    expect(result.published).toBe(1);
    // prepareCalls[0] is the geocode cache's getMany() bind call (issued by
    // resolver.warmup() before the upsert); the upsert bind is prepareCalls[1].
    expect(prepareCalls[1][8]).toBe(36.1);
    expect(prepareCalls[1][9]).toBe(128.4);
  });
});
