import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { queryPipelineStats } from "../src/pipelineStats.js";

// pipelineStats는 D1 rows read 예산을 지키려고, 지표마다 따로 돌던 스칼라 쿼리를
// 테이블 한 번 훑는 통합 집계로 합쳤다. 합치면서 값이 바뀌면 대시보드가 조용히
// 거짓말을 하므로, 통합 집계의 각 항을 "예전 모양"인 단일 목적 쿼리로 되돌려
// 실행하고 두 값이 같은지 확인한다. SQL을 손으로 베껴 적지 않고 실제로 코드가
// 실행한 SQL에서 뽑아내므로, 나중에 조건이 바뀌어도 검증이 같이 따라간다.

// node:sqlite는 Node 22에서 --experimental-sqlite 없이는 못 불러오고, vite의
// 내장 모듈 목록에도 아직 없어 정적 import가 해석되지 않는다. createRequire로
// 런타임에만 집어 오고, 없으면 이 파일 전체를 건너뛴다.
let DatabaseSync: (new (path: string) => SqliteDb) | null = null;
try {
  const { createRequire } = await import("node:module");
  DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync;
} catch {
  DatabaseSync = null;
}

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): { all(...args: unknown[]): Record<string, unknown>[] };
}

const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url).pathname;

function openSeededDb(): { sqlite: SqliteDb; db: D1Database; sql: string[] } {
  const sqlite = new DatabaseSync!(":memory:");
  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    sqlite.exec(readFileSync(`${MIGRATIONS_DIR}${file}`, "utf8"));
  }
  seed(sqlite);

  // pipelineStats가 쓰는 D1 표면은 prepare(sql) + batch([...]) 뿐이다.
  const sql: string[] = [];
  const db = {
    prepare(statement: string) {
      return { __sql: statement };
    },
    async batch(statements: { __sql: string }[]) {
      return statements.map((statement) => {
        sql.push(statement.__sql);
        return { results: sqlite.prepare(statement.__sql).all() };
      });
    },
  } as unknown as D1Database;
  return { sqlite, db, sql };
}

function iso(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString();
}

