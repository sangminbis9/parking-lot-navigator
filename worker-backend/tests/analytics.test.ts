import { describe, expect, it } from "vitest";
import {
  analyticsBatchSchema,
  pruneOldAnalytics,
  queryLocalEventViews,
  recordAnalytics,
} from "../src/analytics.js";

interface Stmt {
  sql: string;
  args: unknown[];
}

/// 발행된 문장을 세기만 하는 최소 D1 흉내. analytics는 쓰기 건수가 곧 예산이라
/// "몇 문장이 나갔는가"가 검증 대상이다.
function fakeDb(rows: Record<string, unknown>[] = []) {
  const statements: Stmt[] = [];
  const db = {
    statements,
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => {
          const stmt: Stmt = { sql, args };
          return {
            ...stmt,
            run: async () => {
              statements.push(stmt);
              return { meta: { changes: 1 } };
            },
            all: async () => {
              statements.push(stmt);
              return { results: rows };
            },
          };
        },
      };
    },
    async batch(list: Stmt[]) {
      for (const stmt of list) statements.push(stmt);
      return list.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return db as unknown as D1Database & { statements: Stmt[] };
}

describe("recordAnalytics", () => {
  it("허용 목록에 없는 이벤트와 라벨은 버린다", async () => {
    const db = fakeDb();
    const accepted = await recordAnalytics(
      db,
      analyticsBatchSchema.parse({
        events: [
          { name: "app_open", count: 3 },
          { name: "search_keyword", label: "홍대 맛집", count: 1 },
          { name: "event_detail_open", label: "37.5,127.0", count: 2 },
          { name: "event_detail_open", label: "festival", count: 2 },
        ],
      }),
    );
    expect(accepted).toBe(2);
    expect(db.statements).toHaveLength(2);
    const labels = db.statements.map((s) => `${s.args[1]}/${s.args[2]}`);
    expect(labels).toEqual(["app_open/", "event_detail_open/festival"]);
  });

  it("같은 조합은 한 문장으로 합쳐 쓴다", async () => {
    const db = fakeDb();
    await recordAnalytics(
      db,
      analyticsBatchSchema.parse({
        events: [
          { name: "map_loaded", count: 4 },
          { name: "map_loaded", count: 6 },
        ],
      }),
    );
    expect(db.statements).toHaveLength(1);
    expect(db.statements[0]!.args[3]).toBe(10);
  });

  it("날짜 버킷은 KST 기준이다", async () => {
    const db = fakeDb();
    // 2026-08-29T15:30Z = KST 2026-08-30 00:30
    await recordAnalytics(
      db,
      analyticsBatchSchema.parse({ events: [{ name: "app_open", count: 1 }] }),
      new Date("2026-08-29T15:30:00Z"),
    );
    expect(db.statements[0]!.args[0]).toBe("2026-08-30");
  });

  it("남는 항목이 없으면 아무 문장도 발행하지 않는다", async () => {
    const db = fakeDb();
    const accepted = await recordAnalytics(
      db,
      analyticsBatchSchema.parse({
        events: [{ name: "unknown_event", count: 5 }],
      }),
    );
    expect(accepted).toBe(0);
    expect(db.statements).toHaveLength(0);
  });

  it("좌표나 검색어가 들어갈 자리가 없다", () => {
    // 스키마가 받는 필드는 name/label/count 셋뿐이고, label은 허용 목록으로 막힌다.
    const parsed = analyticsBatchSchema.parse({
      events: [{ name: "app_open", count: 1, lat: 37.5, lng: 127.0 }],
    });
    expect(Object.keys(parsed.events[0]!)).toEqual(["name", "count"]);
  });
});

describe("local_event_view", () => {
  const known = "11111111-2222-4333-8444-555555555555";
  const unknown = "99999999-2222-4333-8444-555555555555";

  it("사장님 이벤트 id만 남기고 형식이 틀린 라벨은 조회 전에 버린다", async () => {
    const db = fakeDb([{ id: known }]);
    const accepted = await recordAnalytics(
      db,
      analyticsBatchSchema.parse({
        events: [
          { name: "local_event_view", label: known, count: 1 },
          { name: "local_event_view", label: unknown, count: 1 },
          { name: "local_event_view", label: "홍대 맛집", count: 1 },
          { name: "local_event_view", count: 1 },
        ],
      }),
    );
    expect(accepted).toBe(1);
    expect(db.statements[0]!.sql).toContain("merchant_id IS NOT NULL");
    expect(db.statements[0]!.args).toEqual([known, unknown]);
    expect(db.statements[1]!.args.slice(1, 4)).toEqual(["local_event_view", known, 1]);
  });

  it("조회 이벤트가 없으면 local_events를 읽지 않는다", async () => {
    const db = fakeDb();
    await recordAnalytics(
      db,
      analyticsBatchSchema.parse({ events: [{ name: "app_open", count: 1 }] }),
    );
    expect(db.statements).toHaveLength(1);
  });

  it("이벤트 id별 합계를 돌려준다", async () => {
    const db = fakeDb([{ label: known, total: 7 }]);
    const views = await queryLocalEventViews(db, [known, unknown]);
    expect(views.get(known)).toBe(7);
    expect(views.get(unknown)).toBeUndefined();
    expect(await queryLocalEventViews(fakeDb(), [])).toEqual(new Map());
  });
});

describe("pruneOldAnalytics", () => {
  it("보관 기간보다 오래된 날짜만 지운다", async () => {
    const db = fakeDb();
    await pruneOldAnalytics(db, new Date("2026-08-29T00:00:00Z"));
    expect(db.statements).toHaveLength(1);
    expect(db.statements[0]!.sql).toContain("DELETE FROM analytics_daily");
    expect(db.statements[0]!.args[0]).toBe("2026-03-02");
  });
});
