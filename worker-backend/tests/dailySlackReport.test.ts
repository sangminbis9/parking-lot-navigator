import { describe, expect, it, vi } from "vitest";
import {
  buildDailySlackPayloads,
  queryDailySlackReport,
  sendDailySlackReport,
  type DailySlackReportData,
} from "../src/dailySlackReport.js";

interface FakeStatement {
  sql: string;
  args: unknown[];
}

function fakeDb() {
  const statements: FakeStatement[] = [];
  const db = {
    statements,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) { return { sql, args }; },
      };
    },
    async batch(items: FakeStatement[]) {
      statements.push(...items);
      return items.map((item) => {
        if (item.sql.includes("analytics_daily")) return { results: [{ count: 7 }] };
        if (item.sql.includes("FROM discovery_items")) {
          return { results: [{ festivals: 3, trade_expos: 2, performances: 4 }] };
        }
        if (item.sql.includes("COUNT(*) AS count")) return { results: [{ count: 5, merchant_count: 1 }] };
        return { results: [] };
      });
    },
  };
  return db as unknown as D1Database & { statements: FakeStatement[] };
}

function reportData(merchantEventsTotal = 1): DailySlackReportData {
  return {
    day: "2026-09-15", generatedAt: "2026-09-15T11:00:00.000Z",
    dailyActiveUsers: 7, festivals: 3, tradeExpos: 2, performances: 4,
    localEvents: 5, merchantEventsTotal,
  };
}

describe("daily Slack report", () => {
  it("KST 오늘 범위로 네 종류와 익명 일일 접속자를 한 batch에서 조회한다", async () => {
    const db = fakeDb();
    const report = await queryDailySlackReport(db, new Date("2026-09-15T11:00:00.000Z"));
    expect(report).toMatchObject({ day: "2026-09-15", dailyActiveUsers: 7,
      festivals: 3, tradeExpos: 2, performances: 4, localEvents: 5 });
    expect(report.merchantEventsTotal).toBe(1);
    expect(db.statements).toHaveLength(3);
    expect(db.statements[1]!.args).toEqual([
      "2026-09-14T15:00:00.000Z", "2026-09-15T11:00:00.000Z",
    ]);
  });

  it("사장님 이벤트는 상세 카드 없이 개수만 한 메시지에 표시한다", () => {
    const data = reportData(100);
    const payloads = buildDailySlackPayloads(data);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]!.blocks).toHaveLength(2);
    expect(JSON.stringify(payloads)).toContain("사장님 직접 등록: *100개*");
    expect(JSON.stringify(payloads)).not.toContain("사장님 등록 이벤트 상세");
  });

  it("성공 표시가 있으면 재시도 Cron이 중복 전송하지 않는다", async () => {
    const db = fakeDb();
    const keys = new Set<string>();
    const bucket = {
      head: async (key: string) => keys.has(key) ? ({ key }) : null,
      put: async (key: string) => { keys.add(key); return {}; },
    } as unknown as R2Bucket;
    const fetcher = vi.fn(async () => new Response("ok"));
    const env = { DB: db, DISCOVERY_SNAPSHOTS: bucket,
      SLACK_DAILY_REPORT_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/secret" };
    const first = await sendDailySlackReport(env, {
      now: new Date("2026-09-15T11:00:00.000Z"), fetcher,
    });
    const second = await sendDailySlackReport(env, {
      now: new Date("2026-09-15T11:10:00.000Z"), fetcher,
    });
    expect(first.sent).toBe(true);
    expect(second.skipped).toBe("already_sent");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("Slack 실패에는 완료 표시를 남기지 않고 재시도도 20시 cutoff를 유지한다", async () => {
    const db = fakeDb();
    const keys = new Set<string>();
    const bucket = {
      head: async (key: string) => keys.has(key) ? ({ key }) : null,
      put: async (key: string) => { keys.add(key); return {}; },
    } as unknown as R2Bucket;
    const failing = vi.fn(async () => new Response("busy", { status: 503 }));
    const env = { DB: db, DISCOVERY_SNAPSHOTS: bucket,
      SLACK_DAILY_REPORT_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/secret" };
    await expect(sendDailySlackReport(env, {
      now: new Date("2026-09-15T11:00:00.000Z"), fetcher: failing,
    })).rejects.toThrow("slack_webhook_failed:503");
    expect(keys.size).toBe(0);

    const successful = vi.fn(async () => new Response("ok"));
    await expect(sendDailySlackReport(env, {
      now: new Date("2026-09-15T11:10:00.000Z"), fetcher: successful,
    })).resolves.toMatchObject({ sent: true });
    expect(db.statements.at(-2)?.args[1]).toBe("2026-09-15T11:00:00.000Z");
  });
});
