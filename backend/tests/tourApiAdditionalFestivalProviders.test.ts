import { afterEach, describe, expect, it, vi } from "vitest";
import { TourApiAreaFestivalProvider } from "../src/features/discover/festivals/TourApiAreaFestivalProvider.js";
import { TourApiFestivalProvider } from "../src/features/discover/festivals/TourApiFestivalProvider.js";
import { TourApiKeywordFestivalProvider } from "../src/features/discover/festivals/TourApiKeywordFestivalProvider.js";

describe("additional TourAPI festival providers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps searchKeyword2 festival results", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(tourResponse({
        contentid: "keyword-1",
        title: "Keyword Festival",
        addr1: "Gangneung",
        eventstartdate: "20990501",
        eventenddate: "20990505",
        mapx: "128.8761",
        mapy: "37.7519",
        firstimage: "https://example.com/keyword.jpg",
        cat1: "A02",
        cat2: "A0207",
        cat3: "A02070100"
      }))
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new TourApiKeywordFestivalProvider(
      "test-key",
      "https://apis.data.go.kr",
      1
    );
    const items = await provider.festivals({
      lat: 37.7519,
      lng: 128.8761,
      radiusMeters: 1000,
      upcomingWithinDays: 36500
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "keyword-tour:keyword-1",
      title: "Keyword Festival",
      source: "keyword-tour",
      startDate: "2099-05-01",
      endDate: "2099-05-05"
    });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/B551011/KorService2/searchKeyword2");
    expect(url.searchParams.get("keyword")).toBe("\uCD95\uC81C");
    expect(url.searchParams.get("cat1")).toBe("A02");
    expect(url.searchParams.get("cat2")).toBe("A0207");
  });

  it("maps areaBasedList2 festival results", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(tourResponse({
        contentid: "area-1",
        title: "Area Festival",
        addr1: "Jeju",
        eventstartdate: "20990601",
        eventenddate: "20990603",
        mapx: "126.5312",
        mapy: "33.4996",
        firstimage: "https://example.com/area.jpg",
        cat1: "A02",
        cat2: "A0207",
        cat3: "A02070200"
      }))
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new TourApiAreaFestivalProvider(
      "test-key",
      "https://apis.data.go.kr",
      1
    );
    const items = await provider.festivals({
      lat: 33.4996,
      lng: 126.5312,
      radiusMeters: 1000,
      upcomingWithinDays: 36500
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "area-based-tour:area-1",
      title: "Area Festival",
      source: "area-based-tour",
      startDate: "2099-06-01",
      endDate: "2099-06-03"
    });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/B551011/KorService2/areaBasedList2");
    expect(url.searchParams.get("contentTypeId")).toBe("15");
    expect(url.searchParams.get("areaCode")).toBe("1");
  });

  it("enriches TourAPI festivals from detailCommon2 and detailImage2", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/searchFestival2")) {
        return Promise.resolve(
          tourResponse({
            contentid: "detail-1",
            title: "Detailed Festival",
            addr1: "Seoul",
            eventstartdate: "20990701",
            eventenddate: "20990705",
            mapx: "126.9780",
            mapy: "37.5665",
            cat1: "A02",
            cat2: "A0207",
            cat3: "A02070100",
          }),
        );
      }
      if (url.pathname.endsWith("/detailCommon2")) {
        return Promise.resolve(
          tourResponse({
            contentid: "detail-1",
            overview: "<p>Official festival overview</p>",
            homepage: '<a href="https://example.com/detail">home</a>',
          }),
        );
      }
      if (url.pathname.endsWith("/detailImage2")) {
        return Promise.resolve(
          tourResponse({
            contentid: "detail-1",
            originimgurl: "https://example.com/detail.jpg",
          }),
        );
      }
      if (url.pathname.endsWith("/detailIntro2")) {
        return Promise.resolve(
          tourResponse({
            eventplace: "서울광장",
            usetimefestival: "무료",
            discountinfofestival: "조기 예매 10% 할인",
            bookingplace: "인터파크",
            agelimit: "전연령",
            playtime: "19:00~21:00",
            program: "<p>개막식</p>",
            subevent: "플리마켓",
            sponsor1: "서울시",
            sponsor1tel: "02-1234-5678",
            sponsor2: "서울문화재단",
          }),
        );
      }
      return Promise.resolve(tourResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new TourApiFestivalProvider(
      "test-key",
      "https://apis.data.go.kr",
      1,
    );
    const items = await provider.festivals({
      lat: 37.5665,
      lng: 126.978,
      radiusMeters: 1000,
      upcomingWithinDays: 36500,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Detailed Festival",
      description: "Official festival overview",
      sourceUrl: "https://example.com/detail",
      imageUrl: "https://example.com/detail.jpg",
      venueName: "서울광장",
      admissionFee: "무료",
      discountInfo: "조기 예매 10% 할인",
      bookingInfo: "인터파크",
      ageLimit: "전연령",
      contactPhone: "02-1234-5678",
      programInfo: "공연시간: 19:00~21:00\n프로그램: 개막식\n부대행사: 플리마켓",
      organizerName: "주최: 서울시 / 주관: 서울문화재단",
    });
    expect(
      fetchMock.mock.calls.some(
        ([input]) => new URL(String(input)).pathname === "/B551011/KorService2/detailCommon2",
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([input]) => new URL(String(input)).pathname === "/B551011/KorService2/detailImage2",
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([input]) => new URL(String(input)).pathname === "/B551011/KorService2/detailIntro2",
      ),
    ).toBe(true);
  });

  it("picks the first URL-shaped token out of label text mixed with a scheme-less domain", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/searchFestival2")) {
        return Promise.resolve(
          tourResponse({
            contentid: "detail-2",
            title: "Label Text Festival",
            addr1: "Busan",
            eventstartdate: "20990801",
            eventenddate: "20990805",
            mapx: "129.0756",
            mapy: "35.1796",
            cat1: "A02",
            cat2: "A0207",
            cat3: "A02070100",
          }),
        );
      }
      if (url.pathname.endsWith("/detailCommon2")) {
        return Promise.resolve(
          tourResponse({
            contentid: "detail-2",
            homepage:
              "공식 홈페이지 www.hibimf.org\n공식 인스타그램 https://www.instagram.com/busanmagicfestival",
          }),
        );
      }
      return Promise.resolve(tourResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new TourApiFestivalProvider(
      "test-key",
      "https://apis.data.go.kr",
      1,
    );
    const items = await provider.festivals({
      lat: 35.1796,
      lng: 129.0756,
      radiusMeters: 1000,
      upcomingWithinDays: 36500,
    });

    expect(items).toHaveLength(1);
    expect(items[0].sourceUrl).toBe("https://www.hibimf.org");
  });

  it("returns null sourceUrl for free-text homepage with no URL-shaped token", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/searchFestival2")) {
        return Promise.resolve(
          tourResponse({
            contentid: "detail-3",
            title: "No Homepage Festival",
            addr1: "Daegu",
            eventstartdate: "20990801",
            eventenddate: "20990805",
            mapx: "128.6014",
            mapy: "35.8714",
            cat1: "A02",
            cat2: "A0207",
            cat3: "A02070100",
          }),
        );
      }
      if (url.pathname.endsWith("/detailCommon2")) {
        return Promise.resolve(
          tourResponse({
            contentid: "detail-3",
            homepage: "홈페이지 없음",
          }),
        );
      }
      return Promise.resolve(tourResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new TourApiFestivalProvider(
      "test-key",
      "https://apis.data.go.kr",
      1,
    );
    const items = await provider.festivals({
      lat: 35.8714,
      lng: 128.6014,
      radiusMeters: 1000,
      upcomingWithinDays: 36500,
    });

    expect(items).toHaveLength(1);
    expect(items[0].sourceUrl).toBeNull();
  });

  it("returns an empty list when provider fetch is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        Object.assign(new Error("aborted"), { name: "AbortError" })
      )
    );

    const provider = new TourApiKeywordFestivalProvider(
      "test-key",
      "https://apis.data.go.kr",
      1
    );
    const items = await provider.festivals({
      lat: 37.7519,
      lng: 128.8761,
      radiusMeters: 1000,
      upcomingWithinDays: 36500,
      signal: controller.signal
    });

    expect(items).toEqual([]);
  });
});

function tourResponse(item: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      response: {
        header: { resultCode: "0000" },
        body: {
          totalCount: 1,
          items: { item }
        }
      }
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
