import { afterEach, describe, expect, it, vi } from "vitest";
import { NationalCultureFestivalProvider } from "../src/features/discover/festivals/NationalCultureFestivalProvider.js";

describe("NationalCultureFestivalProvider", () => {
  afterEach(() => {
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
});
