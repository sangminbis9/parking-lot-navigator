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
          // backlog 집계 쿼리는 SUM(...)만 고르므로 대상 목록을 돌려주면 안 된다.
          results: sql.includes("SUM(") ? [] : rows
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

// 종료일이 오늘보다 뒤여야 대상 필터를 통과한 셈이 된다(테스트 fakeDb는 필터를
// 실행하지 않으므로, 상태 판정에 쓰이는 날짜만 현실적으로 맞춰 준다).
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    source: "kopis",
    source_item_id: "kopis:PF12345",
    start_date: "2099-01-01",
    end_date: "2099-01-02",
    fee_filled_at: null,
    program_filled_at: null,
    detail_attempts: 0,
    ...overrides
  };
}

function kopisDetail(fields: Record<string, string>): Response {
  const body = Object.entries(fields)
    .map(([key, value]) => `<${key}>${value}</${key}>`)
    .join("");
  return new Response(`<dbs><db>${body}</db></dbs>`, {
    headers: { "content-type": "application/xml" }
  });
}

// 선점 UPDATE는 fetch 전에 나가므로 결과 반영 statement와 섞이지 않게 갈라낸다.
function claimStatements(batch: ReturnType<typeof vi.fn>): FakeStatement[] {
  return allStatements(batch).filter((statement) =>
    statement.sql.includes("detail_attempts = detail_attempts + 1")
  );
}

function updateStatements(batch: ReturnType<typeof vi.fn>): FakeStatement[] {
  return allStatements(batch).filter(
    (statement) => !statement.sql.includes("detail_attempts = detail_attempts + 1")
  );
}

