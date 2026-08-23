import { afterEach, describe, expect, it, vi } from "vitest";
import { runFeeBackfill } from "../src/feeBackfill.js";

interface FakeStatement {
  sql: string;
  args: unknown[];
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
          results: sql.includes("FROM discovery_items") ? rows : []
        })
      })
    }),
    batch
  } as unknown as D1Database;
  return { db, batch };
}

const env = {
  KOPIS_API_KEY: "test-kopis",
  KOPIS_BASE_URL: "https://kopis.example"
};

function kopisDetail(fields: Record<string, string>): Response {
  const body = Object.entries(fields)
    .map(([key, value]) => `<${key}>${value}</${key}>`)
    .join("");
  return new Response(`<dbs><db>${body}</db></dbs>`, {
    headers: { "content-type": "application/xml" }
  });
}

function updateStatements(batch: ReturnType<typeof vi.fn>): FakeStatement[] {
  return batch.mock.calls.flatMap((args) => args[0] as FakeStatement[]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runFeeBackfill", () => {
  it("pulls the fee and the program info out of a single KOPIS detail fetch", async () => {
    const fetchMock = vi.fn(async () =>
      kopisDetail({
        pcseguidance: "전석 5,000원",
        prfcast: "아이유, 박효신",
        prfcrew: "연출 홍길동",
        dtguidance: "토요일 15:00"
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { db, batch } = fakeDb([
      { id: "row-1", source: "kopis", source_item_id: "kopis:PF12345" }
    ]);

    const result = await runFeeBackfill(db, env, { maxItems: 5 });

    // detail 응답 한 번에서 요금과 프로그램을 모두 뽑는다.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ scanned: 1, filled: 1, programFilled: 1, empty: 0 });

    const statement = updateStatements(batch)[0];
    expect(statement.sql).toContain("lowest_price_text = ?");
    expect(statement.sql).toContain("$.programInfo");
    expect(statement.sql).toContain("program_checked_at = ?");
    expect(statement.args).toContain("전석 5,000원");
    expect(statement.args).toContain("공연시간: 토요일 15:00\n출연: 아이유, 박효신\n제작진: 연출 홍길동");
  });

  it("writes the program info alone when the detail has no fee text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => kopisDetail({ prfcast: "아이유" })));

    const { db, batch } = fakeDb([
      { id: "row-2", source: "kopis", source_item_id: "kopis:PF67890" }
    ]);

    const result = await runFeeBackfill(db, env, { maxItems: 5 });

    expect(result).toMatchObject({ scanned: 1, filled: 0, programFilled: 1, empty: 0 });

    const statement = updateStatements(batch)[0];
    expect(statement.sql).not.toContain("lowest_price_text");
    expect(statement.sql).toContain("$.programInfo");
    expect(statement.args).toContain("출연: 아이유");
  });

  it("stamps both checked_at columns when the detail has neither value", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => kopisDetail({ prfnm: "제목만 있는 공연" })));

    const { db, batch } = fakeDb([
      { id: "row-3", source: "kopis", source_item_id: "kopis:PF00000" }
    ]);

    const result = await runFeeBackfill(db, env, { maxItems: 5 });

    expect(result).toMatchObject({ scanned: 1, filled: 0, programFilled: 0, empty: 1 });

    const statement = updateStatements(batch)[0];
    expect(statement.sql).not.toContain("json_set");
    expect(statement.sql).toContain("fee_checked_at = ?");
    expect(statement.sql).toContain("program_checked_at = ?");
  });

  it("leaves both columns unstamped when the fetch fails temporarily", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 429 }))
    );

    const { db, batch } = fakeDb([
      { id: "row-4", source: "kopis", source_item_id: "kopis:PF11111" }
    ]);

    const result = await runFeeBackfill(db, env, { maxItems: 5 });

    expect(result).toMatchObject({ scanned: 1, failed: 1, filled: 0, programFilled: 0 });
    expect(updateStatements(batch)).toHaveLength(0);
  });
});
