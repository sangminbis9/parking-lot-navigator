import { createHash } from "node:crypto";

// Release gate: verify the complete published dataset, never just /health.
const base = process.env.DISCOVERY_SNAPSHOT_BASE_URL?.trim()
  || `${(process.env.API_BASE_URL || "https://parking-lot-navigator-api.parkingnav.workers.dev").replace(/\/$/, "")}/api/discovery-snapshot`;
const root = new URL(`${base.replace(/\/$/, "")}/`);
if (root.protocol !== "https:") throw new Error("Snapshot release URL must use HTTPS");
const check = (condition, message) => { if (!condition) throw new Error(message); };
async function download(path, maxBytes) {
  const response = await fetch(new URL(path, root), { signal: AbortSignal.timeout(30_000) });
  check(response.ok, `${path}: HTTP ${response.status}`);
  check(response.body, `${path}: missing response body`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    check(size <= maxBytes, `${path}: size budget exceeded`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
const manifest = JSON.parse(await download("manifest.json", 4 * 1024 * 1024));
check(manifest.schemaVersion === 1 && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(manifest.version), "Invalid manifest schema/version");
const age = Date.now() - Date.parse(manifest.generatedAt);
check(Number.isFinite(age) && age >= -300_000, "Invalid snapshot publication time");
// Unchanged data may legitimately be older than 48h. Check the publisher separately.
const status = JSON.parse(await download("status.json", 16 * 1024));
const checkAge = Date.now() - Date.parse(status.checkedAt);
check(status.schemaVersion === 1 && status.healthy === true && Number.isFinite(checkAge)
  && checkAge >= -300_000 && checkAge < 15 * 60_000, "Publisher unhealthy or not checked in 15 minutes");
check(!status.pending || Date.now() - Date.parse(status.pendingSince) < 10 * 60_000,
  "Publication backlog is stale");
check(Array.isArray(manifest.parts) && Number.isSafeInteger(manifest.count) && manifest.count > 0, "Cannot release against an empty snapshot");
let bytes = 0;
let count = 0;
const hashes = new Set();
for (const part of manifest.parts) {
  check(/^[0-9a-f]{64}$/.test(part.sha256) && !hashes.has(part.sha256), "Invalid or duplicate part hash");
  hashes.add(part.sha256);
  check(Number.isSafeInteger(part.bytes) && part.bytes > 0 && part.bytes <= 8 * 1024 * 1024, "Invalid part bytes");
  check(Number.isSafeInteger(part.count) && part.count > 0 && part.count <= 256, "Invalid part count");
  bytes += part.bytes;
  count += part.count;
}
check(bytes <= 128 * 1024 * 1024 && count === manifest.count, "Invalid total snapshot size/count");
let next = 0;
await Promise.all(Array.from({ length: Math.min(4, manifest.parts.length) }, async () => {
  while (next < manifest.parts.length) {
    const part = manifest.parts[next++];
    const data = await download(`parts/${part.sha256}.json`, part.bytes);
    check(data.length === part.bytes && createHash("sha256").update(data).digest("hex") === part.sha256, "Part integrity mismatch");
    const body = JSON.parse(data);
    check(body.schemaVersion === 1, "Invalid part schema");
    const groups = [body.festivals, body.performanceEvents, body.localEvents];
    check(groups.every(Array.isArray) && groups.reduce((n, rows) => n + rows.length, 0) === part.count, "Part count mismatch");
    for (const item of groups.flat()) {
      check(typeof item.id === "string" && Number.isFinite(item.lat) && Number.isFinite(item.lng)
        && Math.abs(item.lat) <= 90 && Math.abs(item.lng) <= 180, "Invalid public item identity/coordinate");
    }
  }
}));
console.log(JSON.stringify({ event: "snapshot_verified", version: manifest.version,
  generatedAt: manifest.generatedAt, count, parts: manifest.parts.length, bytes }));
