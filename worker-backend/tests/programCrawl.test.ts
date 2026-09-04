import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeHtmlEntities,
  extractProgramText,
  htmlToText,
  isGrounded,
  programLink,
  runProgramCrawl,
  runProgramStage,
  selectProgramCrawlTargets,
  truncateHtml,
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

// --- 단계 분할 (Queue) ---
// 예전에는 랜딩 fetch → 링크 1-hop → LLM을 한 invocation에서 이어 붙여
// 회차가 통째로 `Exceeded CPU Limit`으로 죽었다. 지금은 단계마다 메시지 하나다.

function stageDb(rows: Record<string, unknown>[]): {
  db: D1Database;
  writes: () => FakeStatement[];
} {
  const writes: FakeStatement[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        sql,
        args,
        all: async () => ({
          results: sql.includes("WHERE id = ?") ? rows.filter((r) => r.id === args[0]) : rows,
        }),
        run: async () => (writes.push({ sql, args }), {}),
      }),
    }),
    batch: async (statements: FakeStatement[]) => (writes.push(...statements), []),
  } as unknown as D1Database;
  return { db, writes: () => writes };
}

function stageRow(overrides: Record<string, unknown> = {}) {
  return { ...row(), program_filled_at: null, ...overrides };
}

const LANDING_WITH_LINK = `<html><body><h1>축제 안내</h1>
  <a href="/sub/program.do">세부 일정</a></body></html>`;

