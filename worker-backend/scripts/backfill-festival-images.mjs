import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

// public-data-culture-festival(문화체육관광부 국가문화축제 공공데이터)은 API 응답에
// 이미지 필드가 없다. 같은 축제가 tourapi(한국관광공사) 쪽에 이미지와 함께 중복
// 등록된 경우가 많아, 제목+기간+좌표로 매칭해 이미지를 백필한다.

const DATABASE_NAME = "parking-lot-navigator";
const MISSING_SOURCE = "public-data-culture-festival";
const CANDIDATE_SOURCE = "tourapi";
const DISTANCE_THRESHOLD_M = 5000;
const dryRun = String(process.env.DRY_RUN).toLowerCase() === "true";

const missing = queryD1(`
  SELECT id, title, start_date, end_date, lat, lng
  FROM discovery_items
  WHERE source = '${MISSING_SOURCE}'
    AND (image_url IS NULL OR trim(image_url) = '');
`);
const candidates = queryD1(`
  SELECT id, title, start_date, end_date, lat, lng, image_url
  FROM discovery_items
  WHERE source = '${CANDIDATE_SOURCE}'
    AND image_url IS NOT NULL AND trim(image_url) <> '';
`);

const candidatesByNormTitle = new Map();
for (const c of candidates) {
  const key = normalizeTitle(c.title);
  if (!key) continue;
  if (!candidatesByNormTitle.has(key)) candidatesByNormTitle.set(key, []);
  candidatesByNormTitle.get(key).push(c);
}

const matches = [];
for (const item of missing) {
  const key = normalizeTitle(item.title);
  const eligible = (candidatesByNormTitle.get(key) ?? [])
    .filter((c) =>
      overlaps(item.start_date, item.end_date, c.start_date, c.end_date),
    )
    .map((c) => ({
      candidate: c,
      distanceMeters: distanceMeters(item.lat, item.lng, c.lat, c.lng),
    }))
    .filter((m) => m.distanceMeters <= DISTANCE_THRESHOLD_M)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  if (eligible.length > 0) {
    const best = eligible[0];
    matches.push({
      missingId: item.id,
      missingTitle: item.title,
      candidateTitle: best.candidate.title,
      distanceMeters: Math.round(best.distanceMeters),
      imageUrl: best.candidate.image_url,
    });
  }
}

console.log(`missing: ${missing.length}, matched: ${matches.length}`);
for (const m of matches) {
  console.log(
    `  [${m.distanceMeters}m] "${m.missingTitle}" <- "${m.candidateTitle}"`,
  );
}

if (matches.length === 0) {
  console.log("no matches to backfill");
  process.exit(0);
}

if (dryRun) {
  console.log("DRY_RUN=true — SQL not executed");
  process.exit(0);
}

const now = new Date().toISOString();
const sql =
  matches
    .map(
      (m) =>
        `UPDATE discovery_items SET image_url = ${sqlValue(m.imageUrl)}, data_updated_at = ${sqlValue(now)} WHERE id = ${sqlValue(m.missingId)} AND (image_url IS NULL OR trim(image_url) = '');`,
    )
    .join("\n") + "\n";

const tmpDir = await mkdtemp(path.join(tmpdir(), "festival-image-backfill-"));
const sqlPath = path.join(tmpDir, "backfill.sql");
await writeFile(sqlPath, sql, "utf8");
try {
  executeWrangler(sqlPath);
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

function queryD1(sql) {
  const result = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "--dir",
      "worker-backend",
      "exec",
      "wrangler",
      "d1",
      "execute",
      DATABASE_NAME,
      "--remote",
      "--json",
      "--command",
      sql,
    ],
    { encoding: "utf8", env: process.env },
  );
  if (result.status !== 0) {
    throw new Error(`wrangler d1 execute --json failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout)[0].results;
}

function executeWrangler(filePath) {
  const result = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "--dir",
      "worker-backend",
      "exec",
      "wrangler",
      "d1",
      "execute",
      DATABASE_NAME,
      "--remote",
      "--file",
      filePath,
    ],
    { stdio: "inherit", env: process.env },
  );
  if (result.status !== 0) {
    throw new Error(`wrangler d1 execute --file failed for ${filePath}`);
  }
}

function sqlValue(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

// NationalCultureFestivalProvider.ts의 normalizeTitle()과 동일한 규칙.
function normalizeTitle(value) {
  return value
    .toLowerCase()
    .replace(/\d{4}/g, "")
    .replace(/제\s*\d+\s*회/g, "")
    .replace(/[()[\]{}"'`~!@#$%^&*_+=,./<>?:;|\\-]/g, "")
    .replace(/\s+/g, "");
}

function overlaps(s1, e1, s2, e2) {
  return s1 <= e2 && s2 <= e1;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
