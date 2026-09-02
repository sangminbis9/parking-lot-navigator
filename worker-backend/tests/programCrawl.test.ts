import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractProgramText,
  htmlToText,
  isGrounded,
  programLink,
  runProgramCrawl,
} from "../src/programCrawl.js";

interface FakeStatement {
  sql: string;
  args: unknown[];
}

function fakeDb(rows: unknown[]): {
  db: D1Database;
  written: () => FakeStatement[];
} {
  const batched: FakeStatement[][] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        sql,
        args,
        all: async () => ({
          // backlog 집계는 COUNT(*)만 고르므로 대상 목록을 돌려주면 안 된다.
          results: sql.includes("COUNT(*)") ? [{ backlog: rows.length }] : rows,
        }),
      }),
    }),
    batch: async (statements: FakeStatement[]) => {
      batched.push(statements);
      return [];
    },
  } as unknown as D1Database;
  // 첫 batch는 선점 UPDATE라 결과 반영 statement와 갈라낸다.
  return { db, written: () => batched.slice(1).flat() };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    source: "public-data-culture-festival",
    title: "샘플 축제",
    source_url: "https://festival.example/main",
    start_date: "2099-01-01",
    end_date: "2099-01-05",
    detail_attempts: 0,
    ...overrides,
  };
}

function page(html: string): Response {
  return new Response(html, { headers: { "content-type": "text/html" } });
}

const PROGRAM_PAGE = `
  <html><body>
    <h2>행사 프로그램</h2>
    <ul>
      <li>10:00 개막식 및 축하공연</li>
      <li>13:00 전통연희 마당놀이</li>
      <li>18:00 야간 불꽃놀이</li>
    </ul>
    <p>오시는 길: 시청 앞 광장</p>
  </body></html>
`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("program extraction rules", () => {
  it("takes the lines under a program heading", () => {
    const program = extractProgramText(htmlToText(PROGRAM_PAGE));

    expect(program).toContain("10:00 개막식 및 축하공연");
    expect(program).toContain("18:00 야간 불꽃놀이");
    // 스톱 패턴 이후는 프로그램이 아니다.
    expect(program).not.toContain("오시는 길");
  });

  it("returns null when the heading has no schedule under it", () => {
    const text = htmlToText(
      "<h2>프로그램</h2><div>준비 중입니다</div><p>문의처 02-000-0000</p>",
    );

    expect(extractProgramText(text)).toBeNull();
  });

  it("rejects a navigation menu sitting under a program heading", () => {
    // 2026-09-02 영등포문화재단 행이 이 모양으로 메뉴를 프로그램으로 저장했다.
    const text = htmlToText(`
      <h2>기획공연 프로그램</h2>
      <ul>
        <li>예매안내</li><li>관람안내</li><li>영등포 여의도 봄꽃축제</li>
        <li>문래예술제</li><li>생활문화 포롱</li>
      </ul>
    `);

    expect(extractProgramText(text)).toBeNull();
  });

  it("finds a same-host program link when the landing page has nothing", () => {
    const html = `<a href="/sub/program.do">세부 일정</a><a href="https://other.example/프로그램">외부</a>`;
    const link = programLink(html, new URL("https://festival.example/main"));

    expect(link).toBe("https://festival.example/sub/program.do");
  });
});

describe("llm grounding", () => {
  it("rejects a line that does not appear in the page", () => {
    const source = "10:00 개막식\n13:00 마당놀이";

    expect(isGrounded("10:00 개막식", source)).toBe(true);
    expect(isGrounded("10:00 개막식\n20:00 아이돌 공연", source)).toBe(false);
  });
});

describe("runProgramCrawl", () => {
  it("writes the program into raw_payload and marks the row filled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page(PROGRAM_PAGE)));
    const { db, written } = fakeDb([row()]);

    const result = await runProgramCrawl(db, {}, { now: new Date("2026-09-02T00:00:00Z") });

    expect(result.ruleFilled).toBe(1);
    expect(result.pagesFetched).toBe(1);
    const update = written()[0];
    expect(update.sql).toContain("program_filled_at = ?");
    expect(update.sql).toContain("$.programInfo");
    expect(String(update.args[0])).toContain("10:00 개막식 및 축하공연");
  });

  it("requeues with an event-proximity backoff when nothing is found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page("<html><body>준비 중</body></html>")));
    const { db, written } = fakeDb([
      row({ start_date: "2026-09-05", end_date: "2026-09-06" }),
    ]);

    const now = new Date("2026-09-02T00:00:00Z");
    const result = await runProgramCrawl(db, {}, { now });

    expect(result.emptyPending).toBe(1);
    const update = written()[0];
    expect(update.sql).toContain("detail_state = 'empty'");
    // 시작이 사흘 앞이면 12시간 뒤 다시 본다.
    expect(update.args[0]).toBe(new Date(now.getTime() + 12 * 60 * 60_000).toISOString());
  });

  it("does not fill or permanently close a row on a transient failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const { db, written } = fakeDb([row()]);

    const result = await runProgramCrawl(db, {}, { now: new Date("2026-09-02T00:00:00Z") });

    expect(result.transientFailed).toBe(1);
    expect(result.permanentNoData).toBe(0);
    const update = written()[0];
    expect(update.sql).toContain("detail_retry_after = ?");
    expect(update.sql).not.toContain("detail_state");
  });

  it("closes a 404 permanently", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const { db, written } = fakeDb([row()]);

    const result = await runProgramCrawl(db, {}, { now: new Date("2026-09-02T00:00:00Z") });

    expect(result.permanentNoData).toBe(1);
    expect(written()[0].sql).toContain("detail_state = 'nodata'");
  });

  it("discards an LLM answer that invents content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page("<html><body>준비 중</body></html>")));
    const ai = {
      run: vi.fn(async () => ({
        response: JSON.stringify({ programInfo: "19:00 유명가수 초청공연" }),
      })),
    };
    const { db, written } = fakeDb([row()]);

    const result = await runProgramCrawl(
      db,
      { AI: ai as unknown as Ai },
      { now: new Date("2026-09-02T00:00:00Z") },
    );

    expect(result.llmCalls).toBe(1);
    expect(result.llmRejected).toBe(1);
    expect(result.llmFilled).toBe(0);
    expect(written()[0].sql).toContain("detail_state = 'empty'");
  });
});
