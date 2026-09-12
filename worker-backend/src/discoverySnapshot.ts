import type { Festival, FreeEvent, LocalEvent } from "@parking/shared-types";
import { isRegionFallbackCoordinate, mapFestivalRow, mapEventRow, PERFORMANCE_EVENT_SOURCES,
  type DiscoveryItemRow } from "./discoveryCache.js";
import { mapLocalEventRow, type LocalEventRow } from "./localEvents.js";

// A per-invocation work budget, NEVER a total pin limit. Scan both tables to EOF.
export const SNAPSHOT_PAGE_SIZE = 128;
export const SNAPSHOT_PREFIX = "discovery/v1/";
const STATE_KEY = `${SNAPSHOT_PREFIX}build.json`;
export const MANIFEST_KEY = `${SNAPSHOT_PREFIX}manifest.json`;
const MAX_PART_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_BUILD_AGE_MS = 2 * 60 * 60 * 1000;

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
}
interface BuildState extends SnapshotManifest {
  allowEmpty?: boolean;
  phase: "discovery" | "local" | "publish" | "complete";
  cursor: string;
  rowsRead: number;
}
export type SnapshotJob = { type: "discovery-snapshot"; version?: string; force?: boolean; allowEmpty?: boolean };
export interface SnapshotEnvironment {
  DB?: D1Database;
  DISCOVERY_SNAPSHOTS?: R2Bucket;
  BACKGROUND_QUEUE?: { send(body: SnapshotJob): Promise<unknown> };
}