function allStatements(batch: ReturnType<typeof vi.fn>): FakeStatement[] {
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

    const { db, batch } = fakeDb([row()]);
    const result = await runFeeBackfill(db, env, { maxItems: 5 });

    // detail 응답 한 번에서 요금과 프로그램을 모두 뽑는다.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      scanned: 1,
      detailFetched: 1,
      feeFilled: 1,
      programFilled: 1
    });

    const statement = updateStatements(batch)[0];
    expect(statement.sql).toContain("lowest_price_text = ?");
    expect(statement.sql).toContain("fee_filled_at = ?");
    expect(statement.sql).toContain("program_filled_at = ?");
    expect(statement.sql).toContain("$.programInfo");
    expect(statement.sql).toContain("detail_state = 'done'");
    expect(statement.args).toContain("전석 5,000원");
    // 초청 가수·출연진과 제작진이 원문 그대로 보존된다.
    expect(statement.args).toContain(
      "공연시간: 토요일 15:00\n출연: 아이유, 박효신\n제작진: 연출 홍길동"
    );
  });

  it("claims every target before fetching so a killed invocation cannot starve the queue", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => kopisDetail({ prfcast: "아이유" })));

    const { db, batch } = fakeDb([row({ id: "row-a" }), row({ id: "row-b" })]);
    await runFeeBackfill(db, env, { maxItems: 5 });

    const claims = claimStatements(batch);
    expect(claims).toHaveLength(2);
    expect(claims[0].sql).toContain("detail_retry_after = ?");
  });

  it("writes the program info alone when the detail has no fee text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => kopisDetail({ prfcast: "아이유" })));

    const { db, batch } = fakeDb([row()]);
    const result = await runFeeBackfill(db, env, { maxItems: 5 });

    expect(result).toMatchObject({
      feeFilled: 0,
      feeEmptyPending: 1,
      programFilled: 1
    });

    const statement = updateStatements(batch)[0];
    expect(statement.sql).not.toContain("lowest_price_text");
    expect(statement.sql).toContain("program_filled_at = ?");
    expect(statement.sql).toContain("$.programInfo");
    // 요금이 아직 없으니 확정하지 않고 다시 볼 시각을 남긴다.
    expect(statement.sql).toContain("detail_state = 'empty'");
    expect(statement.args).toContain("출연: 아이유");
  });

  it("does not re-query the fee for a row that already has one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => kopisDetail({ pcseguidance: "전석 9,000원", prfcast: "아이유" }))
    );

    const { db, batch } = fakeDb([row({ fee_filled_at: "2026-08-01T00:00:00.000Z" })]);
    const result = await runFeeBackfill(db, env, { maxItems: 5 });

    expect(result).toMatchObject({
      feeAlreadyComplete: 1,
      feeFilled: 0,
      programFilled: 1
    });

    const statement = updateStatements(batch)[0];
    expect(statement.sql).not.toContain("lowest_price_text");
    expect(statement.args).not.toContain("전석 9,000원");
  });

  it("does not re-query the program info for a row that already has one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => kopisDetail({ pcseguidance: "전석 9,000원", prfcast: "아이유" }))
    );

    const { db, batch } = fakeDb([row({ program_filled_at: "2026-08-01T00:00:00.000Z" })]);
    const result = await runFeeBackfill(db, env, { maxItems: 5 });

    expect(result).toMatchObject({
      programAlreadyComplete: 1,
      programFilled: 0,
      feeFilled: 1
    });

    const statement = updateStatements(batch)[0];
    expect(statement.sql).not.toContain("$.programInfo");
    expect(statement.sql).toContain("detail_state = 'done'");
  });

  it("schedules another look at a future event whose detail has neither value yet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => kopisDetail({ prfnm: "제목만 있는 공연" })));

    const { db, batch } = fakeDb([row()]);
    const result = await runFeeBackfill(db, env, { maxItems: 5 });

    expect(result).toMatchObject({
      feeEmptyPending: 1,
      programEmptyPending: 1,
      permanentNoData: 0
    });

    const statement = updateStatements(batch)[0];
    expect(statement.sql).not.toContain("json_set");
    expect(statement.sql).toContain("detail_state = 'empty'");
    expect(statement.sql).toContain("detail_retry_after = ?");
    // pipelineStats가 읽는 "마지막 시도 시각"은 계속 남긴다.
    expect(statement.sql).toContain("fee_checked_at = ?");
    expect(statement.sql).toContain("program_checked_at = ?");
  });

  it("stops looking at an event that ended without ever publishing the details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => kopisDetail({ prfnm: "끝난 공연" })));

    const { db, batch } = fakeDb([
      row({ start_date: "2020-01-01", end_date: "2020-01-02" })
    ]);
    const result = await runFeeBackfill(db, env, { maxItems: 5 });

    expect(result).toMatchObject({ permanentNoData: 1 });
    const statement = updateStatements(batch)[0];
    expect(statement.sql).toContain("detail_state = 'nodata'");
    expect(statement.sql).toContain("detail_retry_after = NULL");
  });

  it("treats a 429 as temporary: retry later, never terminal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));

    const { db, batch } = fakeDb([row()]);
    const result = await runFeeBackfill(db, env, { maxItems: 5 });

    expect(result).toMatchObject({
      transientFailed: 1,
      permanentNoData: 0,
      feeFilled: 0,
      programFilled: 0
    });

    const statement = updateStatements(batch)[0];
    expect(statement.sql).toContain("detail_retry_after = ?");
    expect(statement.sql).not.toContain("detail_state");
    expect(statement.sql).not.toContain("fee_checked_at");
  });

  it("treats a permanent 400 as no-data so the budget is not burned forever", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 400 })));

    const { db, batch } = fakeDb([row()]);
    const result = await runFeeBackfill(db, env, { maxItems: 5 });

    expect(result).toMatchObject({ permanentNoData: 1, transientFailed: 0 });
    expect(updateStatements(batch)[0].sql).toContain("detail_state = 'nodata'");
  });

  it("pulls the TourAPI fee, playtime, program and subevent out of one detailIntro2 fetch", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            response: {
              body: {
                items: {
                  item: [
                    {
                      contentid: "1100492",
                      usetimefestival: "성인 10,000원 / 청소년 5,000원",
                      playtime: "10:00~18:00",
                      program: "개막식, 축하공연",
                      subevent: "불꽃놀이"
                    }
                  ]
                }
              }
            }
          }),
          { headers: { "content-type": "application/json" } }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { db, batch } = fakeDb([
      row({ source: "tourapi", source_item_id: "tourapi:1100492" })
    ]);
    const result = await runFeeBackfill(
      db,
      {
        PUBLIC_DATA_SERVICE_KEY: "test-tour",
        PUBLIC_DATA_BASE_URL: "https://apis.example"
      },
      { maxItems: 5 }
    );

    // detailIntro2 한 번을 introItemCache로 나눠 쓰므로 fetch는 1건이다.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      detailFetched: 1,
      feeFilled: 1,
      programFilled: 1
    });

    const statement = updateStatements(batch)[0];
    expect(statement.args).toContain("성인 10,000원 / 청소년 5,000원");
    expect(statement.args).toContain(
      "공연시간: 10:00~18:00\n프로그램: 개막식, 축하공연\n부대행사: 불꽃놀이"
    );
  });

  it("explains an empty run instead of staying silent", async () => {
    const { db } = fakeDb([]);
    const empty = await runFeeBackfill(db, env, { maxItems: 5 });
    expect(empty).toMatchObject({ scanned: 0, reason: "no_pending_rows" });

    const { db: db2 } = fakeDb([row()]);
    const noCredentials = await runFeeBackfill(db2, {}, { maxItems: 5 });
    expect(noCredentials).toMatchObject({ scanned: 0, reason: "no_credentials" });
  });
});
