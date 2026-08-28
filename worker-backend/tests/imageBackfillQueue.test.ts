import { afterEach, describe, expect, it, vi } from "vitest";
import { runImageBackfill } from "../src/imageBackfill.js";

interface FakeCall {
  sql: string;
  args: unknown[];
}

// 사진 backfill의 대상 선택은 "아직 조회하지 않은 행"과 "다시 볼 행" 두 큐로
// 나뉜다. fakeDb는 두 큐를 SQL 모양으로 구분해 각각 다른 행을 돌려주고, 어떤
// 쿼리가 어떤 인자로 나갔는지 기록한다.
function fakeDb(
  first: Record<string, unknown>[],
  recheck: Record<string, unknown>[],
  calls: FakeCall[],
) {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args });
          return {
            async all() {
              if (!sql.includes("FROM discovery_items")) return { results: [] };
              const limit = args[args.length - 1] as number;
              const rows = sql.includes("images_checked_at IS NULL")
                ? first
                : recheck;
              return { results: rows.slice(0, limit) };
            },
            async run() {
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    async batch() {
      return [];
    },
  } as unknown as D1Database;
}

function row(id: string) {
  return {
    id,
    source: "kopis",
    source_item_id: `PF${id}`,
    image_url: null,
    images_json: null,
  };
}

function rows(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => row(`${prefix}${index}`));
}

// KOPIS detail이 사진 없이 돌아온 경우. 대상이 몇 건 잡혔는지만 보면 되므로
// 실제 사진 파싱까지 갈 필요가 없다.
function emptyDetail(): Response {
  return new Response(`<dbs><db><prfnm>공연</prfnm></db></dbs>`, {
    headers: { "content-type": "application/xml" },
  });
}

const env = { KOPIS_API_KEY: "test-kopis", KOPIS_BASE_URL: "https://kopis.example" };

function selectCalls(calls: FakeCall[]): FakeCall[] {
  return calls.filter((call) => call.sql.includes("FROM discovery_items"));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runImageBackfill 대상 선택", () => {
  it("아직 조회하지 않은 행으로 예산을 먼저 채운다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => emptyDetail()));
    const calls: FakeCall[] = [];
    const db = fakeDb(rows("new-", 10), rows("old-", 10), calls);

    const result = await runImageBackfill(db, env, { maxItems: 4 });

    const selects = selectCalls(calls);
    // 첫 큐가 예산을 다 쓰면 재조회 큐는 아예 조회하지 않는다.
    expect(selects).toHaveLength(1);
    expect(selects[0].sql).toContain("images_checked_at IS NULL");
    expect(selects[0].args[selects[0].args.length - 1]).toBe(4);
    expect(result.scanned).toBe(4);
  });

  it("첫 큐가 예산을 다 못 채울 때만 재조회 큐를 남은 만큼 본다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => emptyDetail()));
    const calls: FakeCall[] = [];
    const db = fakeDb(rows("new-", 2), rows("old-", 10), calls);

    const result = await runImageBackfill(db, env, { maxItems: 5 });

    const selects = selectCalls(calls);
    expect(selects).toHaveLength(2);
    expect(selects[1].sql).toContain("images_checked_at < ?");
    // 남은 예산(5 - 2)만 요청한다.
    expect(selects[1].args[selects[1].args.length - 1]).toBe(3);
    expect(result.scanned).toBe(5);
  });

  it("두 큐를 합쳐도 maxItems를 넘지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => emptyDetail()));
    const calls: FakeCall[] = [];
    const db = fakeDb(rows("new-", 3), rows("old-", 50), calls);

    const result = await runImageBackfill(db, env, { maxItems: 6 });

    expect(result.scanned).toBe(6);
    // subrequest 예산이 상한이므로 외부 호출도 같은 수를 넘으면 안 된다.
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls)
      .toHaveLength(6);
  });

  it("첫 큐가 비어도 재조회 큐로 회차를 채운다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => emptyDetail()));
    const calls: FakeCall[] = [];
    const db = fakeDb([], rows("old-", 3), calls);

    const result = await runImageBackfill(db, env, { maxItems: 10 });

    const selects = selectCalls(calls);
    expect(selects).toHaveLength(2);
    expect(selects[1].args[selects[1].args.length - 1]).toBe(10);
    expect(result.scanned).toBe(3);
  });

  it("재조회 큐는 인덱스로 좁힌 뒤에 JSON 조건을 본다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => emptyDetail()));
    const calls: FakeCall[] = [];
    const db = fakeDb([], rows("old-", 1), calls);

    await runImageBackfill(db, env, { maxItems: 2 });

    const recheck = selectCalls(calls)[1].sql;
    // source·images_checked_at 조건이 json_valid()보다 앞에 있어야 B-tree가
    // 후보를 먼저 좁힌다. 두 큐가 겹치지 않도록 IS NULL이 섞여서도 안 된다.
    expect(recheck.indexOf("source IN")).toBeLessThan(recheck.indexOf("json_valid"));
    expect(recheck.indexOf("images_checked_at < ?")).toBeLessThan(
      recheck.indexOf("json_valid"),
    );
    expect(recheck).not.toContain("images_checked_at IS NULL");
  });
});