export function snapshotItems(rows: DiscoveryItemRow[], at: Date): SnapshotPart {
  const part: SnapshotPart = { schemaVersion: 1, festivals: [], performanceEvents: [], localEvents: [] };
  const minSeen = new Date(at.getTime() - 100 * 86400000).toISOString();
  for (const row of rows) {
    if (row.type !== "festival" || row.last_seen_at < minSeen || !validCoordinate(row.lat, row.lng)
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
function publicManifest(state: BuildState): SnapshotManifest {
  return { schemaVersion: 1, version: state.version, generatedAt: state.generatedAt,
    parts: state.parts, count: state.count };
}

/** One bounded page per invocation; R2 CAS checkpoints tolerate duplicate delivery.
 * Queue send errors propagate so retries resume the checkpoint, not the entire scan. */
export async function runSnapshotJob(env: SnapshotEnvironment, job: SnapshotJob): Promise<void> {
  const bucket = env.DISCOVERY_SNAPSHOTS;
  const queue = env.BACKGROUND_QUEUE;
  if (!bucket || !queue || !env.DB) throw new Error("snapshot_bindings_not_configured");
  const object = await bucket.get(STATE_KEY);
  const current = object ? await object.json<BuildState>() : null;
  if (!job.version) {
    if (!job.force && current && current.phase !== "complete" && Date.now() - Date.parse(current.generatedAt) < MAX_BUILD_AGE_MS) {
      await queue.send({ type: "discovery-snapshot", version: current.version });
      return;
    }
    if (!job.force && current?.phase === "complete"
      && current.generatedAt.slice(0, 10) === new Date().toISOString().slice(0, 10)) return;
    const state: BuildState = { schemaVersion: 1, version: crypto.randomUUID(), generatedAt: new Date().toISOString(),
      phase: "discovery", cursor: "", parts: [], count: 0, rowsRead: 0, allowEmpty: job.allowEmpty === true };
    const saved = await bucket.put(STATE_KEY, encoded(state, MAX_MANIFEST_BYTES), {
      onlyIf: object ? { etagMatches: object.etag } : { etagDoesNotMatch: "*" },
    });
    if (saved) await queue.send({ type: "discovery-snapshot", version: state.version });
    return;
  }
  if (!current || current.version !== job.version || current.phase === "complete") return;
  if (Date.now() - Date.parse(current.generatedAt) >= MAX_BUILD_AGE_MS) throw new Error("snapshot_build_expired");
  if (current.phase === "publish") {
    const manifest = publicManifest(current);
    const previousObject = await bucket.get(MANIFEST_KEY);
    const previous = previousObject ? await previousObject.json<SnapshotManifest>() : null;
    if (previous && Date.parse(previous.generatedAt) > Date.parse(current.generatedAt)) return;
    if (previous && previous.count > 0 && manifest.count === 0 && !current.allowEmpty) throw new Error("snapshot_unexpected_empty_release");
    if (manifest.parts.reduce((sum, part) => sum + part.bytes, 0) > 128 * 1024 * 1024
      || new Set(manifest.parts.map(part => part.sha256)).size !== manifest.parts.length) {
      throw new Error("snapshot_client_budget_exceeded");
    }
    const published = await bucket.put(MANIFEST_KEY, encoded(manifest, MAX_MANIFEST_BYTES), {
      onlyIf: previousObject ? { etagMatches: previousObject.etag } : { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "public, max-age=300" },
    });
    if (!published) throw new Error("snapshot_publish_conflict");
    await bucket.put(STATE_KEY, encoded({ ...current, phase: "complete" }, MAX_MANIFEST_BYTES), { onlyIf: { etagMatches: object!.etag } });
    console.log(JSON.stringify({ event: "snapshot_published", version: current.version,
      count: current.count, parts: current.parts.length, rowsRead: current.rowsRead }));
    return;
  }
  let part: SnapshotPart;
  let ids: string[];
  let readCount: number;
  // PK range bounds rows read. No bbox/type/date predicate, OFFSET or repeated sort.
  if (current.phase === "discovery") {
    const result = await env.DB.prepare("SELECT * FROM discovery_items WHERE id > ? ORDER BY id LIMIT ?")
      .bind(current.cursor, SNAPSHOT_PAGE_SIZE).all<DiscoveryItemRow>();
    if (!result.success) throw new Error("snapshot_discovery_read_failed");
    const rows = result.results ?? [];
    ids = rows.map(row => row.id);
    readCount = result.meta.rows_read ?? rows.length;
    part = snapshotItems(rows, new Date(current.generatedAt));
  } else {
    const result = await env.DB.prepare("SELECT * FROM local_events WHERE id > ? ORDER BY id LIMIT ?")
      .bind(current.cursor, SNAPSHOT_PAGE_SIZE).all<LocalEventRow>();
    if (!result.success) throw new Error("snapshot_local_read_failed");
    const rows = result.results ?? [];
    ids = rows.map(row => row.id);
    readCount = result.meta.rows_read ?? rows.length;
    part = snapshotLocalItems(rows);
  }
  const next: BuildState = { ...current, parts: [...current.parts], rowsRead: current.rowsRead + readCount };
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
  if (ids.length < SNAPSHOT_PAGE_SIZE) {
    next.phase = current.phase === "discovery" ? "local" : "publish";
    next.cursor = "";
  } else {
    next.cursor = ids[ids.length - 1];
    if (next.cursor <= current.cursor) throw new Error("snapshot_cursor_not_advancing");
  }
  const saved = await bucket.put(STATE_KEY, encoded(next, MAX_MANIFEST_BYTES), { onlyIf: { etagMatches: object!.etag } });
  if (saved) await queue.send({ type: "discovery-snapshot", version: current.version });
}

/** Public delivery NEVER consults D1, including on cache miss/outage. */
export async function serveSnapshot(request: Request, bucket?: R2Bucket): Promise<Response> {
  if (!bucket) return Response.json({ error: "snapshot_not_ready" }, { status: 503, headers: { "Retry-After": "300" } });
  const path = new URL(request.url).pathname;
  const hash = path.match(/^\/api\/discovery-snapshot\/parts\/([a-f0-9]{64})\.json$/)?.[1];
  const isManifest = path === "/api/discovery-snapshot/manifest.json";
  if (!isManifest && !hash) return new Response(null, { status: 404 });
  const object = await bucket.get(isManifest ? MANIFEST_KEY : `${SNAPSHOT_PREFIX}parts/${hash}.json`);
  if (!object) return Response.json({ error: isManifest ? "snapshot_not_ready" : "snapshot_part_missing" },
    { status: isManifest ? 503 : 404, headers: { "Retry-After": "300", "Cache-Control": "no-store" } });
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "ETag": object.httpEtag,
    "Cache-Control": isManifest ? "public, max-age=300" : "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff" });
  if (request.headers.get("If-None-Match") === object.httpEtag) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
}
