import type { Festival, FreeEvent, LocalEvent } from "@parking/shared-types";
import { isRegionFallbackCoordinate, mapFestivalRow, mapEventRow, PERFORMANCE_EVENT_SOURCES,
  type DiscoveryItemRow } from "./discoveryCache.js";
import { mapLocalEventRow, type LocalEventRow } from "./localEvents.js";

// A per-invocation work budget, NEVER a total pin limit. Scan both tables to EOF.
export const SNAPSHOT_PAGE_SIZE = 128;
export const SNAPSHOT_PREFIX = "discovery/v1/";
const STATE_KEY = `${SNAPSHOT_PREFIX}incremental-build.json`;
const CATALOG_KEY = `${SNAPSHOT_PREFIX}catalog.json`;
const STATUS_KEY = `${SNAPSHOT_PREFIX}status.json`;
export const MANIFEST_KEY = `${SNAPSHOT_PREFIX}manifest.json`;
const MAX_PART_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_BUILD_AGE_MS = 2 * 60 * 60 * 1000;
const QUEUE_BUDGET_KEY = `${SNAPSHOT_PREFIX}queue-budget.json`;
// Baseline worst case: 7,446 queue operations/day. Reserve 2,100 for publication,
// leaving 454 for retries. Exhaustion delays changes; it never removes public pins.
const MAX_DAILY_SNAPSHOT_MESSAGES = 700;

async function enqueue(env: Required<SnapshotEnvironment>, job: SnapshotJob): Promise<void> {
  const bucket = env.DISCOVERY_SNAPSHOTS;
  const day = new Date().toISOString().slice(0, 10);
  for (let attempt = 0; attempt < 3; attempt++) {
    const object = await bucket.get(QUEUE_BUDGET_KEY);
    const previous = object ? await object.json<{ day: string; count: number }>() : null;
    const count = previous?.day === day ? previous.count : 0;
    if (count >= MAX_DAILY_SNAPSHOT_MESSAGES) {
      await bucket.put(STATUS_KEY, JSON.stringify({ schemaVersion: 1, healthy: false,
        checkedAt: new Date().toISOString(), error: "publication_queue_budget",
        retryAt: new Date(new Date().setUTCHours(24, 1, 0, 0)).toISOString() }));
      return;
    }
    const saved = await bucket.put(QUEUE_BUDGET_KEY, JSON.stringify({ day, count: count + 1 }), {
      onlyIf: object ? { etagMatches: object.etag } : { etagDoesNotMatch: "*" },
    });
    if (saved) { await env.BACKGROUND_QUEUE.send(job); return; }
  }
  // Another invocation reserved work concurrently. The durable checkpoint remains;
  // the minute sweep can enqueue it later without poisoning global health.
}

export interface SnapshotPart {
  schemaVersion: 1;
  festivals: Festival[];
  performanceEvents: FreeEvent[];
  localEvents: LocalEvent[];
}
export interface SnapshotFile { sha256: string; bytes: number; count: number }
export interface SnapshotManifest {
  schemaVersion: 1;
  version: string;
  generatedAt: string;
  parts: SnapshotFile[];
  count: number;
  revision?: number;
}
interface DirtySection { kind: "discovery" | "local"; bucket: number; revision: number; changed_at: string }
interface Catalog extends SnapshotManifest {
  sections: Record<string, SnapshotFile[]>;
  ready: boolean;
  revision: number;
}
interface BuildState {
  format: 2;
  version: string;
  generatedAt: string;
  phase: "scan" | "publish" | "complete";
  section: DirtySection;
  cursor: string;
  parts: SnapshotFile[];
  count: number;
  rowsRead: number;
  catalogRevision: number;
}
export type SnapshotJob = { type: "discovery-snapshot"; version?: string; force?: boolean; allowEmpty?: boolean };
export interface SnapshotEnvironment {
  DB?: D1Database;
  DISCOVERY_SNAPSHOTS?: R2Bucket;
  BACKGROUND_QUEUE?: { send(body: SnapshotJob): Promise<unknown> };
}

