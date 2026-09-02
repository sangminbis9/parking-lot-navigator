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
  queries: string[];
} {
  const batched: FakeStatement[][] = [];
  const queries: string[] = [];
  const db = {
    prepare: (sql: string) => (queries.push(sql), {
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
  return { db, written: () => batched.slice(1).flat(), queries };
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

  it("drops share buttons without losing the schedule under them", () => {
    // 경기도 페이지는 공유 버튼이 본문 위에 있다. 여기서 끊으면 일정을 통째로 잃는다.
    const text = htmlToText(`
      <h3>행사 일정</h3>
      <p>페이스북 공유</p><p>카카오톡 공유</p>
      <p>제28회 파주예술제 상세보기 - 행사기간, 행사장소</p>
      <p>개막공연: 2026. 7. 3.(금) 19:00</p>
    `);

    const program = extractProgramText(text);
    expect(program).toContain("19:00");
    expect(program).not.toContain("공유");
    expect(program).not.toContain("상세보기");
  });

  it("stops before the fee and organizer block", () => {
    // 수원시 상세 페이지가 프로그램 바로 아래 요금·주관기관을 붙여 둔다.
    const text = htmlToText(`
      <h3>주요 행사</h3>
      <p>일시: 2026. 5. 2.(토) 19:00</p>
      <p>출연진: 수원시립합창단</p>
      <p>요금정보</p>
      <p>주관기관</p>
      <p>수원문화재단</p>
    `);

    const program = extractProgramText(text);
    expect(program).toContain("19:00");
    expect(program).not.toContain("수원문화재단");
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

  it("identifies itself with a User-Agent", async () => {
    // UA 없이 보내면 suwon.go.kr이 200으로 "보안 정책 차단 알림" 스텁을 준다.
    // 본문이 없으니 매번 empty로 재큐잉되며 같은 행을 영원히 다시 긁는다.
    const fetchMock = vi.fn(async () => page(PROGRAM_PAGE));
    vi.stubGlobal("fetch", fetchMock);
    const { db } = fakeDb([row()]);

    await runProgramCrawl(db, {}, { now: new Date("2026-09-02T00:00:00Z") });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["User-Agent"]).toContain("ParkingLotNavigatorBot");
  });

  it("skips rows whose source already carried programInfo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page(PROGRAM_PAGE)));
    const { db, queries } = fakeDb([row()]);

    await runProgramCrawl(db, {}, { now: new Date("2026-09-02T00:00:00Z") });

    // 이 조건이 빠지면 seoul_open_data 행 41%를 이미 아는 정보에 쓰고,
    // 원본 프로그램을 크롤 추출로 덮는다.
    const select = queries.find((sql) => sql.includes("FROM discovery_items") && sql.includes("LIMIT"));
    expect(select).toContain("json_extract(raw_payload, '$.programInfo') IS NULL");
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
