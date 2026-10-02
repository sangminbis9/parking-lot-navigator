import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import { endedRetentionCutoffDay, pruneEndedDiscovery } from "../src/discoveryCache.js";

function fixture(rows: { id: string; type?: string; start: string | null; end: string | null }[]) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE discovery_items (id TEXT PRIMARY KEY, type TEXT, start_date TEXT, end_date TEXT)");
  for (const r of rows) {
    sqlite.prepare("INSERT INTO discovery_items VALUES (?, ?, ?, ?)").run(r.id, r.type ?? "festival", r.start, r.end);
  }
  const db = {
    prepare(query: string) {
      const statement = sqlite.prepare(query);
      return {
        bind: (...args: (string | number)[]) => ({
          run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
        }),
      };
    },
  } as unknown as D1Database;
  const ids = () => (sqlite.prepare("SELECT id FROM discovery_items ORDER BY id").all() as { id: string }[]).map(r => r.id);
  return { db, ids };
}

describe("pruneEndedDiscovery", () => {
  const cutoff = endedRetentionCutoffDay();
  const dayBefore = new Date(`${cutoff}T00:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const old = dayBefore.toISOString().slice(0, 10);

  it("종료 30일이 지난 축제만 지우고 경계·날짜 없음·다른 type은 남긴다", async () => {
    const { db, ids } = fixture([
      { id: "old", start: "2020-01-01", end: old },
      { id: "old-start-only", start: old, end: null },
      { id: "old-time", start: "2020-01-01", end: `${old}T23:59:59` },
      { id: "boundary", start: "2020-01-01", end: cutoff },
      { id: "no-dates", start: null, end: null },
      { id: "empty-dates", start: "", end: "" },
      { id: "parking", type: "parking", start: "2020-01-01", end: old },
    ]);
    expect(await pruneEndedDiscovery(db)).toBe(3);
    expect(ids()).toEqual(["boundary", "empty-dates", "no-dates", "parking"]);
  });

  it("한 회차 상한만큼만 지운다", async () => {
    const { db, ids } = fixture([1, 2, 3].map(n => ({ id: `old${n}`, start: "2020-01-01", end: old })));
    expect(await pruneEndedDiscovery(db, 2)).toBe(2);
    expect(ids()).toHaveLength(1);
  });
});