describe("runProgramStage", () => {
  it("landing 페이지에서 찾으면 바로 저장하고 끝낸다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page(PROGRAM_PAGE)));
    const { db, writes } = stageDb([stageRow()]);

    const result = await runProgramStage(
      db,
      {},
      { stage: "page", id: "row-1", url: "https://festival.example/main" },
      { now: new Date("2026-09-02T00:00:00Z") },
    );

    expect(result.outcome).toBe("filled");
    expect(result.pagesFetched).toBe(1);
    expect(writes()[0].sql).toContain("program_filled_at = ?");
    expect(String(writes()[0].args[0])).toContain("10:00 개막식 및 축하공연");
  });

  it("landing이 비면 같은 호스트 링크를 다음 메시지로 넘기고 아무것도 쓰지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page(LANDING_WITH_LINK)));
    const { db, writes } = stageDb([stageRow()]);

    const result = await runProgramStage(
      db,
      {},
      { stage: "page", id: "row-1", url: "https://festival.example/main" },
      { now: new Date("2026-09-02T00:00:00Z") },
    );

    expect(result.outcome).toBe("handed_off");
    expect(result.next).toEqual({
      stage: "subpage",
      id: "row-1",
      url: "https://festival.example/sub/program.do",
    });
    // 중간 상태를 쓰면 다음 단계의 판정과 어긋난다. 선점(15분)이 대신 버틴다.
    expect(writes()).toHaveLength(0);
  });

  it("second-hop에서 찾으면 저장한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page(PROGRAM_PAGE)));
    const { db, writes } = stageDb([stageRow()]);

    const result = await runProgramStage(
      db,
      {},
      { stage: "subpage", id: "row-1", url: "https://festival.example/sub/program.do" },
      { now: new Date("2026-09-02T00:00:00Z") },
    );

    expect(result.outcome).toBe("filled");
    expect(writes()[0].sql).toContain("$.programInfo");
  });

  it("second-hop도 비면 AI 단계를 다음 메시지로 넘긴다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page("<html><body>준비 중</body></html>")));
    const ai = { run: vi.fn() };
    const { db, writes } = stageDb([stageRow()]);

    const result = await runProgramStage(
      db,
      { AI: ai as unknown as Ai },
      { stage: "subpage", id: "row-1", url: "https://festival.example/sub/program.do" },
      { now: new Date("2026-09-02T00:00:00Z") },
    );

    expect(result.outcome).toBe("handed_off");
    expect(result.next?.stage).toBe("ai");
    expect(ai.run).not.toHaveBeenCalled();
    expect(writes()).toHaveLength(0);
  });

  it("AI 단계는 원문에 있는 답만 저장한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page(PROGRAM_PAGE)));
    const ai = {
      run: vi.fn(async () => ({
        response: JSON.stringify({ programInfo: "10:00 개막식 및 축하공연" }),
      })),
    };
    const { db, writes } = stageDb([stageRow()]);

    const result = await runProgramStage(
      db,
      { AI: ai as unknown as Ai },
      { stage: "ai", id: "row-1", url: "https://festival.example/main" },
      { now: new Date("2026-09-02T00:00:00Z") },
    );

    expect(result.outcome).toBe("filled");
    expect(result.llmCalls).toBe(1);
    expect(result.llmRejected).toBe(0);
    expect(String(writes()[0].args[0])).toContain("10:00 개막식 및 축하공연");
  });

  it("AI가 원문에 없는 출연진을 지어내면 버리고 다시 큐에 넣는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page(PROGRAM_PAGE)));
    const ai = {
      run: vi.fn(async () => ({
        response: JSON.stringify({ programInfo: "19:00 유명가수 초청공연" }),
      })),
    };
    const { db, writes } = stageDb([stageRow()]);

    const result = await runProgramStage(
      db,
      { AI: ai as unknown as Ai },
      { stage: "ai", id: "row-1", url: "https://festival.example/main" },
      { now: new Date("2026-09-02T00:00:00Z") },
    );

    expect(result.outcome).toBe("empty");
    expect(result.llmRejected).toBe(1);
    expect(writes()[0].sql).toContain("detail_state = 'empty'");
    expect(writes()[0].sql).not.toContain("program_filled_at");
  });

  it("503은 확정하지 않고 backoff만 건다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const { db, writes } = stageDb([stageRow()]);

    const result = await runProgramStage(
      db,
      {},
      { stage: "page", id: "row-1", url: "https://festival.example/main" },
      { now: new Date("2026-09-02T00:00:00Z") },
    );

    expect(result.outcome).toBe("transient");
    expect(writes()[0].sql).toContain("detail_retry_after = ?");
    expect(writes()[0].sql).not.toContain("detail_state");
  });

  it("404는 영구 종료한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const { db, writes } = stageDb([stageRow()]);

    const result = await runProgramStage(
      db,
      {},
      { stage: "page", id: "row-1", url: "https://festival.example/main" },
      { now: new Date("2026-09-02T00:00:00Z") },
    );

    expect(result.outcome).toBe("nodata");
    expect(writes()[0].sql).toContain("detail_state = 'nodata'");
  });

  it("이미 끝난 행사는 다시 보지 않도록 영구 종료한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page("<html><body>준비 중</body></html>")));
    const { db, writes } = stageDb([
      stageRow({ start_date: "2026-08-01", end_date: "2026-08-10" }),
    ]);

    const result = await runProgramStage(
      db,
      {},
      { stage: "page", id: "row-1", url: "https://festival.example/main" },
      { now: new Date("2026-09-02T00:00:00Z") },
    );

    expect(result.outcome).toBe("nodata");
    expect(writes()[0].sql).toContain("detail_state = 'nodata'");
  });

  it("중복 메시지는 페이지를 열지도 쓰지도 않는다", async () => {
    // Queue는 at-least-once라 같은 메시지가 두 번 온다. 이미 채운 행을
    // 다시 긁으면 subrequest와 D1 쓰기를 그냥 버린다.
    const fetchMock = vi.fn(async () => page(PROGRAM_PAGE));
    vi.stubGlobal("fetch", fetchMock);
    const { db, writes } = stageDb([
      stageRow({ program_filled_at: "2026-09-01T00:00:00.000Z" }),
    ]);

    const result = await runProgramStage(
      db,
      {},
      { stage: "page", id: "row-1", url: "https://festival.example/main" },
      { now: new Date("2026-09-02T00:00:00Z") },
    );

    expect(result.outcome).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writes()).toHaveLength(0);
  });

  it("본문 상한을 넘겨 읽지 않고 스트림을 끊는다", async () => {
    // HTML 파싱이 이 파이프라인에서 가장 비싼 CPU 소비원이다. 상한(60KB)까지만
    // 읽고 나머지는 받지 않아야 큰 페이지 하나가 회차를 죽이지 않는다.
    const chunk = "x".repeat(10_000);
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= 30) {
          controller.close();
          return;
        }
        pulled += 1;
        controller.enqueue(new TextEncoder().encode(chunk));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { headers: { "content-type": "text/html" } })),
    );
    const { db } = stageDb([stageRow()]);

    await runProgramStage(
      db,
      {},
      { stage: "page", id: "row-1", url: "https://festival.example/main" },
      { now: new Date("2026-09-02T00:00:00Z") },
    );

    // 60,000자 상한이라 10,000자 청크 6개면 충분하다. 300,000자를 다 읽으면 안 된다.
    expect(pulled).toBeLessThanOrEqual(7);
  });
});

