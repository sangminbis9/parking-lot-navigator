import { afterEach, describe, expect, it, vi } from "vitest";
import { runGeocodeBackfill } from "../src/geocodeBackfill.js";
import { CITY_FESTIVAL_SITES } from "../src/cityFestivalSites.js";
import type { Env } from "../src/index.js";

interface FakeStatement {
  sql: string;
  args: unknown[];
}

// flush()가 geocode_cache 배치를 먼저 쓰므로, city_festivals 배치를 골라낸다.
function cityFestivalStatements(batch: ReturnType<typeof vi.fn>): FakeStatement[] {
  const call = batch.mock.calls.find((args) =>
    (args[0] as FakeStatement[]).every((statement) => statement.sql.includes("city_festivals"))
  );
  return (call?.[0] as FakeStatement[]) ?? [];
}

function fakeDb(rows: unknown[]): {
  db: D1Database;
  batch: ReturnType<typeof vi.fn>;
} {
  const batch = vi.fn(async () => []);
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        sql,
        args,
        all: async () => ({
          results: sql.includes("FROM city_festivals") ? rows : []
        })
      })
    }),
    batch
  } as unknown as D1Database;
  return { db, batch };
}

function fakeEnv(): Env {
  return {
    KAKAO_REST_API_KEY: "test-kakao",
    KAKAO_LOCAL_BASE_URL: "https://dapi.kakao.com",
    PARKING_PROVIDER_MODE: "real"
  } as Env;
}

const site = CITY_FESTIVAL_SITES[0];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runGeocodeBackfill", () => {
  it("re-geocodes rows stuck on the site fallback and leaves precise rows alone", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        documents: [{ place_name: "중앙광장", x: "127.1", y: "37.6" }]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { db, batch } = fakeDb([
      {
        id: "stuck",
        site_id: site.siteId,
        title: "가짜 축제",
        venue: "중앙광장 일원",
        address: null,
        lat: site.fallbackLat,
        lng: site.fallbackLng
      },
      {
        id: "precise",
        site_id: site.siteId,
        title: "이미 좌표 있는 축제",
        venue: "다른 장소",
        address: null,
        lat: site.fallbackLat + 0.05,
        lng: site.fallbackLng + 0.05
      }
    ]);

    const result = await runGeocodeBackfill(db, fakeEnv(), { maxLookups: 5 });

    expect(result).toMatchObject({
      scanned: 1,
      updated: 1,
      unresolved: 0,
      skippedAlreadyPrecise: 1,
      budgetExhausted: false
    });

    const statements = cityFestivalStatements(batch);
    const update = statements.find((statement) => statement.args.includes("stuck"));
    expect(update?.sql).toContain("SET lat = ?, lng = ?");
    expect(update?.args.slice(0, 2)).toEqual([37.6, 127.1]);
    // 이미 정확한 행은 조회 없이 checked 표시만 한다.
    const marked = statements.find((statement) => statement.args.includes("precise"));
    expect(marked?.sql).toContain("SET geocode_checked_at = ?");
  });

  it("does not mark rows checked when the lookup budget runs out", async () => {
    const fetchMock = vi.fn(async () => Response.json({ documents: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const rows = Array.from({ length: 3 }, (_, index) => ({
      id: `row-${index}`,
      site_id: site.siteId,
      title: `축제 ${index}`,
      venue: `장소 ${index}`,
      address: null,
      lat: site.fallbackLat,
      lng: site.fallbackLng
    }));
    const { db, batch } = fakeDb(rows);

    const result = await runGeocodeBackfill(db, fakeEnv(), { maxLookups: 1 });

    expect(result.budgetExhausted).toBe(true);
    expect(result.scanned).toBe(1);
    const statements = cityFestivalStatements(batch);
    expect(statements).toHaveLength(1);
    expect(statements[0].args).toContain("row-0");
  });
});
