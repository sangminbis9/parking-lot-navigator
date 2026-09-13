import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import { MANIFEST_KEY, SNAPSHOT_PREFIX, SNAPSHOT_PAGE_SIZE, runSnapshotJob, serveSnapshot,
  snapshotItems, snapshotLocalItems, type SnapshotJob, type SnapshotManifest } from "../src/discoverySnapshot.js";
import type { DiscoveryItemRow } from "../src/discoveryCache.js";
import type { LocalEventRow } from "../src/localEvents.js";
import { readFileSync } from "node:fs";

function row(n: number, extra: Partial<DiscoveryItemRow> = {}): DiscoveryItemRow {
  return { id: `id:${String(n).padStart(6, "0")}`, type: "festival", source: "test", source_item_id: `event:${n}`,
    title: `행사 ${n}`, start_date: "2026-09-13", end_date: "2026-12-31", status: "upcoming",
    lat: 37.41, lng: 126.64, last_seen_at: new Date().toISOString(), subtitle: null, category_text: null,
    is_free: null, venue_name: null, address: "인천", rating: null, review_count: null,
    lowest_price_text: null, lowest_price_platform: null, source_url: null, image_url: null, images_json: null,
    tags_json: null, amenities_json: null, offers_json: null, raw_payload: null, data_updated_at: null,
    primary_category: null, category_tags_json: null, ...extra };
}
function local(extra: Partial<LocalEventRow> = {}): LocalEventRow {
  return { id: "local:1", title: "지역 행사", description: null, short_description: null, benefit: null,
    event_type: "popup", status: "approved", source: "official_site", source_url: null, source_item_id: null,
    image_url: null, store_name: "가게", address: "인천", lat: 37.41, lng: 126.64, start_date: "2026-09-13",
    end_date: null, confidence_score: 1, needs_review: 0, is_sponsored: 0, sponsor_tier: null,
    paid_until: null, priority_score: 0, updated_at: "2026-09-13T00:00:00Z", primary_category: null,
    category_tags_json: null, ...extra };
}

// SQLite exercises the actual invalidation triggers and range queries.
function fixture(rows: DiscoveryItemRow[] = [], locals: LocalEventRow[] = []) {
  const sqlite = new DatabaseSync(":memory:");
  for (const [table, sample] of [["discovery_items", row(0)], ["local_events", local()]] as const) {
    sqlite.exec(`CREATE TABLE ${table} (${Object.keys(sample).map(key => key + (key === "id" ? " TEXT PRIMARY KEY" : "")).join(",")})`);
  }
  sqlite.exec(readFileSync(new URL("../migrations/0032_incremental_snapshots.sql", import.meta.url), "utf8"));
  function insert(table: string, data: object) {
    const entries = Object.entries(data);
    sqlite.prepare(`INSERT INTO ${table} (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`).run(...entries.map(([, value]) => value));
  }
  rows.forEach(row => insert("discovery_items", row));
  locals.forEach(row => insert("local_events", row));
  let sequence = 0, rowsRead = 0;
  const objects = new Map<string, { text: string; etag: string }>();
  const sql: string[] = [];
  const get = vi.fn(async (key: string) => {
    const stored = objects.get(key);
    return stored ? { ...stored, httpEtag: `"${stored.etag}"`, body: new Response(stored.text).body,
      json: async () => JSON.parse(stored.text) } : null;
  });
  const put = vi.fn(async (key: string, value: string | Uint8Array, options?: R2PutOptions) => {
    const previous = objects.get(key);
    const condition = options?.onlyIf as R2Conditional | undefined;
    if (condition?.etagMatches && previous?.etag !== condition.etagMatches) return null;
    if (condition?.etagDoesNotMatch === "*" && previous) return null;
    const stored = { text: typeof value === "string" ? value : new TextDecoder().decode(value), etag: String(++sequence) };
    objects.set(key, stored); return stored;
  });
  const db = { prepare(query: string) {
    sql.push(query);
    const statement = sqlite.prepare(query);
    function bound(args: (string | number)[] = []) {
      return { bind: (...args: (string | number)[]) => bound(args),
        first: async () => statement.get(...args) ?? null,
        run: async () => ({ success: true, meta: statement.run(...args) }),
        all: async () => {
          const results = statement.all(...args);
          rowsRead += results.length;
          return { success: true, results, meta: { rows_read: results.length } };
        },
      };
    }
    return bound();
  } } as unknown as D1Database;
  const queue: SnapshotJob[] = [];
  const send = vi.fn(async (job: SnapshotJob) => { queue.push(job); });
  const bucket = { get, put } as unknown as R2Bucket;
  const env = { DB: db, DISCOVERY_SNAPSHOTS: bucket, BACKGROUND_QUEUE: { send } };
  async function drain() {
    let remaining = 1000;
    while (queue.length) {
      if (--remaining === 0) throw new Error("queue did not terminate");
      await runSnapshotJob(env, queue.shift()!);
    }
  }
  async function publish() {
    sqlite.exec("UPDATE snapshot_sections SET changed_at='2020-01-01T00:00:00Z' WHERE revision>published_revision");
    await runSnapshotJob(env, { type: "discovery-snapshot", force: true }); await drain();
  }
  function manifest(): SnapshotManifest { return JSON.parse(objects.get(MANIFEST_KEY)!.text); }
  return { objects, sql, sqlite, insert, rowsRead: () => rowsRead, env, queue, send, bucket, get, put, drain, publish, manifest };
}