describe("selectProgramCrawlTargets", () => {
  it("fetch 없이 대상을 고르고 15분 선점을 건다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { db, writes } = stageDb([
      { id: "row-1", source_url: "https://festival.example/main" },
    ]);

    const now = new Date("2026-09-02T00:00:00Z");
    const targets = await selectProgramCrawlTargets(db, { maxItems: 4, now });

    expect(targets).toEqual([{ id: "row-1", url: "https://festival.example/main" }]);
    expect(fetchMock).not.toHaveBeenCalled();
    const claim = writes()[0];
    expect(claim.sql).toContain("detail_attempts = detail_attempts + 1");
    expect(claim.args[0]).toBe(new Date(now.getTime() + 15 * 60_000).toISOString());
  });

  it("maxItems가 0이면 D1을 건드리지 않는다", async () => {
    const { db, writes } = stageDb([]);

    expect(await selectProgramCrawlTargets(db, { maxItems: 0 })).toEqual([]);
    expect(writes()).toHaveLength(0);
  });
});

// --- 링크 해석 (엔티티 · 프래그먼트) ---

describe("programLink URL 해석", () => {
  it("href의 &amp; / &#38; / &#x26;를 풀고 나서 URL을 만든다", () => {
    // 풀지 않으면 `&amp;wr_id`를 문자 그대로 요청해 다른 문서(게시판 목록)를 받는다.
    const base = new URL("https://festival.example/main");
    for (const entity of ["&amp;", "&#38;", "&#x26;"]) {
      const html = `<a href="/bbs/board.php?bo_table=bbs5_05${entity}wr_id=123">프로그램</a>`;
      expect(programLink(html, base)).toBe(
        "https://festival.example/bbs/board.php?bo_table=bbs5_05&wr_id=123",
      );
    }
  });

  it("문서 내부 앵커는 후보에서 빼고 진짜 하위 페이지만 고른다", () => {
    const html = `<a href="#">프로그램</a>
      <a href="#program">프로그램</a>
      <a href="https://example.com/">프로그램</a>
      <a href="/program">프로그램</a>`;

    expect(programLink(html, new URL("https://example.com/"))).toBe("https://example.com/program");
  });

  it("프래그먼트만 있는 링크뿐이면 후보가 없다", () => {
    const html = `<a href="https://example.com/#program">프로그램</a>`;

    expect(programLink(html, new URL("https://example.com/"))).toBeNull();
  });
});