export function snapshotItems(rows: DiscoveryItemRow[], _at: Date): SnapshotPart {
  const part: SnapshotPart = { schemaVersion: 1, festivals: [], performanceEvents: [], localEvents: [] };
  for (const row of rows) {
    if (row.type !== "festival" || !validCoordinate(row.lat, row.lng)
      || isRegionFallbackCoordinate(row.lat, row.lng)) continue;
    // Public DTOs only; raw_payload/reviewer notes must never enter public storage.
    // Status is recomputed on-device. Stabilize it here so midnight alone doesn't change hashes.
    part.festivals.push({ ...mapFestivalRow(row, row.lat, row.lng), status: "upcoming" });
    if (PERFORMANCE_EVENT_SOURCES.has(row.source)) {
      part.performanceEvents.push({ ...mapEventRow(row, row.lat, row.lng), status: "upcoming" });
    }
  }
  return part;
}
export function snapshotLocalItems(rows: LocalEventRow[]): SnapshotPart {
  return { schemaVersion: 1, festivals: [], performanceEvents: [], localEvents: rows
    .filter(row => row.status === "approved" && validCoordinate(row.lat, row.lng))
    .map(row => mapLocalEventRow(row, row.lat!, row.lng!)) };
}
function validCoordinate(lat: number | null, lng: number | null): boolean {
  return lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0);
}
export async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(data).buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
function encoded(value: unknown, max: number): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  // Retain previous release on budget failure. Never silently truncate results.
  if (bytes.length > max) throw new Error("snapshot_size_budget_exceeded");
  return bytes;
}

/** A persistent R2 checkpoint serializes publishers; D1 triggers are the outbox.
 * Rebuild only an indexed fixed section, preserving all other content hashes. */
