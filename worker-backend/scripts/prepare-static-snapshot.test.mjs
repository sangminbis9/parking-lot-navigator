import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareStaticSnapshot } from "./prepare-static-snapshot.mjs";

const now = Date.parse("2026-09-13T01:00:00Z");
const source = "https://origin.test/api/discovery-snapshot";
const target = "https://cdn.test/discovery/v1";
function release(ids, revision = 1) {
  const files = new Map();
  const parts = ids.map(id => {
    const data = Buffer.from(JSON.stringify({ schemaVersion: 1, festivals: [{ id, lat: 37.4, lng: 126.6 }], performanceEvents: [], localEvents: [] }));
    const sha256 = createHash("sha256").update(data).digest("hex");
    files.set(`parts/${sha256}.json`, data);
    return { sha256, bytes: data.length, count: 1 };
  });
  const manifest = { schemaVersion: 1, version: `11111111-1111-1111-1111-${String(revision).padStart(12, "0")}`,
    revision, generatedAt: new Date(now - 1000).toISOString(), parts, count: ids.length, internal: "not public" };
  files.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
  files.set("status.json", Buffer.from(JSON.stringify({ schemaVersion: 1, healthy: true, checkedAt: new Date(now).toISOString(),
    mirroredAt: new Date(now - 3600000).toISOString(), secret: "never copy" })));
  return { files, manifest };
}
function fixture(origin, cdn = new Map()) {
  const requests = [];
  const fetcher = async url => {
    requests.push(url.href);
    const root = url.host === "origin.test" ? source : target;
    const files = url.host === "origin.test" ? origin : cdn;
    const data = files.get(url.href.slice(root.length + 1));
    return new Response(data ?? "Not found", { status: data ? 200 : 404 });
  };
  return { requests, run: () => prepareStaticSnapshot({ source, target, now, fetcher }) };
}
test("bootstrap publishes only complete public files and strips internal metadata", async () => {
  const { files } = release(["a", "b"]);
  const result = await fixture(files).run();
  assert.equal(result.changed, true);
  assert.equal(result.manifest.count, 2);
  assert.equal(result.manifest.internal, undefined);
  assert.equal(JSON.parse(result.files.get("discovery/v1/status.json")).secret, undefined);
  assert.ok([...result.files.keys()].every(key => key.startsWith("discovery/v1/") || ["_headers", "404.html"].includes(key)));
});
test("unchanged fresh deployment does not download any part", async () => {
  const origin = release(["a"]), cdn = release(["a"]);
  cdn.files.set("status.json", Buffer.from(JSON.stringify({ mirroredAt: new Date(now).toISOString() })));
  const f = fixture(origin.files, cdn.files);
  assert.equal((await f.run()).changed, false);
  assert.equal(f.requests.length, 4);
});
test("incremental change reuses CDN files and retains preceding release", async () => {
  const origin = release(["kept", "new"], 2), cdn = release(["kept", "removed"]);
  const f = fixture(origin.files, cdn.files), result = await f.run();
  assert.equal(f.requests.filter(url => url.startsWith(source) && url.includes("/parts/")).length, 1);
  assert.equal([...result.files.keys()].filter(key => key.includes("/parts/")).length, 3);
  assert.equal(result.manifest.count, 2);
});
test("corrupt or missing part prevents producing a deployment", async () => {
  const origin = release(["a"]);
  origin.files.set(`parts/${origin.manifest.parts[0].sha256}.json`, Buffer.from("corrupt"));
  await assert.rejects(fixture(origin.files).run(), /integrity/);
  origin.files.delete(`parts/${origin.manifest.parts[0].sha256}.json`);
  await assert.rejects(fixture(origin.files).run(), /HTTP 404/);
});
test("older origin or conflicting revision cannot roll the CDN back", async () => {
  await assert.rejects(fixture(release(["a"]).files, release(["b"], 2).files).run(), /older/);
  const origin = release(["a"]), previous = release(["b"]);
  previous.manifest.version = "22222222-2222-2222-2222-222222222222";
  previous.files.set("manifest.json", Buffer.from(JSON.stringify(previous.manifest)));
  await assert.rejects(fixture(origin.files, previous.files).run(), /Conflicting/);
});
test("unhealthy publisher blocks publication even when the manifest exists", async () => {
  const origin = release(["a"]);
  origin.files.set("status.json", Buffer.from(JSON.stringify({ schemaVersion: 1, healthy: false, checkedAt: new Date(now).toISOString() })));
  await assert.rejects(fixture(origin.files).run(), /unhealthy/);
});
test("invalid hash path and empty manifest are rejected instead of truncating", async () => {
  const origin = release(["a"]);
  origin.manifest.parts[0].sha256 = "../../private";
  origin.files.set("manifest.json", Buffer.from(JSON.stringify(origin.manifest)));
  await assert.rejects(fixture(origin.files).run(), /descriptor/);
  await assert.rejects(fixture(release([]).files).run(), /totals/);
});
test("large pin sets are not capped at 500 or 1000", async () => {
  const result = await fixture(release(Array.from({ length: 1200 }, (_, i) => `pin-${i}`)).files).run();
  assert.equal(result.manifest.count, 1200);
});