function seed(sqlite: SqliteDb): void {
  const insert = (columns: Record<string, unknown>) => {
    const names = Object.keys(columns);
    const values = names
      .map((name) => {
        const value = columns[name];
        if (value === null) return "NULL";
        if (typeof value === "number") return String(value);
        return `'${String(value).replace(/'/g, "''")}'`;
      })
      .join(",");
    sqlite.exec(`INSERT INTO discovery_items (${names.join(",")}) VALUES (${values})`);
  };

  // 지표마다 서로 다른 조합이 최소 한 건씩 나오도록 짠 고정 표본이다.
  const base = {
    type: "festival",
    title: "행사",
    address: "서울특별시 중구",
    lat: 37.56,
    lng: 126.98,
    synced_at: iso(0),
  };
  const rows: Record<string, unknown>[] = [
    // 무료 · LLM 태깅 · 요금/사진/좌표 모두 확인됨 · 오늘 유입
    { ...base, id: "a", source: "kopis", source_item_id: "a", is_free: 1,
      start_date: "2099-01-01", end_date: "2099-01-02", status: "upcoming",
      first_seen_at: iso(0), last_seen_at: iso(0), tagging_version: 3,
      tagged_at: iso(0), tagging_model: "claude", primary_category: "music_performance",
      fee_checked_at: iso(0), images_checked_at: iso(0), geocode_checked_at: iso(0) },
    // 유료 · fallback 태깅 · 3일 전 유입
    { ...base, id: "b", source: "tourapi", source_item_id: "b", is_free: 0,
      start_date: "2099-02-01", end_date: "2099-02-02", status: "upcoming",
      first_seen_at: iso(-3), last_seen_at: iso(0), tagging_version: -1,
      tagged_at: iso(-3), tagging_model: "fallback", primary_category: "general_event",
      fee_checked_at: iso(-3), images_checked_at: iso(-3), geocode_checked_at: iso(-3) },
    // 요금 확인했지만 판별 불가(unknown) · 사진 미확인(imagePending 후보)
    { ...base, id: "c", source: "kopis", source_item_id: "c", is_free: null,
      start_date: "2099-03-01", end_date: "2099-03-02", status: "upcoming",
      first_seen_at: iso(-10), last_seen_at: iso(0), tagging_version: 3,
      tagged_at: iso(-10), tagging_model: "claude", primary_category: "music_performance",
      fee_checked_at: iso(-10), images_checked_at: null, geocode_checked_at: iso(-10) },
    // 요금 미확인(unchecked, oldestUnchecked 후보) · 태깅 대기 · 좌표 없음
    { ...base, id: "d", source: "seoul_open_data", source_item_id: "d", is_free: null,
      lat: 0, lng: 0, venue_name: "세종문화회관",
      start_date: "2099-04-01", end_date: "2099-04-02", status: "upcoming",
      first_seen_at: iso(-20), last_seen_at: iso(0), tagging_version: 0,
      tagged_at: null, tagging_model: null, primary_category: null,
      fee_checked_at: null, images_checked_at: null, geocode_checked_at: null },
    // 오래 안 갱신됐고 아직 안 끝난 행사(staleOver7d)
    { ...base, id: "e", source: "akei-trade-expo", source_item_id: "e", is_free: null,
      start_date: "2099-05-01", end_date: "2099-05-02", status: "upcoming",
      first_seen_at: iso(-40), last_seen_at: iso(-30), tagging_version: 3,
      tagged_at: iso(-40), tagging_model: "claude", primary_category: "trade_expo",
      fee_checked_at: iso(-40), images_checked_at: iso(-40), geocode_checked_at: iso(-40) },
    // 오래 안 갱신됐고 이미 끝난 행사(staleEndedOver7d)
    { ...base, id: "f", source: "akei-trade-expo", source_item_id: "f", is_free: null,
      start_date: "2020-01-01", end_date: "2020-01-02", status: "ended",
      first_seen_at: iso(-60), last_seen_at: iso(-50), tagging_version: 3,
      tagged_at: iso(-60), tagging_model: "claude", primary_category: "trade_expo",
      fee_checked_at: iso(-60), images_checked_at: iso(-60), geocode_checked_at: iso(-60) },
  ];
  for (const row of rows) insert(row);

  const local = (id: string, status: string, createdAt: string, extra: string) =>
    sqlite.exec(
      `INSERT INTO local_events (id, title, event_type, status, source, store_name, address,
         lat, lng, confidence_score, needs_review, duplicate_key, created_at, updated_at ${extra ? ", " + extra.split("=")[0] : ""})
       VALUES ('${id}', '이벤트', 'discount', '${status}', 'other', '가게', '서울특별시 중구',
         37.5, 127.0, 0.8, 0, '${id}', '${createdAt}', '${createdAt}' ${extra ? ", " + extra.split("=")[1] : ""})`,
    );
  local("l1", "approved", iso(0), `approved_at='${iso(0)}'`);
  local("l2", "approved", iso(-3), `approved_at='${iso(-3)}'`);
  local("l3", "pending", iso(-30), "");
  local("l4", "rejected", iso(-1), "");
  sqlite.exec("UPDATE local_events SET tagging_version = 3 WHERE id IN ('l1','l2')");
  sqlite.exec("UPDATE local_events SET needs_review = 1 WHERE id = 'l3'");
}

// 통합 집계의 SELECT 목록을 최상위 콤마 기준으로 자른다(괄호 안 콤마는 무시).
function splitSelectList(sql: string): string[] {
  const body = sql.slice(sql.indexOf("SELECT") + 6, sql.lastIndexOf("FROM"));
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      items.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) items.push(current);
  return items.map((item) => item.trim());
}

// 통합 집계의 한 항을 "합치기 전" 모양(지표 하나짜리 쿼리)으로 되돌린다.
function toLegacyQuery(item: string, table: string): { alias: string; sql: string } | null {
  const alias = /AS\s+(\w+)\s*$/.exec(item)?.[1];
  if (!alias) return null;
  const expression = item.slice(0, item.length - `AS ${alias}`.length).trim();

  const sumCase = /^SUM\(\s*CASE\s+WHEN\s+([\s\S]+)\s+THEN\s+1\s+ELSE\s+0\s+END\s*\)$/.exec(expression);
  if (sumCase) {
    return { alias, sql: `SELECT COUNT(*) AS value FROM ${table} WHERE ${sumCase[1]}` };
  }
  const minCase = /^MIN\(\s*CASE\s+WHEN\s+([\s\S]+?)\s+THEN\s+(\S+)\s+END\s*\)$/.exec(expression);
  if (minCase) {
    return { alias, sql: `SELECT MIN(${minCase[2]}) AS value FROM ${table} WHERE ${minCase[1]}` };
  }
  const plain = /^(COUNT|MIN|MAX|AVG)\(\s*([\s\S]+?)\s*\)$/.exec(expression);
  if (plain) {
    return { alias, sql: `SELECT ${plain[1]}(${plain[2]}) AS value FROM ${table}` };
  }
  return null;
}

