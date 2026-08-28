import { afterEach, describe, expect, it, vi } from "vitest";
import { SeoulCultureEventProvider } from "../src/features/discover/events/SeoulCultureEventProvider.js";
import type { DiscoverQuery } from "../src/features/discover/common/discoverProvider.js";

describe("SeoulCultureEventProvider sourceUrl normalization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("trims a leading-whitespace ORG_LINK so it still passes the http% filter", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(culturalEventResponse({
      ORG_LINK: " https://vo.la/OJAS7oW",
    })));

    const provider = new SeoulCultureEventProvider("test-key", "https://example.com");
    const items = await provider.events(testQuery());

    expect(items).toHaveLength(1);
    expect(items[0].sourceUrl).toBe("https://vo.la/OJAS7oW");
  });

  it("adds https:// to a scheme-less ORG_LINK domain", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(culturalEventResponse({
      ORG_LINK: "www.example.go.kr",
    })));

    const provider = new SeoulCultureEventProvider("test-key", "https://example.com");
    const items = await provider.events(testQuery());

    expect(items).toHaveLength(1);
    expect(items[0].sourceUrl).toBe("https://www.example.go.kr");
  });

  it("keeps the cast, program, and running time the list response already carries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(culturalEventResponse({
      PRO_TIME: "19:00~21:00",
      PLAYER: "아이유, ○○밴드",
      PROGRAM: "개막식, 축하공연",
      USE_TRGT: "전체 관람가",
    })));

    const provider = new SeoulCultureEventProvider("test-key", "https://example.com");
    const items = await provider.events(testQuery());

    expect(items[0].programInfo).toBe(
      "공연시간: 19:00~21:00\n출연: 아이유, ○○밴드\n프로그램: 개막식, 축하공연\n관람대상: 전체 관람가",
    );
  });

  it("falls back to IS_FREE when USE_FEE is blank", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(culturalEventResponse({
      USE_FEE: "",
      IS_FREE: "무료",
    })));

    const provider = new SeoulCultureEventProvider("test-key", "https://example.com");
    const items = await provider.events(testQuery());

    expect(items[0].price).toBe("무료");
    expect(items[0].isFree).toBe(true);
  });

  it("leaves programInfo null when the row carries none of those fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(culturalEventResponse({})));

    const provider = new SeoulCultureEventProvider("test-key", "https://example.com");
    const items = await provider.events(testQuery());

    expect(items[0].programInfo).toBeNull();
  });

  it("returns null sourceUrl when ORG_LINK is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(culturalEventResponse({
      ORG_LINK: undefined,
    })));

    const provider = new SeoulCultureEventProvider("test-key", "https://example.com");
    const items = await provider.events(testQuery());

    expect(items).toHaveLength(1);
    expect(items[0].sourceUrl).toBeNull();
  });
});

function testQuery(): DiscoverQuery {
  return {
    lat: 37.5665,
    lng: 126.978,
    radiusMeters: 5000,
    upcomingWithinDays: 36500,
  };
}

function culturalEventResponse(overrides: Record<string, string | undefined>): Response {
  return new Response(
    JSON.stringify({
      culturalEventInfo: {
        list_total_count: 1,
        RESULT: { CODE: "INFO-000", MESSAGE: "OK" },
        row: [
          {
            CODENAME: "축제",
            TITLE: "Seoul Test Event",
            DATE: "2099-05-01 ~ 2099-05-03",
            PLACE: "Seoul Plaza",
            ORG_NAME: "Seoul Org",
            USE_FEE: "무료",
            MAIN_IMG: "https://example.com/img.jpg",
            GUNAME: "중구",
            LOT: "126.978",
            LAT: "37.5665",
            RGSTDATE: "2026-01-01",
            ...overrides,
          },
        ],
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