describe("decodeHtmlEntities", () => {
  it("이름·10진·16진 참조를 모두 푼다", () => {
    expect(decodeHtmlEntities("a&amp;b&#38;c&#x26;d&nbsp;e")).toBe("a&b&c&d e");
  });

  it("모르는 참조는 그대로 둔다", () => {
    expect(decodeHtmlEntities("&unknown;&#x110000;")).toBe("&unknown;&#x110000;");
  });
});

// --- 점 표기 날짜와 연간 일정표 ---

describe("점 날짜 프로그램표", () => {
  it("시각 없이 점 날짜만 있는 공연 라인업을 뽑는다", () => {
    // culture.seoul.go.kr 실측 모양. 40건 표본에서 규칙이 놓친 유일한 진짜 프로그램이었다.
    const text = htmlToText(`<html><body>
      <p>국립극장 페스티벌</p>
      <p>국립창극단 '귀토' 2026.9.3.(목)-9.6.(일) 국립극장 해오름</p>
      <p>국립무용단 '축제' 2026.9.10.(수)-9.13.(토) 국립극장 달오름</p>
      <p>국립국악관현악단 '이음' 2026.09.20.(토) 국립극장 하늘</p>
    </body></html>`);

    const program = extractProgramText(text);
    expect(program).toContain("귀토");
    expect(program).toContain("2026.09.20.(토)");
  });

  it("연간 축제 일정표는 프로그램으로 잡지 않는다", () => {
    // 이 행사의 프로그램이 아니라 남의 행사 목록이다(화성시 tour 페이지 실측 모양).
    const text = htmlToText(`<html><body>
      <h2>2026 축제일정표</h2>
      <p>5.5.(화) 화성 효 마라톤 대회</p>
      <p>6.13.(토) 봉담 어울림 축제</p>
      <p>9.19.(토) 정조 효 문화제</p>
    </body></html>`);

    expect(extractProgramText(text)).toBeNull();
  });

  it("개요표 라벨 줄만 있으면 잡지 않는다", () => {
    const text = htmlToText(`<html><body>
      <p>행사시작일 2026.9.3.(목)</p>
      <p>행사종료일 2026.9.6.(일)</p>
      <p>등록일 2026.08.01.</p>
    </body></html>`);

    expect(extractProgramText(text)).toBeNull();
  });

  it("점 날짜가 두 줄뿐이면 잡지 않는다", () => {
    const text = htmlToText(`<html><body>
      <p>가야금 병창 공연 2026.9.3.(목) 대극장</p>
      <p>사물놀이 한마당 2026.9.6.(일) 소극장</p>
    </body></html>`);

    expect(extractProgramText(text)).toBeNull();
  });

  it("게시판 목록(줄 끝 작성일)은 잡지 않는다", () => {
    // haemifest.com 실측 모양. 제목 길이는 충분하지만 날짜 뒤에 아무 말도 없다.
    const text = htmlToText(`<html><body>
      <p>[모집안내] 제23회 서산해미읍성축제 전통혼례체험 참가자 모집 2026.09.03</p>
      <p>제23회 서산해미읍성축제 창·제작 작품공모 심사 결과 2026.09.01</p>
      <p>제23회 서산해미읍성축제 프로그램 통합공모 심사 결과 2026.08.28</p>
      <p>[공고] 제23회 서산해미읍성축제 프로그램 통합공모 공고 2026.07.30</p>
    </body></html>`);

    expect(extractProgramText(text)).toBeNull();
  });

  it("공고 절차표(라벨 : 날짜)는 잡지 않는다", () => {
    // 경산문화관광재단 채용공고 실측 모양. 날짜 앞뒤로 글자가 충분해도 라벨이 붙어 있다.
    const text = htmlToText(`<html><body>
      <p>- 서류심사 발표 : 2026. 08. 18.(화) 합격자 개별 통보</p>
      <p>- 면접심사 : 2026. 08. 20.(목) 15시 경산문화관광재단 2층 회의실</p>
      <p>- 최종합격자 발표 : 2026. 08. 25.(화) 합격자 개별 통보</p>
    </body></html>`);

    expect(extractProgramText(text)).toBeNull();
  });

  it("날짜만 나열한 줄은 잡지 않는다", () => {
    // 화성시 tour 실측 모양. 일정표 제목이 없어도 줄 모양만으로 걸러야 한다.
    const text = htmlToText(`<html><body>
      <p>봄 여름 가을 겨울 안내</p>
      <p>5. 22.(금) ~ 25.(월)</p>
      <p>9. 5.(토) ~ 6.(일)</p>
      <p>10. 30.(금)~10. 31.(토)</p>
    </body></html>`);

    expect(extractProgramText(text)).toBeNull();
  });

  it("작품 제목 안의 콜론은 라벨로 보지 않는다", () => {
    const text = htmlToText(`<html><body>
      <p>- 태국 왕립무용단 '콘: 라미끼엔의 이야기' | 2026.9.4.(금)-9.5.(토) | 국립극장 하늘</p>
      <p>- 국립창극단 '귀토' | 2026.9.3.(목)-9.6.(일) | 국립극장 해오름</p>
      <p>- 혜성컴퍼니 '백만사' | 2026.9.24.(목)-9.26.(금) | 국립극장 달오름</p>
    </body></html>`);

    expect(extractProgramText(text)).toContain("라미끼엔");
  });
});