describe("incremental discovery snapshot", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.spyOn(console, "log").mockImplementation(() => {}); });
  it("bootstraps every section without a total cap; idle checks read no event rows", async () => {
    const f = fixture(Array.from({ length: 900 }, (_, i) => row(i, i < 128 ? { lat: 0, lng: 0 } : {})),
      [local(), local({ id: "local:2", status: "pending" })]);
    await runSnapshotJob(f.env, { type: "discovery-snapshot" });
    expect(f.objects.has(MANIFEST_KEY)).toBe(false);
    await f.drain();
    expect(f.manifest().count).toBe(773);
    expect(f.rowsRead()).toBe(902);
    const before = f.rowsRead();
    await f.publish();
    expect(f.rowsRead()).toBe(before);
    expect(f.sql.filter(query => query.startsWith("SELECT *")).every(query => query.includes("snapshot_bucket = ? AND id > ?"))).toBe(true);
  });
  it("uses the composite section index without full scans/sorts", () => {
    const f = fixture();
    const detail = f.sqlite.prepare("EXPLAIN QUERY PLAN SELECT * FROM discovery_items WHERE snapshot_bucket = ? AND id > ? ORDER BY id LIMIT ?")
      .all(1, "", SNAPSHOT_PAGE_SIZE).map(row => row.detail).join(" ");
    expect(detail).toMatch(/USING INDEX idx_discovery_items_snapshot/);
    expect(detail).not.toMatch(/SCAN|TEMP B-TREE/);
  });
  it("continues a large section past an entirely filtered page", async () => {
    const f = fixture(Array.from({ length: 600 }, (_, i) => row(i, {
      id: `id:${String(i).padStart(6, "0")}:same`, ...(i < 128 ? { lat: 0, lng: 0 } : {}),
    })));
    await f.publish();
    expect(f.manifest().count).toBe(472);
    expect(f.rowsRead()).toBe(600);
    expect(f.manifest().parts.length).toBeGreaterThan(1);
  });
  it("recovers an expired checkpoint and ignores its delayed queue delivery", async () => {
    const f = fixture([row(1)]);
    await runSnapshotJob(f.env, { type: "discovery-snapshot" });
    const oldJob = f.queue.shift()!;
    const key = `${SNAPSHOT_PREFIX}incremental-build.json`;
    const saved = f.objects.get(key)!;
    saved.text = JSON.stringify({ ...JSON.parse(saved.text), generatedAt: "2020-01-01" });
    await f.publish(); const manifest = f.manifest();
    await runSnapshotJob(f.env, oldJob);
    expect(f.manifest()).toEqual(manifest);
  });
  it("ignores collection heartbeat changes and republishes only modified section", async () => {
    const f = fixture([row(1), row(2)]);
    await f.publish(); const first = f.manifest(); const before = f.rowsRead();
    f.sqlite.exec("UPDATE discovery_items SET last_seen_at='tomorrow', data_updated_at='tomorrow'");
    await f.publish();
    expect(f.manifest()).toEqual(first); expect(f.rowsRead()).toBe(before);
    f.sqlite.exec("UPDATE discovery_items SET title='changed' WHERE id='id:000001'");
    await f.publish();
    expect(f.rowsRead() - before).toBe(1);
    expect(f.manifest().parts.filter(part => first.parts.some(old => old.sha256 === part.sha256))).toHaveLength(1);
  });
  it("does not publish a new version for private-only payload changes", async () => {
    const f = fixture([row(1)]); await f.publish(); const first = f.manifest();
    f.sqlite.exec(`UPDATE discovery_items SET raw_payload='{"internal":"ignored"}'`);
    await f.publish(); expect(f.manifest()).toEqual(first);
  });
  it("durably invalidates deletes, approval changes, and enrichment; rollback rolls back invalidation", async () => {
    const f = fixture([row(1)], [local()]); await f.publish();
    f.sqlite.exec("BEGIN; UPDATE discovery_items SET title='rollback'; ROLLBACK;");
    expect(f.sqlite.prepare("SELECT count(*) n FROM snapshot_sections WHERE revision > published_revision").get()?.n).toBe(0);
    f.sqlite.exec("UPDATE local_events SET status='rejected'; DELETE FROM discovery_items;");
    await f.publish(); expect(f.manifest().count).toBe(0);
    f.insert("discovery_items", row(5, { lat: null })); await f.publish(); expect(f.manifest().count).toBe(0);
    f.sqlite.exec("UPDATE discovery_items SET lat=37.41"); await f.publish(); expect(f.manifest().count).toBe(1);
  });
  it("preserves the first dirty time and a concurrent generation until it is published", async () => {
    const f = fixture([row(1)]); await f.publish();
    f.sqlite.exec("UPDATE discovery_items SET title='first'; UPDATE snapshot_sections SET changed_at='2020-01-01T00:00:00Z' WHERE revision>published_revision;");
    await runSnapshotJob(f.env, { type: "discovery-snapshot" });
    await runSnapshotJob(f.env, f.queue.shift()!); // scan
    f.sqlite.exec("UPDATE discovery_items SET title='second'");
    expect(f.sqlite.prepare("SELECT changed_at FROM snapshot_sections WHERE revision>published_revision").get()?.changed_at).toBe("2020-01-01T00:00:00Z");
    await f.drain();
    const parts = f.manifest().parts.map(p => f.objects.get(`${SNAPSHOT_PREFIX}parts/${p.sha256}.json`)!.text).join("");
    expect(parts).toContain("second");
    expect(f.sqlite.prepare("SELECT count(*) n FROM snapshot_sections WHERE revision>published_revision").get()?.n).toBe(0);
  });
  it("duplicate concurrent delivery cannot duplicate parts or roll back revision", async () => {
    const f = fixture([row(1)]);
    await runSnapshotJob(f.env, { type: "discovery-snapshot" });
    const job = f.queue.shift()!;
    await Promise.all([runSnapshotJob(f.env, job), runSnapshotJob(f.env, job)]);
    await f.drain(); expect(f.manifest().count).toBe(1); expect(f.manifest().parts).toHaveLength(1);
    const first = f.manifest(); await runSnapshotJob(f.env, job); expect(f.manifest()).toEqual(first);
  });
  it("concurrent publication CAS contention does not poison global health", async () => {
    const f = fixture([row(1)]);
    await runSnapshotJob(f.env, { type: "discovery-snapshot" });
    await runSnapshotJob(f.env, f.queue.shift()!);
    const publication = f.queue.shift()!;
    await Promise.all([runSnapshotJob(f.env, publication), runSnapshotJob(f.env, publication)]);
    await f.drain();
    expect(f.manifest().count).toBe(1);
    expect(JSON.parse(f.objects.get(`${SNAPSHOT_PREFIX}status.json`)!.text).healthy).toBe(true);
  });
  it("recovers queue-send failure at the checkpoint after backoff", async () => {
    const f = fixture([row(1)]);
    f.send.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(f.publish()).rejects.toThrow("queue unavailable");
    f.objects.delete(`${SNAPSHOT_PREFIX}status.json`);
    await f.publish(); expect(f.manifest().count).toBe(1); expect(f.rowsRead()).toBe(1);
  });
  it("retains public data and backs off after quota exhaustion without repeated D1 reads", async () => {
    const f = fixture([row(1)]); await f.publish(); const first = f.manifest();
    const prepare = vi.fn(() => { throw new Error("D1 daily row read limit exceeded"); });
    f.env.DB.prepare = prepare;
    await expect(f.publish()).rejects.toThrow("daily row");
    await f.publish(); expect(prepare).toHaveBeenCalledTimes(1); expect(f.manifest()).toEqual(first);
    const response = await serveSnapshot(new Request("https://e.com/api/discovery-snapshot/manifest.json"), f.bucket);
    expect(response.status).toBe(200);
  });
  it("stops sending work at the daily queue budget while preserving the checkpoint", async () => {
    const f = fixture([row(1)]);
    f.objects.set(`${SNAPSHOT_PREFIX}queue-budget.json`, { text: JSON.stringify({ day: new Date().toISOString().slice(0,10), count: 700 }), etag: "budget" });
    await f.publish(); expect(f.send).not.toHaveBeenCalled(); expect(f.objects.has(MANIFEST_KEY)).toBe(false);
    expect(JSON.parse(f.objects.get(`${SNAPSHOT_PREFIX}status.json`)!.text).error).toBe("publication_queue_budget");
  });
  it("serves ETags and hides internal data and paths", async () => {
    const f = fixture([row(1, { raw_payload: '{"secret":"private","description":"public description long enough for the existing mapper"}' })]);
    await f.publish();
    const first = await serveSnapshot(new Request("https://e.com/api/discovery-snapshot/manifest.json"), f.bucket);
    expect((await serveSnapshot(new Request("https://e.com/api/discovery-snapshot/manifest.json", { headers: { "If-None-Match": first.headers.get("ETag")! } }), f.bucket)).status).toBe(304);
    for (const path of ["catalog.json", "incremental-build.json", "queue-budget.json", "build.json"]) {
      expect((await serveSnapshot(new Request(`https://e.com/api/discovery-snapshot/${path}`), f.bucket)).status).toBe(404);
    }
    const part = f.objects.get(`${SNAPSHOT_PREFIX}parts/${f.manifest().parts[0].sha256}.json`)!.text;
    expect(part).not.toContain("secret"); expect(part).toContain("public description");
    expect((await serveSnapshot(new Request("https://e.com/api/discovery-snapshot/manifest.json"))).status).toBe(503);
  });
  it("excludes unapproved/invalid locations and keeps KOPIS in performance DTOs", () => {
    const part = snapshotItems([row(1, { source: "kopis" }), row(2, { lat: NaN })], new Date());
    expect(part.festivals).toHaveLength(1); expect(part.performanceEvents).toHaveLength(1);
    expect(snapshotLocalItems([local({ status: "rejected" }), local({ lat: null }), local()]).localEvents).toHaveLength(1);
  });
});
