import { describe, expect, it } from "vitest";
import { queryPerformancesFromCache } from "../src/discoveryCache.js";
import { queryLocalEvents } from "../src/localEvents.js";

interface FakeCall {
  sql: string;
  args: unknown[];
}

// D1을 흉내내되, 테스트가 검증하는 두 가지만 구현한다: 바인딩된 SQL을 기록하고,
// LIMIT(마지막 바인딩)만큼만 돌려준다. 정렬은 rows를 이미 정렬된 순서로 넘겨 표현한다.
function fakeDb(rows: Record<string, unknown>[], calls: FakeCall[]) {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args });
          const limit = args[args.length - 1];
          const limited =
            typeof limit === "number" ? rows.slice(0, limit) : rows;
          return {
            async all() {
              return { results: limited };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function discoveryRow(overrides: Record<string, unknown>) {
  return {
    id: "festival:x",
    type: "festival",
    source: "tourapi",
    source_item_id: "x",
    title: "제목",
    subtitle: null,
    category_text: null,
    start_date: "2026-08-01",
    end_date: "2026-12-31",
    status: "ongoing",
    is_free: null,
    venue_name: null,
    address: "서울",
    lat: 37.5512,
    lng: 126.9882,
    rating: null,
    review_count: null,
    lowest_price_text: null,
    lowest_price_platform: null,
    source_url: null,
    image_url: null,
    images_json: null,
    tags_json: null,
    amenities_json: null,
    offers_json: null,
    raw_payload: null,
    data_updated_at: null,
    primary_category: null,
    category_tags_json: null,
    ...overrides,
  };
}

describe("queryPerformancesFromCache", () => {
  const options = { radiusMeters: 50000, upcomingWithinDays: 365 };

  it("returns kopis rows as events even though they are stored as type='festival'", async () => {
    const calls: FakeCall[] = [];
    const db = fakeDb(
      [
        discoveryRow({
          source: "kopis",
          source_item_id: "PF1",
          title: "피아노 리사이틀",
          category_text: "공연",
          is_free: 0,
        }),
        discoveryRow({ source: "tourapi", source_item_id: "F1" }),
      ],
      calls,
    );

    const result = await queryPerformancesFromCache(
      db,
      37.5512,
      126.9882,
      options,
    );

    expect(result.events.map((e) => e.id)).toEqual(["PF1"]);
    // discovery_items에 type='event' 행은 존재하지 않으므로 festival만 조회해야 한다.
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toBe("festival");
  });

  it("does not repeat an event source row in the festivals array", async () => {
    const calls: FakeCall[] = [];
    const db = fakeDb(
      [
        discoveryRow({
          source: "kopis",
          source_item_id: "PF2",
          primary_category: "music_performance",
        }),
      ],
      calls,
    );

    const result = await queryPerformancesFromCache(
      db,
      37.5512,
      126.9882,
      options,
    );

    expect(result.events.map((e) => e.id)).toEqual(["PF2"]);
    expect(result.festivals).toEqual([]);
  });

  it("orders the bbox scan by distance so the LIMIT keeps the nearest rows", async () => {
    const calls: FakeCall[] = [];
    const db = fakeDb([discoveryRow({})], calls);

    await queryPerformancesFromCache(db, 37.5512, 126.9882, options);

    expect(calls[0].sql).toContain("ORDER BY");
    expect(calls[0].sql.indexOf("ORDER BY")).toBeLessThan(
      calls[0].sql.indexOf("LIMIT"),
    );
  });
});

function localEventRow(overrides: Record<string, unknown>) {
  return {
    id: "le-1",
    title: "아메리카노 1+1",
    description: null,
    short_description: null,
    benefit: null,
    event_type: "discount",
    status: "approved",
    source: "naver_blog",
    source_url: null,
    source_item_id: null,
    image_url: null,
    store_name: "테스트 카페",
    address: "서울",
    lat: 37.5665,
    lng: 126.978,
    start_date: "2026-08-01",
    end_date: "2026-12-31",
    confidence_score: null,
    needs_review: 0,
    is_sponsored: 0,
    sponsor_tier: null,
    paid_until: null,
    priority_score: 0,
    updated_at: "2026-08-01T00:00:00.000Z",
    primary_category: null,
    category_tags_json: null,
    ...overrides,
  };
}

describe("queryLocalEvents", () => {
  it("bounds the scan with ORDER BY + LIMIT instead of loading the whole bbox", async () => {
    const calls: FakeCall[] = [];
    const rows = Array.from({ length: 500 }, (_, index) =>
      localEventRow({ id: `le-${index}` }),
    );
    const db = fakeDb(rows, calls);

    await queryLocalEvents(db, {
      lat: 37.5665,
      lng: 126.978,
      radiusMeters: 5000,
      limit: 20,
    });

    expect(calls[0].sql).toContain("ORDER BY");
    expect(calls[0].sql).toContain("LIMIT ?");
    // offset(0) + limit(20) + 여유분만 읽는다.
    expect(calls[0].args[calls[0].args.length - 1]).toBe(220);
  });

  it("pages through results without dropping or repeating an item", async () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      localEventRow({ id: `le-${index}` }),
    );
    const query = {
      lat: 37.5665,
      lng: 126.978,
      radiusMeters: 5000,
      limit: 2,
    };

    const first = await queryLocalEvents(fakeDb(rows, []), query);
    expect(first.items.map((item) => item.id)).toEqual(["le-0", "le-1"]);
    expect(first.nextCursor).toBe("2");

    const second = await queryLocalEvents(fakeDb(rows, []), {
      ...query,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((item) => item.id)).toEqual(["le-2", "le-3"]);

    const third = await queryLocalEvents(fakeDb(rows, []), {
      ...query,
      cursor: second.nextCursor!,
    });
    expect(third.items.map((item) => item.id)).toEqual(["le-4"]);
    expect(third.nextCursor).toBeNull();
  });
});
