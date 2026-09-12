import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import { MANIFEST_KEY, SNAPSHOT_PREFIX, SNAPSHOT_PAGE_SIZE, runSnapshotJob, serveSnapshot,
  snapshotItems, snapshotLocalItems, type SnapshotJob, type SnapshotManifest } from "../src/discoverySnapshot.js";
import type { DiscoveryItemRow } from "../src/discoveryCache.js";
import type { LocalEventRow } from "../src/localEvents.js";
import { plannedJobs } from "../src/jobs.js";

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

// Minimal platform fakes; production code uses typed native bindings.
function fixture(rows: DiscoveryItemRow[] = [], locals: LocalEventRow[] = []) {
  let sequence = 0;
  const objects = new Map<string, { text: string; etag: string }>();
  const sql: string[] = [];
  let rowsRead = 0;
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
    objects.set(key, stored);
    return stored;
  });
  const db = { prepare(query: string) {
    sql.push(query);
    return { bind(cursor: string, limit: number) {
      expect(limit).toBe(SNAPSHOT_PAGE_SIZE);
      return { all: async () => {
        const source = query.includes("local_events") ? locals : rows;
        const result = source.filter(row => row.id > cursor).sort((a, b) => a.id < b.id ? -1 : 1).slice(0, limit);
        rowsRead += result.length;
        return { success: true, results: result, meta: { rows_read: result.length } };
      } };
    } };
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
  function manifest(): SnapshotManifest { return JSON.parse(objects.get(MANIFEST_KEY)!.text); }
  return { objects, sql, rowsRead: () => rowsRead, env, queue, send, bucket, get, put, drain, manifest };
}

describe("daily discovery snapshot", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("exports beyond old pin caps, scanning each row once including filtered pages", async () => {
    const rows = Array.from({ length: 900 }, (_, i) => row(i, i < 128 ? { lat: 0, lng: 0 } : {}));
    const f = fixture(rows, [local(), local({ id: "local:2", status: "pending" })]);
    await runSnapshotJob(f.env, { type: "discovery-snapshot" });
    expect(f.objects.has(MANIFEST_KEY)).toBe(false);
    await f.drain();
    expect(f.manifest().count).toBe(773);
    expect(f.rowsRead()).toBe(902);
    expect(f.sql.every(query => /WHERE id > \? ORDER BY id LIMIT \?$/.test(query))).toBe(true);
    expect(f.sql).toHaveLength(Math.ceil(900 / 128) + 1);
    const readBefore = f.rowsRead();
    await runSnapshotJob(f.env, { type: "discovery-snapshot" });
    expect(f.rowsRead()).toBe(readBefore);
  });
  it("uses the primary-key range index in SQLite, not a repeated full scan/sort", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("CREATE TABLE discovery_items (id TEXT PRIMARY KEY, type TEXT, lat REAL, lng REAL); CREATE INDEX geo ON discovery_items(type,lat,lng)");
      const plan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM discovery_items WHERE id > ? ORDER BY id LIMIT ?").all("", 128);
      const detail = plan.map(row => row.detail).join(" ");
      expect(detail).toMatch(/SEARCH .* USING INDEX .* \(id>\?\)/);
      expect(detail).not.toMatch(/SCAN|TEMP B-TREE/);
    } finally { db.close(); }
  });
  it("retries queue-send failure from its checkpoint, not a new national scan", async () => {
    const f = fixture([row(1)]);
    await runSnapshotJob(f.env, { type: "discovery-snapshot" });
    const job = f.queue.shift()!;
    f.send.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(runSnapshotJob(f.env, job)).rejects.toThrow("queue unavailable");
    expect(f.rowsRead()).toBe(1);
    await runSnapshotJob(f.env, job);
    await f.drain();
    expect(f.rowsRead()).toBe(1);
    expect(f.manifest().count).toBe(1);
  });
  it("duplicate concurrent deliveries do not duplicate parts", async () => {
    const f = fixture([row(1)]);
    await runSnapshotJob(f.env, { type: "discovery-snapshot" });
    const job = f.queue.shift()!;
    await Promise.all([runSnapshotJob(f.env, job), runSnapshotJob(f.env, job)]);
    await f.drain();
    expect(f.manifest().parts).toHaveLength(1);
    expect(f.manifest().count).toBe(1);
  });
  it("keeps the public release on failed generation and never masks a missing table", async () => {
    const f = fixture([row(1)]);
    await runSnapshotJob(f.env, { type: "discovery-snapshot" }); await f.drain();
    const before = f.objects.get(MANIFEST_KEY)!.text;
    await runSnapshotJob(f.env, { type: "discovery-snapshot", force: true });
    f.env.DB.prepare = () => { throw new Error("D1 quota exceeded"); };
    await expect(f.drain()).rejects.toThrow("D1 quota exceeded");
    expect(f.objects.get(MANIFEST_KEY)!.text).toBe(before);
    const response = await serveSnapshot(new Request("https://example.com/api/discovery-snapshot/manifest.json"), f.bucket);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(before);
  });
  it("publishes deletions as a full replacement and reuses unchanged content hashes", async () => {
    const rows = [row(1), row(2)];
    const f = fixture(rows);
    await runSnapshotJob(f.env, { type: "discovery-snapshot" }); await f.drain();
    const first = f.manifest();
    await runSnapshotJob(f.env, { type: "discovery-snapshot", force: true }); await f.drain();
    expect(f.manifest().version).not.toBe(first.version);
    expect(f.manifest().parts).toEqual(first.parts);
    rows.pop();
    await runSnapshotJob(f.env, { type: "discovery-snapshot", force: true }); await f.drain();
    expect(f.manifest().count).toBe(1);
  });
  it("does not publish a suspicious empty replacement", async () => {
    const rows = [row(1)];
    const f = fixture(rows);
    await runSnapshotJob(f.env, { type: "discovery-snapshot" }); await f.drain();
    const version = f.manifest().version;
    rows.length = 0;
    await runSnapshotJob(f.env, { type: "discovery-snapshot", force: true });
    await expect(f.drain()).rejects.toThrow("snapshot_unexpected_empty_release");
    expect(f.manifest().version).toBe(version);
  });
  it("serves ETags, rejects private/arbitrary paths, and never exports raw payloads", async () => {
    const f = fixture([row(1, { raw_payload: '{"secret":"private","description":"public description long enough for the existing mapper"}' })]);
    await runSnapshotJob(f.env, { type: "discovery-snapshot" }); await f.drain();
    const first = await serveSnapshot(new Request("https://e.com/api/discovery-snapshot/manifest.json"), f.bucket);
    expect((await serveSnapshot(new Request("https://e.com/api/discovery-snapshot/manifest.json", {
      headers: { "If-None-Match": first.headers.get("ETag")! },
    }), f.bucket)).status).toBe(304);
    expect((await serveSnapshot(new Request("https://e.com/api/discovery-snapshot/build.json"), f.bucket)).status).toBe(404);
    const part = f.objects.get(`${SNAPSHOT_PREFIX}parts/${f.manifest().parts[0].sha256}.json`)!.text;
    expect(part).not.toContain("secret"); expect(part).not.toContain("raw_payload");
    expect(part).toContain("public description");
    expect((await serveSnapshot(new Request("https://e.com/api/discovery-snapshot/manifest.json"))).status).toBe(503);
  });
  it("excludes unapproved/invalid locations and keeps KOPIS in performance DTOs", () => {
    const part = snapshotItems([row(1, { source: "kopis" }), row(2, { lat: NaN })], new Date());
    expect(part.festivals).toHaveLength(1); expect(part.performanceEvents).toHaveLength(1);
    expect(snapshotLocalItems([local({ status: "rejected" }), local({ lat: null }), local()]).localEvents).toHaveLength(1);
  });
  it("schedules one daily publish plus two recovery checks after quota reset", () => {
    for (const minute of [7, 17, 37]) {
      expect(plannedJobs(new Date(`2026-09-13T01:${String(minute).padStart(2, "0")}:00Z`)))
        .toContainEqual({ type: "discovery-snapshot" });
    }
  });
});
