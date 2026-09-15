import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const check = (condition, message) => { if (!condition) throw new Error(message); };
const hash = data => createHash("sha256").update(data).digest("hex");
const rootURL = value => {
  const url = new URL(`${value.replace(/\/$/, "")}/`);
  check(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash, "Invalid HTTPS data root");
  return url;
};
export function validateManifest(raw) {
  check(raw?.schemaVersion === 1 && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(raw.version)
    && Number.isSafeInteger(raw.revision) && raw.revision >= 0 && Number.isFinite(Date.parse(raw.generatedAt))
    && Array.isArray(raw.parts) && raw.parts.length <= 9000, "Invalid manifest");
  let bytes = 0, count = 0;
  const parts = raw.parts.map(p => {
    check(/^[a-f0-9]{64}$/.test(p.sha256) && Number.isSafeInteger(p.bytes) && p.bytes > 0 && p.bytes <= 8 * 1024 * 1024
      && Number.isSafeInteger(p.count) && p.count > 0 && p.count <= 256, "Invalid descriptor");
    bytes += p.bytes; count += p.count;
    return { sha256: p.sha256, bytes: p.bytes, count: p.count };
  });
  check(bytes <= 128 * 1024 * 1024 && count === raw.count && count > 0
    && new Set(parts.map(p => p.sha256)).size === parts.length, "Invalid totals");
  // Explicit public manifest allowlist: never propagate internal catalog/checkpoint fields.
  return { schemaVersion: 1, version: raw.version, revision: raw.revision, generatedAt: raw.generatedAt, count, parts };
}
function validatePart(data, part) {
  check(data.length === part.bytes && hash(data) === part.sha256, "Part integrity mismatch");
  const body = JSON.parse(data);
  const groups = [body.festivals, body.performanceEvents, body.localEvents];
  check(body.schemaVersion === 1 && Object.keys(body).every(k => ["schemaVersion", "festivals", "performanceEvents", "localEvents"].includes(k))
    && groups.every(Array.isArray) && groups.reduce((n, items) => n + items.length, 0) === part.count, "Invalid part shape");
  for (const item of groups.flat()) {
    check(typeof item.id === "string" && Number.isFinite(item.lat) && Number.isFinite(item.lng)
      && Math.abs(item.lat) <= 90 && Math.abs(item.lng) <= 180, "Invalid public pin");
  }
  check(!/"(?:raw_payload|rawSourcePayload|reviewer_notes|internal_notes)"\s*:/.test(data.toString()), "Private data in public DTO");
}
export async function prepareStaticSnapshot({ source, target, bootstrap = false, fetcher = fetch, now = Date.now() }) {
  source = rootURL(source); target = rootURL(target);
  const download = async (root, path, limit, optional = false) => {
    let response;
    try { response = await fetcher(new URL(path, root), { signal: AbortSignal.timeout(30_000), redirect: "error" }); }
    catch (error) { if (optional && bootstrap && root === target) return null; throw error; }
    if (optional && response.status === 404) return null;
    check(response.ok && response.body, `${path}: HTTP ${response.status}`);
    let size = 0; const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length; check(size <= limit, `${path}: oversized response`); chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };
  const manifest = validateManifest(JSON.parse(await download(source, "manifest.json", 4 * 1024 * 1024)));
  const status = JSON.parse(await download(source, "status.json", 16 * 1024));
  const previousData = await download(target, "manifest.json", 4 * 1024 * 1024, true);
  const previous = previousData ? validateManifest(JSON.parse(previousData)) : null;
  const age = now - Date.parse(status.checkedAt);
  const retryAt = Date.parse(status.retryAt);
  const expectedBudgetPause = status.schemaVersion === 1 && status.healthy === false
    && status.error === "publication_queue_budget" && Number.isFinite(age)
    && age >= -300_000 && age < 26 * 60 * 60_000 && Number.isFinite(retryAt)
    && retryAt > now && retryAt - now <= 26 * 60 * 60_000;
  if (expectedBudgetPause) {
    check(previous, "Source publisher paused before the first complete CDN release");
    return { changed: false, deferred: true, reason: status.error, retryAt: status.retryAt, manifest: previous };
  }
  check(status.schemaVersion === 1 && status.healthy === true && Number.isFinite(age) && age >= -300_000 && age < 15 * 60_000,
    `Source publisher unhealthy/stale; retaining previous deployment (error=${status.error ?? "none"}, ageMs=${Number.isFinite(age) ? age : "invalid"})`);
  check(!status.pending || now - Date.parse(status.pendingSince) < 10 * 60_000, "Source publication backlog stale");
  check(Date.parse(manifest.generatedAt) <= now + 300_000, "Future manifest");
  if (previous) {
    check(previous.revision <= manifest.revision, "Origin revision older than deployed revision");
    check(previous.revision !== manifest.revision || previous.version === manifest.version, "Conflicting revision");
    check(previous.version !== manifest.version || JSON.stringify(previous) === JSON.stringify(manifest), "Changed contents at same version");
  }
  const oldStatus = previous ? await download(target, "status.json", 16 * 1024, true) : null;
  if (previous?.version === manifest.version && oldStatus) {
    const publishedAt = Date.parse(JSON.parse(oldStatus).mirroredAt);
    if (now - publishedAt >= 0 && now - publishedAt < 10 * 60_000) return { changed: false, manifest };
  }
  const files = new Map();
  let retained = previous?.version !== manifest.version ? previous : null;
  if (previous?.version === manifest.version) {
    const data = await download(target, "previous-manifest.json", 4 * 1024 * 1024, true);
    retained = data ? validateManifest(JSON.parse(data)) : null;
    check(!retained || retained.revision <= previous.revision, "Invalid retained revision");
  }
  const previousHashes = new Set([...(previous?.parts ?? []), ...(retained?.parts ?? [])].map(p => p.sha256));
  // Retain the preceding release as well: a client may have fetched its manifest
  // immediately before this atomic asset deployment. Never copy arbitrary bucket keys.
  const descriptors = new Map([...(retained?.parts ?? []), ...manifest.parts].map(p => [p.sha256, p]));
  const work = [...descriptors.values()]; let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, work.length) }, async () => {
    while (cursor < work.length) {
      const part = work[cursor++];
      const path = `parts/${part.sha256}.json`;
      const data = await download(previousHashes.has(part.sha256) ? target : source, path, part.bytes);
      validatePart(data, part);
      files.set(`discovery/v1/${path}`, data);
    }
  }));
  files.set("discovery/v1/manifest.json", Buffer.from(JSON.stringify(manifest)));
  if (retained) files.set("discovery/v1/previous-manifest.json", Buffer.from(JSON.stringify(retained)));
  files.set("discovery/v1/status.json", Buffer.from(JSON.stringify({ schemaVersion: 1, healthy: true,
    checkedAt: status.checkedAt, pending: status.pending === true,
    ...(status.pending ? { pendingSince: status.pendingSince } : {}), mirroredAt: new Date(now).toISOString() })));
  files.set("404.html", Buffer.from("<!doctype html><title>Not found</title>Not found"));
  files.set("_headers", Buffer.from("/discovery/v1/*\n  Access-Control-Allow-Origin: *\n  X-Content-Type-Options: nosniff\n/discovery/v1/manifest.json\n  Cache-Control: public, max-age=30\n/discovery/v1/status.json\n  Cache-Control: public, max-age=30\n/discovery/v1/parts/*\n  Cache-Control: public, max-age=31536000, immutable\n"));
  return { changed: true, manifest, files };
}

async function main() {
  const result = await prepareStaticSnapshot({
    source: process.env.SNAPSHOT_ORIGIN || "https://parking-lot-navigator-api.parkingnav.workers.dev/api/discovery-snapshot",
    target: process.env.SNAPSHOT_CDN || "https://parking-lot-navigator-data.parkingnav.workers.dev/discovery/v1",
    bootstrap: process.argv.includes("--bootstrap"),
  });
  let directory;
  if (result.changed) {
    directory = resolve(fileURLToPath(new URL("../../tmp/", import.meta.url)), `discovery-assets-${randomUUID()}`);
    for (const [path, data] of result.files) {
      const file = resolve(directory, path);
      await mkdir(dirname(file), { recursive: true }); await writeFile(file, data, { flag: "wx" });
    }
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
    `changed=${result.changed}\ndeferred=${result.deferred === true}\nreason=${result.reason ?? ""}\nretry_at=${result.retryAt ?? ""}\ndirectory=${directory ?? ""}\n`);
  console.log(JSON.stringify({ changed: result.changed, deferred: result.deferred === true,
    reason: result.reason, retryAt: result.retryAt, directory, version: result.manifest.version,
    count: result.manifest.count, parts: result.manifest.parts.length }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.message); process.exitCode = 1;
});