// --- JS 리다이렉트 스텁 ---

// 응답을 URL별로 갈라 주는 mock. 등록되지 않은 URL은 404.
function routedFetch(routes: Record<string, string>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = routes[url];
    return body === undefined ? new Response("", { status: 404 }) : page(body);
  });
}

const REDIRECT_STUB_RELATIVE = `<script>document.location.href="/view/index.do"</script>`;
const REDIRECT_STUB_ABSOLUTE = `<script>location.href = "https://festival.example/view/index.do"</script>`;
const REDIRECT_STUB_REPLACE = `<script>window.location.replace('/view/index.do');</script>`;

describe("JS 리다이렉트 스텁", () => {
  for (const [label, stub] of [
    ["상대 경로 document.location.href", REDIRECT_STUB_RELATIVE],
    ["절대 경로 location.href", REDIRECT_STUB_ABSOLUTE],
    ["location.replace()", REDIRECT_STUB_REPLACE],
  ] as const) {
    it(`${label}를 한 번 따라가 프로그램을 찾는다`, async () => {
      const fetchMock = routedFetch({
        "https://festival.example/main": stub,
        "https://festival.example/view/index.do": PROGRAM_PAGE,
      });
      vi.stubGlobal("fetch", fetchMock);
      const { db, writes } = stageDb([stageRow()]);

      const result = await runProgramStage(
        db,
        {},
        { stage: "page", id: "row-1", url: "https://festival.example/main" },
        { now: new Date("2026-09-02T00:00:00Z") },
      );

      expect(result.outcome).toBe("filled");
      // subrequest 예산을 정직하게 센다 — 스텁을 따라가면 2건이다.
      expect(result.pagesFetched).toBe(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(writes()[0].args[0])).toContain("10:00 개막식 및 축하공연");
    });
  }

  it("본문이 있는 페이지는 리다이렉트 문자열이 있어도 따라가지 않는다", async () => {
    const withScript = `<html><body>
      <script>if (isMobile) location.href = "/m/index.do";</script>
      <h2>행사 프로그램</h2>
      <p>${"안내문 ".repeat(60)}</p>
      <ul><li>10:00 개막식 및 축하공연</li><li>13:00 전통연희 마당놀이</li></ul>
    </body></html>`;
    const fetchMock = routedFetch({ "https://festival.example/main": withScript });
    vi.stubGlobal("fetch", fetchMock);
    const { db } = stageDb([stageRow()]);

    const result = await runProgramStage(
      db,
      {},
      { stage: "page", id: "row-1", url: "https://festival.example/main" },
      { now: new Date("2026-09-02T00:00:00Z") },
    );

    expect(result.outcome).toBe("filled");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("따라간 곳도 스텁이면 1-hop에서 멈추고 nodata로 닫는다", async () => {
    // 체인을 따라가면 CPU·subrequest를 쓰면서도 결론이 같다. 여기서 영구 종료하지 않으면
    // 같은 60바이트를 backoff 주기마다 영원히 다시 긁는다.
    const fetchMock = routedFetch({
      "https://festival.example/main": REDIRECT_STUB_RELATIVE,
      "https://festival.example/view/index.do": `<script>location.href="/again.do"</script>`,
      "https://festival.example/again.do": PROGRAM_PAGE,
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, writes } = stageDb([stageRow()]);

    const result = await runProgramStage(
      db,
      {},
      { stage: "page", id: "row-1", url: "https://festival.example/main" },
      { now: new Date("2026-09-02T00:00:00Z") },
    );

    expect(result.outcome).toBe("nodata");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(writes()[0].sql).toContain("detail_state = 'nodata'");
  });

  it("스텁 목적지가 일시적으로 죽으면 nodata가 아니라 backoff다", async () => {
    // 실패 종류를 섞으면 잠깐 5xx를 뱉은 사이트가 영구 제외된다.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return url.endsWith("/main")
        ? page(REDIRECT_STUB_RELATIVE)
        : new Response("", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, writes } = stageDb([stageRow()]);

    const result = await runProgramStage(
      db,
      {},
      { stage: "page", id: "row-1", url: "https://festival.example/main" },
      { now: new Date("2026-09-02T00:00:00Z") },
    );

    expect(result.outcome).toBe("transient");
    expect(writes()[0].sql).toContain("detail_retry_after = ?");
    expect(writes()[0].sql).not.toContain("nodata");
  });
});

describe("truncateHtml", () => {
  const CAP = 60_000;

  it("상한 이하 본문은 그대로 둔다", () => {
    const small = "<p>프로그램 안내</p>\n2026.9.18. 개막공연";
    expect(truncateHtml(small)).toBe(small);
    const exact = "a".repeat(CAP);
    expect(truncateHtml(exact)).toBe(exact);
  });

  it("경계에 걸린 날짜 줄은 통째로 빠지고 앞줄은 온전히 남는다", () => {
    const head = "a".repeat(59_000) + "\n";
    const line = "2026.9.18. 개막공연\n";
    const result = truncateHtml(head + line.repeat(200));

    expect(result.length).toBeLessThanOrEqual(CAP);
    expect(result.endsWith("\n")).toBe(true);
    // 잘린 반쪽 날짜(`026.9.18.`)가 남지 않는다.
    const lines = result.split("\n").filter((l) => l.startsWith("2026") || l.startsWith("026"));
    expect(lines.every((l) => l === "2026.9.18. 개막공연")).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("줄바꿈이 없으면 닫힌 태그 경계에서 자른다", () => {
    const result = truncateHtml("a".repeat(59_500) + ">" + "b".repeat(2_000));
    expect(result.length).toBe(59_501);
    expect(result.endsWith(">")).toBe(true);
  });

  it("줄바꿈도 태그도 없으면 공백 경계에서 자른다", () => {
    const result = truncateHtml("a".repeat(59_500) + " " + "b".repeat(2_000));
    expect(result.length).toBe(59_501);
    expect(result.endsWith(" ")).toBe(true);
  });

  it("탐색 범위 안에 경계가 없으면 상한에서 자른다", () => {
    expect(truncateHtml("a".repeat(70_000)).length).toBe(CAP);
    // 경계가 있어도 상한보다 2,000자 넘게 앞이면 쓰지 않는다.
    const farBoundary = "a".repeat(57_000) + "\n" + "b".repeat(5_000);
    expect(truncateHtml(farBoundary).length).toBe(CAP);
  });
});