export async function runSnapshotJob(env: SnapshotEnvironment, job: SnapshotJob): Promise<void> {
  const bucket = env.DISCOVERY_SNAPSHOTS;
  const db = env.DB;
  const queue = env.BACKGROUND_QUEUE;
  if (!bucket || !db || !queue) throw new Error("snapshot_bindings_not_configured");
  const healthObject = await bucket.get(STATUS_KEY);
  const health = healthObject ? await healthObject.json<{ retryAt?: string }>() : null;
  if (health?.retryAt && Date.parse(health.retryAt) > Date.now()) return;
  try {
    await advanceSnapshot(env as Required<SnapshotEnvironment>, job);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
    const quota = /daily.*limit|daily.*quota/i.test(message + cause);
    const retryAt = quota
      ? new Date(new Date().setUTCHours(24, 1, 0, 0)).toISOString()
      : new Date(Date.now() + 60_000).toISOString();
    await bucket.put(STATUS_KEY, JSON.stringify({ schemaVersion: 1, healthy: false, retryAt,
      checkedAt: new Date().toISOString(), error: quota ? "database_daily_limit" : "publication_failed" }),
      { httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=30" } });
    throw error;
  }
}

async function advanceSnapshot(env: Required<SnapshotEnvironment>, job: SnapshotJob): Promise<void> {
  const { DB: db, DISCOVERY_SNAPSHOTS: bucket } = env;
  const object = await bucket.get(STATE_KEY);
  const current = object ? await object.json<BuildState>() : null;
  if (!job.version) {
    if (current?.format === 2 && current.phase !== "complete"
      && Date.now() - Date.parse(current.generatedAt) < MAX_BUILD_AGE_MS) {
      await enqueue(env, { type: "discovery-snapshot", version: current.version });
      return;
    }
    // Partial index contains only dirty sections. The heartbeat never scans event tables.
    // Earliest change wins within a layer: a hot section cannot starve another.
    const pending = await db.prepare(`SELECT kind,bucket,revision,changed_at FROM snapshot_sections
      WHERE revision > published_revision
      ORDER BY CASE kind WHEN 'local' THEN 0 ELSE 1 END, changed_at, bucket LIMIT 1`)
      .first<DirtySection>();
    if (!pending) {
      await bucket.put(STATUS_KEY, JSON.stringify({ schemaVersion: 1, healthy: true,
        pending: false, checkedAt: new Date().toISOString() }),
        { httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=30" } });
      return;
    }
    // Coalesce ordinary collection writes for up to 2 minutes. Local/merchant rows
    // are eligible at the next minute; never block local changes behind this debounce.
    const catalogObject = await bucket.get(CATALOG_KEY);
    const catalog = catalogObject ? await catalogObject.json<Catalog>() : null;
    if (catalog?.ready && pending.kind === "discovery" && !job.force
      && Date.now() - Date.parse(pending.changed_at) < 120_000) {
      await bucket.put(STATUS_KEY, JSON.stringify({ schemaVersion: 1, healthy: true,
        pending: true, pendingSince: pending.changed_at, checkedAt: new Date().toISOString() }));
      return;
    }
    const state: BuildState = { format: 2, version: crypto.randomUUID(), generatedAt: new Date().toISOString(),
      phase: "scan", section: pending, cursor: "", parts: [], count: 0, rowsRead: 0,
      catalogRevision: catalog?.revision ?? 0 };
    const saved = await bucket.put(STATE_KEY, encoded(state, MAX_MANIFEST_BYTES), {
      onlyIf: object ? { etagMatches: object.etag } : { etagDoesNotMatch: "*" },
    });
    if (saved) await enqueue(env, { type: "discovery-snapshot", version: state.version });
    return;
  }
  if (!current || current.format !== 2 || current.version !== job.version || current.phase === "complete") return;
  if (Date.now() - Date.parse(current.generatedAt) >= MAX_BUILD_AGE_MS) throw new Error("snapshot_build_expired");
  if (current.phase === "publish") {
    const oldObject = await bucket.get(CATALOG_KEY);
    const old = oldObject ? await oldObject.json<Catalog>() : null;
    if ((old?.revision ?? 0) !== current.catalogRevision && old?.version !== current.version) return;
    const sectionKey = `${current.section.kind}:${current.section.bucket}`;
    // Internal-only source changes may mark a section dirty without changing its DTOs.
    const unchanged = old?.sections[sectionKey] !== undefined
      && JSON.stringify(old.sections[sectionKey]) === JSON.stringify(current.parts);
    const sections = { ...(old?.sections ?? {}), [sectionKey]: current.parts };
    const ready = Object.keys(sections).length === 128; // all 64 buckets in both layers, including empty ones
    const parts = Object.keys(sections).sort().flatMap(key => sections[key]);
    const count = parts.reduce((sum, part) => sum + part.count, 0);
    if (parts.reduce((sum, part) => sum + part.bytes, 0) > 128 * 1024 * 1024
      || new Set(parts.map(part => part.sha256)).size !== parts.length) throw new Error("snapshot_client_budget_exceeded");
    const catalog: Catalog = old && (old.version === current.version || unchanged) ? old : {
      schemaVersion: 1, version: current.version, generatedAt: current.generatedAt,
      parts, count, sections, ready, revision: current.catalogRevision + 1,
    };
    if (old?.version !== current.version && !unchanged) {
      const saved = await bucket.put(CATALOG_KEY, encoded(catalog, MAX_MANIFEST_BYTES), {
        onlyIf: oldObject ? { etagMatches: oldObject.etag } : { etagDoesNotMatch: "*" },
      });
      if (!saved) return; // another publisher won; its checkpoint/recovery owns completion
    }
    if (catalog.ready) {
      const previousObject = await bucket.get(MANIFEST_KEY);
      const previous = previousObject ? await previousObject.json<SnapshotManifest>() : null;
      // Monotonic catalog revisions prevent delayed retries rolling back public data.
      if (!previous || (previous.revision ?? 0) < catalog.revision) {
        const publicData: SnapshotManifest = { schemaVersion: 1, version: catalog.version,
          generatedAt: catalog.generatedAt, revision: catalog.revision, parts: catalog.parts, count: catalog.count };
        const saved = await bucket.put(MANIFEST_KEY, encoded(publicData, MAX_MANIFEST_BYTES), {
          onlyIf: previousObject ? { etagMatches: previousObject.etag } : { etagDoesNotMatch: "*" },
          httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "public, max-age=30" },
        });
        if (!saved) return; // expected duplicate delivery, not a service outage
      }
    }
    // Do not clear a concurrent newer change. Generations never reset or get deleted.
    await db.prepare(`UPDATE snapshot_sections SET published_revision = MAX(published_revision, ?)
      WHERE kind = ? AND bucket = ?`).bind(current.section.revision, current.section.kind, current.section.bucket).run();
    const completed = await bucket.put(STATE_KEY, encoded({ ...current, phase: "complete" }, MAX_MANIFEST_BYTES),
      { onlyIf: { etagMatches: object!.etag } });
    console.log(JSON.stringify({ event: catalog.ready ? "snapshot_published" : "snapshot_bootstrap_section",
      version: catalog.version, section: sectionKey, count: catalog.count, parts: catalog.parts.length,
      rowsRead: current.rowsRead, revision: catalog.revision }));
    if (completed) await advanceSnapshot(env, { type: "discovery-snapshot" });
    return;
  }
  const table = current.section.kind === "discovery" ? "discovery_items" : "local_events";
  // Composite index bounds the read to this bucket and the unprocessed suffix.
  const result = await db.prepare(`SELECT * FROM ${table} WHERE snapshot_bucket = ? AND id > ? ORDER BY id LIMIT ?`)
    .bind(current.section.bucket, current.cursor, SNAPSHOT_PAGE_SIZE).all<DiscoveryItemRow | LocalEventRow>();
  if (!result.success) throw new Error("snapshot_section_read_failed");
  const rows = result.results ?? [];
  const part = current.section.kind === "discovery"
    ? snapshotItems(rows as DiscoveryItemRow[], new Date(current.generatedAt))
    : snapshotLocalItems(rows as LocalEventRow[]);
  const next: BuildState = { ...current, parts: [...current.parts],
    rowsRead: current.rowsRead + (result.meta.rows_read ?? rows.length) };
  const count = part.festivals.length + part.performanceEvents.length + part.localEvents.length;
  if (count) {
    const data = encoded(part, MAX_PART_BYTES);
    const hash = await sha256(data);
    await bucket.put(`${SNAPSHOT_PREFIX}parts/${hash}.json`, data, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "public, max-age=31536000, immutable" },
    });
    next.parts.push({ sha256: hash, bytes: data.length, count });
    next.count += count;
  }
  if (rows.length < SNAPSHOT_PAGE_SIZE) next.phase = "publish";
  else {
    next.cursor = rows[rows.length - 1].id;
    if (next.cursor <= current.cursor) throw new Error("snapshot_cursor_not_advancing");
  }
  const saved = await bucket.put(STATE_KEY, encoded(next, MAX_MANIFEST_BYTES), { onlyIf: { etagMatches: object!.etag } });
  if (saved) await enqueue(env, { type: "discovery-snapshot", version: current.version });
}

/** Public delivery NEVER consults D1, including on cache miss/outage. */
export async function serveSnapshot(request: Request, bucket?: R2Bucket): Promise<Response> {
  if (!bucket) return Response.json({ error: "snapshot_not_ready" }, { status: 503, headers: { "Retry-After": "300" } });
  const path = new URL(request.url).pathname;
  const hash = path.match(/^\/api\/discovery-snapshot\/parts\/([a-f0-9]{64})\.json$/)?.[1];
  const isManifest = path === "/api/discovery-snapshot/manifest.json";
  const isStatus = path === "/api/discovery-snapshot/status.json";
  if (!isManifest && !isStatus && !hash) return new Response(null, { status: 404 });
  const object = await bucket.get(isManifest ? MANIFEST_KEY : isStatus ? STATUS_KEY : `${SNAPSHOT_PREFIX}parts/${hash}.json`);
  if (!object) return Response.json({ error: isManifest ? "snapshot_not_ready" : "snapshot_part_missing" },
    { status: isManifest ? 503 : 404, headers: { "Retry-After": "300", "Cache-Control": "no-store" } });
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "ETag": object.httpEtag,
    "Cache-Control": (isManifest || isStatus) ? "public, max-age=30" : "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff" });
  if (request.headers.get("If-None-Match") === object.httpEtag) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
}
