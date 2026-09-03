import { afterEach, describe, expect, it, vi } from "vitest";
import { runAkeiTradeExpoPage } from "../src/akeiTradeExpoDiscovery.js";

interface Recorded {
  sql: string;
  args: unknown[];
}

/** batch()에 실제로 들어간 statement만 기록하는 최소 D1. */
function fakeDb(): { db: D1Database; written: () => Recorded[] } {
  const written: Recorded[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return { sql, args };
        },
      };
    },
    async batch(statements: unknown[]) {
      written.push(...(statements as Recorded[]));
      return [];
    },
  } as unknown as D1Database;
  return { db, written: () => written };
}

function listPage(entries: { wrId: string; title: string; venue?: string }[]): string {
  const items = entries
    .map(
      (entry) => `
      <li class="content_sc_li" id="content_sc_${entry.wrId}">
        <div class="txt">
          <strong><p>${entry.title}<span>D-3</span></p></strong>
          <ul>
            <li>주 최 : 한국전시주최자협회</li>
            <li>기 간 : 2026-10-01 ~ 2026-10-04</li>
            <li>장 소 : ${entry.venue ?? "코엑스 1층 A홀"}</li>
          </ul>
        </div>
      </li>`,
    )
    .join("");
  return `<html><body><ul>${items}</ul></body></html>`;
}

function respondWith(pages: Record<string, string>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: URL | string) => {
    const url = String(input);
    calls.push(url);
    const page = Object.entries(pages).find(([marker]) => url.includes(marker));
    return new Response(page ? page[1] : listPage([]), {
      headers: { "content-type": "text/html" },
    });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runAkeiTradeExpoPage", () => {
  it("페이지 하나만 받아 그 항목만 저장한다", async () => {
    const calls = respondWith({
      "page=1": listPage([
        { wrId: "1001", title: "국제 물류산업전" },
        { wrId: "1002", title: "스마트팩토리 엑스포" },
      ]),
    });
    const { db, written } = fakeDb();

    const result = await runAkeiTradeExpoPage(db, 2026, 10, 1);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("searchYear=2026");
    expect(calls[0]).toContain("searchMonth=10");
    expect(calls[0]).toContain("page=1");
    expect(result.processed).toBe(2);
    expect(result.published).toBe(2);
    expect(result.failed).toBe(false);
    expect(written().map((row) => row.args[0])).toEqual(["akei:1001", "akei:1002"]);
  });

  it("항목이 있으면 다음 페이지를 이어 볼 신호를 준다", async () => {
    respondWith({ "page=2": listPage([{ wrId: "2001", title: "부산 조선해양대전" }]) });
    const { db } = fakeDb();

    const result = await runAkeiTradeExpoPage(db, 2026, 10, 2);

    expect(result.hasMore).toBe(true);
  });

  it("빈 페이지면 연속을 끊는다", async () => {
    respondWith({});
    const { db, written } = fakeDb();

    const result = await runAkeiTradeExpoPage(db, 2026, 10, 5);

    expect(result.hasMore).toBe(false);
    expect(result.processed).toBe(0);
    expect(written()).toHaveLength(0);
  });

  it("같은 메시지가 두 번 와도 같은 id로 upsert라 행이 늘지 않는다", async () => {
    respondWith({ "page=1": listPage([{ wrId: "3001", title: "그린에너지 엑스포" }]) });
    const first = fakeDb();
    const second = fakeDb();

    await runAkeiTradeExpoPage(first.db, 2026, 10, 1);
    await runAkeiTradeExpoPage(second.db, 2026, 10, 1);

    const a = first.written();
    const b = second.written();
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].args[0]).toBe("akei:3001");
    expect(b[0].args[0]).toBe("akei:3001");
    expect(a[0].sql).toContain("ON CONFLICT(id) DO UPDATE");
  });

  it("좌표를 못 찾는 전시장은 세기만 하고 저장하지 않는다", async () => {
    respondWith({
      "page=1": listPage([{ wrId: "4001", title: "동네 소규모 박람회", venue: "이름 없는 홀" }]),
    });
    const { db, written } = fakeDb();

    const result = await runAkeiTradeExpoPage(db, 2026, 10, 1);

    expect(result.processed).toBe(1);
    expect(result.published).toBe(0);
    expect(result.unmappedVenues).toBe(1);
    expect(written()).toHaveLength(0);
  });

  it("fetch가 계속 실패하면 실패로 닫고 연속하지 않는다", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 503 }));
    const { db, written } = fakeDb();

    const result = await runAkeiTradeExpoPage(db, 2026, 10, 1);

    expect(result.failed).toBe(true);
    expect(result.hasMore).toBe(false);
    expect(written()).toHaveLength(0);
  });
});