const describeIf = DatabaseSync ? describe : describe.skip;

// queryPipelineStats는 isolate 수명 동안 60초 캐시를 들고 있다. 테스트마다 새
// DB를 열어도 캐시가 앞 테스트 결과를 그대로 돌려주면 검증이 무의미해지므로,
// 매 테스트 전에 시계를 TTL 너머로 옮겨 캐시를 만료시킨다.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(Date.now() + 120_000));
});

afterEach(() => {
  vi.useRealTimers();
});

describeIf("pipelineStats 통합 집계", () => {
  it("통합 집계의 모든 지표가 지표별 개별 쿼리와 같은 값을 낸다", async () => {
    const { sqlite, db, sql } = openSeededDb();
    await queryPipelineStats(db, { includeRunMessages: true });

    const aggregates = [
      { table: "discovery_items", sql: sql.find((s) => s.includes("AS staleEndedOver7d")) },
      { table: "local_events", sql: sql.find((s) => s.includes("AS oldestPendingCreatedAt")) },
    ];

    let compared = 0;
    for (const aggregate of aggregates) {
      expect(aggregate.sql, `${aggregate.table} 통합 집계를 찾지 못했다`).toBeTruthy();
      const merged = sqlite.prepare(aggregate.sql!).all()[0];
      for (const item of splitSelectList(aggregate.sql!)) {
        const legacy = toLegacyQuery(item, aggregate.table);
        expect(legacy, `통합 집계 항을 해석하지 못했다: ${item}`).toBeTruthy();
        const expected = sqlite.prepare(legacy!.sql).all()[0].value;
        expect(merged[legacy!.alias], `${aggregate.table}.${legacy!.alias}`).toEqual(expected);
        compared += 1;
      }
    }
    // 표본이 조용히 비어 통과하는 일이 없도록 실제로 비교한 지표 수를 확인한다.
    expect(compared).toBeGreaterThan(25);
  });

  it("7일 유입을 (날짜, source) 한 번으로 묶어도 날짜별·소스별 결과가 그대로다", async () => {
    const { sqlite, db } = openSeededDb();
    const stats = await queryPipelineStats(db, { includeRunMessages: false });

    const since = `strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')`;
    const legacyDaily = sqlite
      .prepare(
        `SELECT substr(first_seen_at, 1, 10) AS date, COUNT(*) AS count
           FROM discovery_items WHERE first_seen_at >= ${since}
          GROUP BY 1 ORDER BY 1 ASC`,
      )
      .all();
    const legacyBySource = sqlite
      .prepare(
        `SELECT source, COUNT(*) AS count
           FROM discovery_items WHERE first_seen_at >= ${since}
          GROUP BY 1 ORDER BY count DESC, source ASC LIMIT 12`,
      )
      .all();

    expect(stats.discoveryItems.ingestion.dailyNew).toEqual(legacyDaily);
    expect(stats.discoveryItems.ingestion.newBySourceLast7d).toEqual(legacyBySource);
  });

  it("합친 집계 값이 노출되는 통계 필드까지 그대로 실려 나간다", async () => {
    const { db } = openSeededDb();
    const stats = await queryPipelineStats(db, { includeRunMessages: false });

    expect(stats.discoveryItems.total).toBe(6);
    expect(stats.discoveryItems.feeCoverage).toEqual({
      free: 1,
      paid: 1,
      unknown: 3,
      unchecked: 1,
    });
    expect(stats.discoveryItems.tagging.llmTagged).toBe(4);
    expect(stats.discoveryItems.tagging.fallbackTagged).toBe(1);
    expect(stats.discoveryItems.tagging.pending).toBe(1);
    expect(stats.discoveryItems.ingestion.staleOver7d).toBe(1);
    expect(stats.discoveryItems.ingestion.staleEndedOver7d).toBe(1);
    expect(stats.discoveryItems.ingestion.missingCoordinates).toBe(1);
    expect(stats.localEvents.total).toBe(4);
    expect(stats.localEvents.needsReview).toBe(1);
    expect(stats.localEvents.taggingCoverage).toEqual({ tagged: 2, total: 4 });
  });
});
