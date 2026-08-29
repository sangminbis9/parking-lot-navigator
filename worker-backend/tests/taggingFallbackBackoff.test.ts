import { describe, expect, it } from "vitest";
import { runTagging } from "../src/llmTagging.js";
import type { TaggingEnv } from "../src/llmTagging.js";

// fallback으로 확정된 행(tagging_version = -1)이 매 cron마다 다시 조회되고
// 다시 UPDATE되고 있었다(2026-08-29 실측: discovery_items 999행, 하루 21,843행 쓰기).
// 영구 제외는 LLM 보강 기회를 없애므로, 7일 backoff로 다시 볼 수 있게 두되
// 그 사이에는 한 번도 쓰지 않아야 한다.
const DAY = 24 * 60 * 60 * 1000;

interface Row {
  id: string;
  title: string;
  subtitle: string | null;
  category_text: string | null;
  source: string;
  tags_json: string | null;
  tagging_version: number;
  tagged_at: string | null;
}

function fakeDb(rows: Row[]) {
  const updates: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async all() {
              if (!sql.includes("FROM discovery_items")) return { results: [] };
              // incremental WHERE의 판정 규칙을 그대로 옮긴 것.
              const cutoff = sql.includes("tagged_at < ?")
                ? (args[0] as string)
                : null;
              const results = rows.filter(
                (row) =>
                  cutoff === null ||
                  row.tagging_version === 0 ||
                  (row.tagging_version === -1 &&
                    (row.tagged_at === null || row.tagged_at < cutoff)),
              );
              return { results };
            },
            sql,
            args,
          };
        },
      };
    },
    async batch(statements: Array<{ sql: string }>) {
      for (const stmt of statements) updates.push(stmt.sql);
      return [];
    },
  };
  return { db: db as unknown as D1Database, updates };
}

function fallbackRow(taggedAt: string | null): Row {
  return {
    id: "festival:tourapi:1",
    title: "축제",
    subtitle: null,
    category_text: null,
    source: "tourapi",
    tags_json: null,
    tagging_version: -1,
    tagged_at: taggedAt,
  };
}

// AI 바인딩 없이 돌리면 결정론적 fallback만 쓰므로 네트워크 없이 검증된다.
function envWith(db: D1Database): TaggingEnv {
  return { DB: db } as unknown as TaggingEnv;
}

describe("fallback 태깅 backoff", () => {
  it("하루 전에 fallback으로 찍힌 행은 다시 조회하지도 쓰지도 않는다", async () => {
    const { db, updates } = fakeDb([
      fallbackRow(new Date(Date.now() - DAY).toISOString()),
    ]);

    const result = await runTagging(envWith(db), { source: "cron" });

    expect(result.processed).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("7일이 지나면 LLM 보강 기회를 위해 다시 잡는다", async () => {
    const { db, updates } = fakeDb([
      fallbackRow(new Date(Date.now() - 8 * DAY).toISOString()),
    ]);

    const result = await runTagging(envWith(db), { source: "cron" });

    expect(result.processed).toBe(1);
    expect(updates).toHaveLength(1);
  });

  it("아직 태깅되지 않은 행(tagging_version = 0)은 backoff와 무관하게 잡는다", async () => {
    const { db } = fakeDb([
      { ...fallbackRow(null), tagging_version: 0, tagged_at: null },
    ]);

    const result = await runTagging(envWith(db), { source: "cron" });

    expect(result.processed).toBe(1);
  });
});
