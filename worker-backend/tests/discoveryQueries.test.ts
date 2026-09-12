import { describe, expect, it } from "vitest";
import { queryPerformancesFromCache, queryFestivalPageFromCache, queryPerformancePageFromCache, queryFestivalsFromCache } from "../src/discoveryCache.js";
import { queryLocalEvents } from "../src/localEvents.js";

interface FakeCall {
  sql: string;
  args: unknown[];
}

// 실제 쿼리의 keyset(id > cursor), ORDER BY id, 페이지 크기를 적용한다.
function fakeDb(rows: Record<string, unknown>[], calls: FakeCall[]) {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args });
          const limit = args[args.length - 1];
          const cursor = args[args.length - 2] as string;
          const sorted = [...rows].sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
          const after = sql.includes("AND id > ?") ? sorted.filter((row) => String(row.id) > cursor) : sorted;
          const limited = typeof limit === "number" ? after.slice(0, limit) : after;
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

  // backfill이 채운 요금·프로그램·출연진이 앱까지 실제로 도달하는지 본다.
  it("carries the backfilled fee and programInfo into the API response", async () => {
    const calls: FakeCall[] = [];
    const db = fakeDb(
      [
        discoveryRow({
          source: "kopis",
          source_item_id: "PF1",
          title: "창작ing",
          lowest_price_text: "전석 20,000원",
          is_free: 0,
          raw_payload: JSON.stringify({
            programInfo: "공연시간: 토요일 15:00\n출연: 아이유",
          }),
        }),
        discoveryRow({
          source: "tourapi",
          source_item_id: "1100492",
          title: "지역 축제",
          primary_category: "music_performance",
          lowest_price_text: "성인 10,000원",
          raw_payload: JSON.stringify({
            programInfo: "공연시간: 10:00~18:00\n부대행사: 불꽃놀이",
          }),
        }),
      ],
      calls,
    );

    const result = await queryPerformancesFromCache(db, 37.5665, 126.978, options);

    const event = result.events[0];
    expect(event.programInfo).toBe("공연시간: 토요일 15:00\n출연: 아이유");
    expect(event.price).toBe("전석 20,000원");

    const festival = result.festivals[0];
    expect(festival.programInfo).toBe("공연시간: 10:00~18:00\n부대행사: 불꽃놀이");
    expect(festival.admissionFee).toBe("성인 10,000원");
  });

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

  it("uses a stable keyset instead of truncating nearest results", async () => {
    const calls: FakeCall[] = [];
    const db = fakeDb([discoveryRow({})], calls);

    await queryPerformancesFromCache(db, 37.5512, 126.9882, options);

    expect(calls[0].sql).toContain("ORDER BY");
    expect(calls[0].sql).toContain("AND id > ?");
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
  it("bounds each scan but follows every page for legacy offset clients", async () => {
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
    expect(calls[0].args[calls[0].args.length - 1]).toBe(256);
    expect(calls).toHaveLength(2);
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

describe("uncapped map discovery", () => {
  const options = { radiusMeters: 50000, upcomingWithinDays: 365 };

  it("returns more than 5000 festivals without losing the tail", async () => {
    const rows = Array.from({ length: 5501 }, (_, i) => discoveryRow({
      id: `festival:${String(i).padStart(5, "0")}`,
      source_item_id: `f-${i}`, title: `고유 축제 ${i}`,
    }));
    const db = fakeDb(rows, []);
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await queryFestivalPageFromCache(db, 37.5512, 126.9882, options, cursor);
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(ids).size).toBe(5501);
    expect(ids).toContain("f-5500");
    const legacy = await queryFestivalsFromCache(db, 37.5512, 126.9882, options);
    expect(legacy).toHaveLength(5501);
  });

  it("continues past an entirely filtered page to a later performance", async () => {
    const rows = Array.from({ length: 256 }, (_, i) => discoveryRow({
      id: `a:${i}`, end_date: "2000-01-01",
    }));
    rows.push(discoveryRow({ id: "z:concert", source: "kopis", source_item_id: "late-concert" }));
    const db = fakeDb(rows, []);
    const first = await queryPerformancePageFromCache(db, 37.5512, 126.9882, options);
    expect(first.events).toEqual([]);
    expect(first.festivals).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    const last = await queryPerformancePageFromCache(db, 37.5512, 126.9882, options, first.nextCursor!);
    expect(last.events.map((e) => e.id)).toEqual(["late-concert"]);
    expect(last.nextCursor).toBeNull();
  });

  it("keeps the cursor when a full local-event page lies outside the circle", async () => {
    const rows = Array.from({ length: 256 }, (_, i) => localEventRow({
      id: `a:${i}`, lat: 37.6065, lng: 127.028,
    }));
    rows.push(localEventRow({ id: "z:inside" }));
    const options = { lat: 37.5665, lng: 126.978, radiusMeters: 5000, limit: 200, paged: true };
    const db = fakeDb(rows, []);
    const first = await queryLocalEvents(db, options);
    expect(first.items).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    const second = await queryLocalEvents(db, { ...options, cursor: first.nextCursor! });
    expect(second.items.map((e) => e.id)).toEqual(["z:inside"]);
    expect(second.nextCursor).toBeNull();
  });
});
