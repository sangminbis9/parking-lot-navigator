import { afterEach, describe, expect, it, vi } from "vitest";
import { NationalCultureFestivalProvider } from "../src/features/discover/festivals/NationalCultureFestivalProvider.js";
import { setGeocodeStore } from "../src/features/discover/events/eventProviderUtils.js";

describe("NationalCultureFestivalProvider", () => {
  afterEach(() => {
    setGeocodeStore(null);
    vi.restoreAllMocks();
  });

  it("maps national culture festival standard data into nearby festival pins", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          response: {
            header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
            body: {
              totalCount: 1,
              items: [
                {
                  fstvlNm: "Sample Culture Festival",
                  opar: "Sample Plaza",
                  fstvlStartDate: "2099-05-01",
                  fstvlEndDate: "2099-05-05",
                  fstvlCo: "Music and local market",
                  mnnstNm: "Sample City",
                  auspcInsttNm: "Sample Foundation",
                  suprtInstt: "Sample Province",
                  phoneNumber: "02-0000-0000",
                  homepageUrl: "https://example.com/festival",
                  rdnmadr: "Seoul Jung-gu Sample-ro 1",
                  latitude: "37.5665",
                  longitude: "126.9780",
                  referenceDate: "2026-05-01",
                  insttCode: "1230000"
                }
              ]
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new NationalCultureFestivalProvider("test-key", "https://api.data.go.kr");
    const items = await provider.festivals({
      lat: 37.5665,
      lng: 126.9780,
      radiusMeters: 1000,
      upcomingWithinDays: 36500
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Sample Culture Festival",
      subtitle: "Music and local market",
      startDate: "2099-05-01",
      endDate: "2099-05-05",
      status: "upcoming",
      venueName: "Sample Plaza",
      address: "Seoul Jung-gu Sample-ro 1",
      lat: 37.5665,
      lng: 126.978,
      source: "public-data-culture-festival",
      sourceUrl: "https://example.com/festival",
      imageUrl: null,
      tags: ["culture-festival", "Sample City", "Sample Foundation", "Sample Province"]
    });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/openapi/tn_pubr_public_cltur_fstvl_api");
    expect(url.searchParams.get("serviceKey")).toBe("test-key");
    expect(url.searchParams.get("numOfRows")).toBe("1000");
    expect(url.searchParams.get("type")).toBe("json");
  });

  it("caches the full national feed before applying per-query radius filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          response: {
            header: { resultCode: "00" },
            body: {
              totalCount: 1,
              items: [
                {
                  fstvlNm: "Cached Festival",
                  fstvlStartDate: "2099-06-01",
                  fstvlEndDate: "2099-06-03",
                  latitude: "37.5665",
                  longitude: "126.9780"
                }
              ]
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new NationalCultureFestivalProvider("test-key", "https://api.data.go.kr");
    await provider.festivals({ lat: 37.5665, lng: 126.9780, radiusMeters: 1000, upcomingWithinDays: 36500 });
    await provider.festivals({ lat: 35.1796, lng: 129.0756, radiusMeters: 1000, upcomingWithinDays: 36500 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts integer Korea coordinates and rejects 0/0 through coordinate validation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          response: {
            header: { resultCode: "00" },
            body: {
              totalCount: 2,
              items: [
                {
                  fstvlNm: "Integer Coordinate Festival",
                  fstvlStartDate: "2099-07-01",
                  fstvlEndDate: "2099-07-02",
                  latitude: 37,
                  longitude: 127
                },
                {
                  fstvlNm: "Zero Coordinate Festival",
                  fstvlStartDate: "2099-07-01",
                  fstvlEndDate: "2099-07-02",
                  latitude: 0,
                  longitude: 0
                }
              ]
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new NationalCultureFestivalProvider("test-key", "https://api.data.go.kr");
    const items = await provider.festivals({
      lat: 37,
      lng: 127,
      radiusMeters: 1000,
      upcomingWithinDays: 36500
    });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Integer Coordinate Festival");
    expect(items[0].lat).toBe(37);
    expect(items[0].lng).toBe(127);
  });

  it("uses geocode_cache for rows without coordinates", async () => {
    const getMany = vi.fn().mockResolvedValue(
      new Map([
        [
          "제주특별자치도 제주시 첨단로 1",
          {
            found: true,
            lat: 33.4507,
            lng: 126.5707,
            address: "제주특별자치도 제주시 첨단로 1",
            venue: "제주 축제장"
          }
        ]
      ])
    );
    setGeocodeStore({ getMany, setMany: vi.fn() });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            response: {
              header: { resultCode: "00" },
              body: {
                totalCount: 1,
                items: [
                  {
                    fstvlNm: "Cached Coordinate Festival",
                    opar: "제주 축제장",
                    fstvlStartDate: "2099-08-01",
                    fstvlEndDate: "2099-08-03",
                    rdnmadr: "제주특별자치도 제주시 첨단로 1"
                  }
                ]
              }
            }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const provider = new NationalCultureFestivalProvider("test-key", "https://api.data.go.kr");
    const items = await provider.festivals({
      lat: 33.4507,
      lng: 126.5707,
      radiusMeters: 1000,
      upcomingWithinDays: 36500
    });

    expect(getMany).toHaveBeenCalledWith(["제주특별자치도 제주시 첨단로 1"]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Cached Coordinate Festival",
      lat: 33.4507,
      lng: 126.5707
    });
  });

  it("batch reads geocode_cache once for many rows without coordinates", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => {
      const hasCoordinate = index % 2 === 0;
      return {
        fstvlNm: `Batch Festival ${index}`,
        fstvlStartDate: "2099-10-01",
        fstvlEndDate: "2099-10-03",
        rdnmadr: `Batch Address ${index}`,
        latitude: hasCoordinate ? "37.1000" : "",
        longitude: hasCoordinate ? "127.1000" : ""
      };
    });
    const coordinateMap = new Map(
      rows
        .filter((_, index) => index % 2 === 1)
        .map((row, index) => [
          row.rdnmadr,
          {
            found: true,
            lat: 37.2 + index * 0.0001,
            lng: 127.2 + index * 0.0001,
            address: row.rdnmadr,
            venue: null
          }
        ])
    );
    const getMany = vi.fn().mockResolvedValue(coordinateMap);
    setGeocodeStore({ getMany, setMany: vi.fn() });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            response: {
              header: { resultCode: "00" },
              body: { totalCount: rows.length, items: rows }
            }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const provider = new NationalCultureFestivalProvider("test-key", "https://api.data.go.kr");
    const items = await provider.festivals({
      lat: 37.15,
      lng: 127.15,
      radiusMeters: 50000,
      upcomingWithinDays: 36500
    });

    expect(getMany).toHaveBeenCalledTimes(1);
    expect(getMany.mock.calls[0][0]).toHaveLength(50);
    expect(items).toHaveLength(100);
  });

  it("returns an empty list when the fetch is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = Object.assign(new Error("aborted"), {
      name: "AbortError"
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const provider = new NationalCultureFestivalProvider("test-key", "https://api.data.go.kr");
    const items = await provider.festivals({
      lat: 37.5665,
      lng: 126.9780,
      radiusMeters: 1000,
      upcomingWithinDays: 36500,
      signal: controller.signal
    });

    expect(items).toEqual([]);
  });

  it("creates deterministic SHA-256 based ids and distinguishes different source keys", async () => {
    const body = {
      response: {
        header: { resultCode: "00" },
        body: {
          totalCount: 2,
          items: [
            {
              fstvlNm: "Stable Festival",
              fstvlStartDate: "2099-09-01",
              fstvlEndDate: "2099-09-02",
              latitude: "37.1000",
              longitude: "127.1000",
              insttCode: "A"
            },
            {
              fstvlNm: "Stable Festival Long Variant",
              fstvlStartDate: "2099-09-01",
              fstvlEndDate: "2099-09-02",
              latitude: "37.1000",
              longitude: "127.1000",
              insttCode: "A"
            }
          ]
        }
      }
    };
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      ));
    vi.stubGlobal("fetch", fetchMock);

    const first = await new NationalCultureFestivalProvider(
      "test-key",
      "https://api.data.go.kr"
    ).festivals({ lat: 37.1, lng: 127.1, radiusMeters: 1000, upcomingWithinDays: 36500 });
    const second = await new NationalCultureFestivalProvider(
      "test-key",
      "https://api.data.go.kr"
    ).festivals({ lat: 37.1, lng: 127.1, radiusMeters: 1000, upcomingWithinDays: 36500 });

    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
    expect(first[0].id).toMatch(/^public-data-culture:[0-9a-f]{16}$/);
    expect(first[0].id).not.toBe(first[1].id);
  });
});
