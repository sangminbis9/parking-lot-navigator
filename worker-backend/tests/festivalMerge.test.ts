import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import { mergeFestivalFields, type DiscoveryItemRow } from "../src/discoveryCache.js";
import { snapshotItems } from "../src/discoverySnapshot.js";
import { runFestivalMerge } from "../src/festivalMerge.js";
import type { Festival } from "@parking/shared-types";

function row(id: string, extra: Partial<DiscoveryItemRow> = {}): DiscoveryItemRow {
  return { id, type: "festival", source: "tourapi", source_item_id: `item:${id}`,
    title: "2026 수원꼬치페스타", start_date: "2026-10-03", end_date: "2026-10-05", status: "upcoming",
    lat: 37.2801, lng: 127.0102, last_seen_at: "2026-09-26T00:00:00Z", subtitle: null, category_text: null,
    is_free: null, venue_name: null, address: "경기 수원시", rating: null, review_count: null,
    lowest_price_text: null, lowest_price_platform: null, source_url: null, image_url: null, images_json: null,
    tags_json: null, amenities_json: null, offers_json: null, raw_payload: null, data_updated_at: null,
    primary_category: null, category_tags_json: null, merged_into: null, merge_donors_json: null,
    merge_title_key: null, merge_word_key: null, ...extra };
}

function fixture(rows: DiscoveryItemRow[]) {
  const sqlite = new DatabaseSync(":memory:");
  const { merged_into: _a, merge_donors_json: _b, merge_title_key: _c, merge_word_key: _d, ...base } =
    row("x");
  sqlite.exec(`CREATE TABLE discovery_items (${Object.keys(base).map(key => key + (key === "id" ? " TEXT PRIMARY KEY" : "")).join(",")})`);
  // 0032 트리거가 local_events에도 걸리므로 테이블만 둔다(이 테스트는 그 트리거를 쓰지 않는다).
  sqlite.exec("CREATE TABLE local_events (id TEXT PRIMARY KEY)");
  sqlite.exec(readFileSync(new URL("../migrations/0032_incremental_snapshots.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0034_festival_merge.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0035_festival_merge_keys.sql", import.meta.url), "utf8"));
  for (const data of rows) {
    const entries = Object.entries(data);
    sqlite.prepare(`INSERT INTO discovery_items (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`)
      .run(...entries.map(([, value]) => value as string | number | null));
  }
  const db = {
    prepare(query: string) {
      const statement = sqlite.prepare(query);
      const bound = (args: (string | number | null)[] = []) => ({
        bind: (...next: (string | number | null)[]) => bound(next),
        all: async () => ({ results: statement.all(...args) }),
        run: async () => statement.run(...args),
      });
      return bound();
    },
    async batch(statements: { run(): Promise<unknown> }[]) {
      for (const statement of statements) await statement.run();
    },
  } as unknown as D1Database;
  const all = () => sqlite.prepare("SELECT * FROM discovery_items ORDER BY id").all() as unknown as DiscoveryItemRow[];
  return { sqlite, db, all };
}

const NOW = new Date("2026-09-26T03:00:00Z");

// 키가 빈 행을 채운 회차는 묶지 않으므로, 키가 다 찬 뒤의 첫 결과를 돌려준다.
async function merge(db: D1Database) {
  for (;;) {
    const result = await runFestivalMerge(db, NOW);
    if (result.keysFilled === 0) return result;
  }
}

describe("festival merge pipeline", () => {
  it("marks donors, stores donor fields on the canonical row, and is idempotent", async () => {
    const f = fixture([
      row("a", { image_url: "https://img.example/a.jpg", raw_payload: JSON.stringify({ description: "수원 꼬치 축제를 소개하는 짧은 설명 문장입니다 여기" }) }),
      row("b", { source: "city-scraped", lat: 37.2802, raw_payload: JSON.stringify({ description: "수원 꼬치 축제를 소개하는 훨씬 더 긴 설명 문장이고 프로그램도 적혀 있습니다" }) }),
      row("c", { title: "다른 축제" }),
    ]);
    const first = await merge(f.db);
    expect(first).toMatchObject({ clusters: 1, mergedRows: 1, updated: 2 });
    const rows = f.all();
    const canonical = rows.find(r => !r.merged_into && r.merge_donors_json)!;
    const donor = rows.find(r => r.merged_into)!;
    expect(donor.merged_into).toBe(canonical.id);
    expect(rows.find(r => r.id === "c")).toMatchObject({ merged_into: null, merge_donors_json: null });

    const part = snapshotItems(rows, new Date());
    const festivals = part.festivals.filter(item => item.title === "2026 수원꼬치페스타");
    expect(festivals).toHaveLength(1);
    expect(festivals[0].imageUrl).toBe("https://img.example/a.jpg");
    expect(festivals[0].description).toBe("수원 꼬치 축제를 소개하는 훨씬 더 긴 설명 문장이고 프로그램도 적혀 있습니다");

    expect((await merge(f.db)).updated).toBe(0);
  });

  it("clears stale marks when the rows no longer cluster", async () => {
    const f = fixture([row("a"), row("b", { source: "city-scraped" })]);
    await merge(f.db);
    f.sqlite.exec("UPDATE discovery_items SET title = '전혀 다른 행사', start_date = '2027-01-01', end_date = '2027-01-02' WHERE id = 'b'");
    const result = await merge(f.db);
    expect(result).toMatchObject({ clusters: 0, updated: 2 });
    expect(f.all().every(r => r.merged_into === null && r.merge_donors_json === null)).toBe(true);
  });

  it("resets stored title keys when the title changes", async () => {
    const f = fixture([row("a"), row("b", { source: "city-scraped" })]);
    expect((await runFestivalMerge(f.db, NOW)).keysFilled).toBe(2);
    expect(f.all().every(r => r.merge_title_key !== null)).toBe(true);
    f.sqlite.exec("UPDATE discovery_items SET title = '다른 제목' WHERE id = 'a'");
    const keysOf = (id: string) => f.all().find(r => r.id === id)!;
    expect(keysOf("a").merge_title_key).toBeNull();
    expect(keysOf("b").merge_title_key).not.toBeNull();
  });

  it("leaves consistent clusters alone outside their refresh hour", async () => {
    const f = fixture([row("a"), row("b", { source: "city-scraped" })]);
    await merge(f.db);
    const results = [];
    for (let hour = 0; hour < 24; hour += 1) {
      results.push(await runFestivalMerge(f.db, new Date(Date.UTC(2026, 8, 26, hour))));
    }
    expect(results.filter(r => r.recomputed > 0)).toHaveLength(1);
    expect(results.every(r => r.updated === 0)).toBe(true);
  });

  it("bumps the snapshot section when merge columns change", async () => {
    const f = fixture([row("a"), row("b", { source: "city-scraped" })]);
    const revisions = () => (f.sqlite.prepare("SELECT COALESCE(SUM(revision), 0) AS total FROM snapshot_sections").get() as { total: number }).total;
    const before = revisions();
    await merge(f.db);
    expect(revisions()).toBeGreaterThan(before);
  });
});

describe("mergeFestivalFields", () => {
  const base = { id: "1", title: "축제", subtitle: null, description: "짧음", startDate: "2026-10-01", endDate: "2026-10-02",
    status: "upcoming", venueName: null, address: "주소", lat: 37, lng: 127, distanceMeters: 0, source: "tourapi",
    sourceUrl: null, imageUrl: null, imageUrls: [], tags: ["a"], primaryCategory: null, categoryTags: [],
    admissionFee: null, discountInfo: null, bookingInfo: null, contactPhone: null, ageLimit: null, programInfo: null,
    organizerName: null } as unknown as Festival;

  it("fills empty fields, prefers longer text and lists, keeps identity fields", () => {
    const merged = mergeFestivalFields(base, [{ id: "2", lat: 38, source: "kopis", description: "더 긴 설명입니다",
      address: "다른 주소", venueName: "공연장", imageUrl: "https://img.example/b.jpg", tags: ["a", "b"], admissionFee: "무료" }]);
    expect(merged).toMatchObject({ id: "1", lat: 37, source: "tourapi", description: "더 긴 설명입니다",
      address: "주소", venueName: "공연장", imageUrl: "https://img.example/b.jpg", tags: ["a", "b"], admissionFee: "무료" });
  });
});
