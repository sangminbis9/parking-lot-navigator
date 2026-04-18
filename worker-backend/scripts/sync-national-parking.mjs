import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const API_BASE_URL = process.env.NATIONAL_PARKING_DATA_BASE_URL ?? "https://api.data.go.kr";
const API_PATH = "/openapi/tn_pubr_prkplce_info_api";
const HTML_FALLBACK_URL = "https://www.data.go.kr/data/15012896/standard.do";
const DATABASE_NAME = "parking-lot-navigator";
const OUTPUT_DIR = path.resolve("worker-backend", ".national-sync");
const SQL_CHUNK_SIZE = 50;
const OPEN_API_RETRIES = 2;
const HTML_FALLBACK_RETRIES = 2;

const serviceKey = requiredEnv("PUBLIC_DATA_SERVICE_KEY");
const pageStart = positiveInt(process.env.PAGE_START, 1);
const pageEnd = positiveInt(process.env.PAGE_END, pageStart);
const numRows = Math.min(1000, positiveInt(process.env.NUM_ROWS, 500));
const dryRun = String(process.env.DRY_RUN).toLowerCase() === "true";

if (pageEnd < pageStart) {
  throw new Error(`PAGE_END (${pageEnd}) must be greater than or equal to PAGE_START (${pageStart}).`);
}

const startedAt = new Date();
let fetched = 0;
let valid = 0;
let skipped = 0;
let upserted = 0;
let sqlFiles = 0;

await rm(OUTPUT_DIR, { recursive: true, force: true });
await mkdir(OUTPUT_DIR, { recursive: true });

for (let pageNo = pageStart; pageNo <= pageEnd; pageNo += 1) {
  const { items, totalCount, source } = await fetchNationalParkingItems({ pageNo, numRows });
  const normalized = items.map(normalizeNationalParkingLot).filter(Boolean);
  fetched += items.length;
  valid += normalized.length;
  skipped += items.length - normalized.length;

  console.log(
    JSON.stringify({
      pageNo,
      source,
      totalCount,
      fetched: items.length,
      valid: normalized.length,
      skipped: items.length - normalized.length,
      sample: normalized.slice(0, 2).map((item) => ({
        id: item.id,
        name: item.name,
        address: item.roadAddress ?? item.address,
        lat: item.lat,
        lng: item.lng
      }))
    })
  );

  if (!dryRun && normalized.length > 0) {
    for (let index = 0; index < normalized.length; index += SQL_CHUNK_SIZE) {
      const chunk = normalized.slice(index, index + SQL_CHUNK_SIZE);
      const filePath = path.join(OUTPUT_DIR, `page-${pageNo}-chunk-${index / SQL_CHUNK_SIZE + 1}.sql`);
      await writeFile(filePath, buildSql(chunk), "utf8");
      executeWrangler(filePath);
      sqlFiles += 1;
      upserted += chunk.length;
    }
  }
}

const summary = {
  pageStart,
  pageEnd,
  numRows,
  dryRun,
  fetched,
  valid,
  skipped,
  upserted,
  sqlFiles,
  durationSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000)
};
console.log(JSON.stringify(summary, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  await writeFile(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## National parking D1 sync",
      "",
      `- Pages: ${pageStart}-${pageEnd}`,
      `- Rows per page: ${numRows}`,
      `- Dry run: ${dryRun}`,
      `- Fetched: ${fetched}`,
      `- Valid: ${valid}`,
      `- Skipped: ${skipped}`,
      `- Upserted: ${upserted}`,
      `- SQL files executed: ${sqlFiles}`
    ].join("\n"),
    "utf8"
  );
}

async function fetchNationalParkingItems({ pageNo, numRows }) {
  try {
    const body = await fetchOpenApiPage({ pageNo, numRows });
    ensureSuccess(body);
    return {
      items: extractItems(body),
      totalCount: toNumber(body.response?.body?.totalCount),
      source: "openapi"
    };
  } catch (error) {
    console.warn(`OpenAPI failed on page ${pageNo}, trying HTML fallback: ${errorMessage(error)}`);
    const items = await fetchHtmlFallback();
    const offset = (pageNo - 1) * numRows;
    return {
      items: items.slice(offset, offset + numRows),
      totalCount: items.length,
      source: "html-fallback"
    };
  }
}

async function fetchOpenApiPage({ pageNo, numRows }) {
  const url = `${API_BASE_URL}${API_PATH}?serviceKey=${serviceKeyQueryValue(serviceKey)}&pageNo=${pageNo}&numOfRows=${numRows}&type=json`;
  const response = await fetchWithRetry(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "ParkingLotNavigator/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`National parking API failed: ${response.status}`);
  }

  const text = await response.text();
  try {
    return parseJsonBody(text);
  } catch {
    throw new Error(`National parking API returned non-JSON body: ${sanitizeBody(text)}`);
  }
}

async function fetchWithRetry(url, options, retries = OPEN_API_RETRIES) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(750 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

async function fetchHtmlFallback() {
  const response = await fetchWithRetry(
    HTML_FALLBACK_URL,
    {
      headers: {
        Accept: "text/html,*/*",
        "User-Agent": "ParkingLotNavigator/0.1"
      }
    },
    HTML_FALLBACK_RETRIES
  );
  if (!response.ok) {
    throw new Error(`National parking HTML fallback failed: ${response.status}`);
  }
  const html = await response.text();
  const items = parseNationalParkingHtml(html);
  if (items.length === 0) {
    throw new Error(
      [
        "National parking HTML fallback returned 0 rows",
        `htmlLength=${html.length}`,
        `contentsTr=${(html.match(/contentsTr/g) ?? []).length}`,
        `td=${(html.match(/<td/gi) ?? []).length}`,
        `sample=${sanitizeBody(html)}`
      ].join("; ")
    );
  }
  return items;
}

function parseJsonBody(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("No JSON object found");
  }
}

function ensureSuccess(body) {
  const code = body.response?.header?.resultCode;
  if (code && code !== "00" && code !== "0") {
    throw new Error(`National parking API error: ${body.response?.header?.resultMsg ?? code}`);
  }
}

function extractItems(body) {
  const items = body.response?.body?.items;
  if (Array.isArray(items)) return items;
  const item = items?.item;
  if (Array.isArray(item)) return item;
  return item ? [item] : [];
}

function normalizeNationalParkingLot(row) {
  const name = clean(row.prkplceNm);
  const lat = toNumber(row.latitude ?? row.latitudeValue);
  const lng = toNumber(row.longitude ?? row.longitudeValue);
  if (!name || lat === null || lng === null || !isKoreaCoordinate(lat, lng)) return null;

  const sourceParkingId = clean(row.prkplceNo) ?? `${name}:${lat}:${lng}`;
  const address = clean(row.lnmadr);
  const roadAddress = clean(row.rdnmadr);
  const region = splitRegion(roadAddress ?? address);

  return {
    id: `public-data:${sourceParkingId}`,
    source: "public-data-national",
    sourceParkingId,
    name,
    address,
    roadAddress,
    lat,
    lng,
    totalCapacity: toNumber(row.prkcmprt),
    feeSummary: formatFeeSummary(row),
    operatingHours: formatOperatingHours(row),
    supportsEv: false,
    supportsAccessible: yesLike(row.pwdbsPpkZoneYn) || yesLike(row.spcmnt),
    isPublic: clean(row.prkplceSe)?.includes("\uacf5\uc601") ?? false,
    isPrivate: clean(row.prkplceSe)?.includes("\ubbfc\uc601") ?? false,
    region1: region.region1,
    region2: region.region2,
    dataUpdatedAt: normalizeDate(row.referenceDate),
    raw: row
  };
}

function buildSql(items) {
  return items
    .map(
      (item) => `
INSERT INTO parking_lots (
  id,
  source,
  source_parking_id,
  name,
  address,
  road_address,
  lat,
  lng,
  total_capacity,
  fee_summary,
  operating_hours,
  supports_ev,
  supports_accessible,
  is_public,
  is_private,
  region1,
  region2,
  raw_payload,
  data_updated_at,
  synced_at
)
VALUES (
  ${sqlValue(item.id)},
  ${sqlValue(item.source)},
  ${sqlValue(item.sourceParkingId)},
  ${sqlValue(item.name)},
  ${sqlValue(item.address)},
  ${sqlValue(item.roadAddress)},
  ${sqlValue(item.lat)},
  ${sqlValue(item.lng)},
  ${sqlValue(item.totalCapacity)},
  ${sqlValue(item.feeSummary)},
  ${sqlValue(item.operatingHours)},
  ${Number(item.supportsEv)},
  ${Number(item.supportsAccessible)},
  ${Number(item.isPublic)},
  ${Number(item.isPrivate)},
  ${sqlValue(item.region1)},
  ${sqlValue(item.region2)},
  ${sqlValue(JSON.stringify(item.raw))},
  ${sqlValue(item.dataUpdatedAt)},
  ${sqlValue(new Date().toISOString())}
)
ON CONFLICT(source, source_parking_id) DO UPDATE SET
  id = excluded.id,
  name = excluded.name,
  address = excluded.address,
  road_address = excluded.road_address,
  lat = excluded.lat,
  lng = excluded.lng,
  total_capacity = excluded.total_capacity,
  fee_summary = excluded.fee_summary,
  operating_hours = excluded.operating_hours,
  supports_ev = excluded.supports_ev,
  supports_accessible = excluded.supports_accessible,
  is_public = excluded.is_public,
  is_private = excluded.is_private,
  region1 = excluded.region1,
  region2 = excluded.region2,
  raw_payload = excluded.raw_payload,
  data_updated_at = excluded.data_updated_at,
  synced_at = excluded.synced_at;`
    )
    .join("\n");
}

function executeWrangler(filePath) {
  const result = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["--dir", "worker-backend", "exec", "wrangler", "d1", "execute", DATABASE_NAME, "--remote", "--file", filePath],
    {
      stdio: "inherit",
      env: process.env
    }
  );
  if (result.status !== 0) {
    throw new Error(`wrangler d1 execute failed for ${filePath}`);
  }
}

function parseNationalParkingHtml(html) {
  const rows = [
    ...html.matchAll(/<tr[^>]*class=["'][^"']*\bcontentsTr\b[^"']*["'][^>]*>[\s\S]*?<\/tr>/gi)
  ].map((match) => match[0]);
  return rows.map(parseNationalParkingTableRow).filter(Boolean);
}

function parseNationalParkingTableRow(rowHtml) {
  const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) => htmlCellText(match[1]));
  if (cells.length < 32 || !cells[0] || !cells[1]) return null;
  return {
    prkplceNo: cells[0],
    prkplceNm: cells[1],
    prkplceSe: cells[2],
    prkplceType: cells[3],
    rdnmadr: cells[4],
    lnmadr: cells[5],
    prkcmprt: cells[6],
    feedingSe: cells[7],
    enforceSe: cells[8],
    operDay: cells[9],
    weekdayOperOpenHhmm: cells[10],
    weekdayOperColseHhmm: cells[11],
    satOperOperOpenHhmm: cells[12],
    satOperCloseHhmm: cells[13],
    holidayOperOpenHhmm: cells[14],
    holidayCloseOpenHhmm: cells[15],
    parkingchrgeInfo: cells[16],
    basicTime: cells[17],
    basicCharge: cells[18],
    addUnitTime: cells[19],
    addUnitCharge: cells[20],
    dayCmmtkt: cells[22],
    monthCmmtkt: cells[23],
    metpay: cells[24],
    spcmnt: cells[25],
    institutionNm: cells[26],
    phoneNumber: cells[27],
    latitude: cells[28],
    longitude: cells[29],
    pwdbsPpkZoneYn: cells[30],
    referenceDate: cells[31]
  };
}

function formatFeeSummary(row) {
  const feeInfo = clean(row.parkingchrgeInfo);
  const basicTime = toNumber(row.basicTime);
  const basicCharge = toNumber(row.basicCharge);
  const addUnitTime = toNumber(row.addUnitTime);
  const addUnitCharge = toNumber(row.addUnitCharge);
  const dayPass = toNumber(row.dayCmmtkt);
  const monthPass = toNumber(row.monthCmmtkt);

  if (feeInfo?.includes("\ubb34\ub8cc")) return "\ubb34\ub8cc";
  const parts = [];
  if (feeInfo) parts.push(feeInfo);
  if (basicTime !== null && basicCharge !== null) parts.push(`base ${basicTime}min ${basicCharge.toLocaleString("ko-KR")} KRW`);
  if (addUnitTime !== null && addUnitCharge !== null) parts.push(`extra ${addUnitTime}min ${addUnitCharge.toLocaleString("ko-KR")} KRW`);
  if (dayPass !== null) parts.push(`day ${dayPass.toLocaleString("ko-KR")} KRW`);
  if (monthPass !== null) parts.push(`month ${monthPass.toLocaleString("ko-KR")} KRW`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function formatOperatingHours(row) {
  const weekday = formatRange(row.weekdayOperOpenHhmm, row.weekdayOperColseHhmm);
  const saturday = formatRange(row.satOperOperOpenHhmm, row.satOperCloseHhmm);
  const holiday = formatRange(row.holidayOperOpenHhmm, row.holidayCloseOpenHhmm);
  const parts = [
    weekday ? `weekday ${weekday}` : null,
    saturday ? `sat ${saturday}` : null,
    holiday ? `holiday ${holiday}` : null
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : clean(row.operDay);
}

function formatRange(start, end) {
  const open = clean(start);
  const close = clean(end);
  if (!open || !close) return null;
  return `${open}-${close}`;
}

function splitRegion(address) {
  const parts = address?.split(/\s+/).filter(Boolean) ?? [];
  return {
    region1: parts[0] ?? null,
    region2: parts[1] ?? null
  };
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function serviceKeyQueryValue(value) {
  return value.includes("%") ? value : encodeURIComponent(value);
}

function htmlCellText(value) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number !== 0 ? number : null;
}

function yesLike(value) {
  const text = clean(value);
  return Boolean(text && /(Y|YES|\uc608|\uc788\uc74c|\ubcf4\uc720|\uac00\ub2a5|\uc7a5\uc560\uc778)/i.test(text));
}

function isKoreaCoordinate(lat, lng) {
  return lat >= 32 && lat <= 39.5 && lng >= 124 && lng <= 132;
}

function normalizeDate(value) {
  const text = clean(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function sanitizeBody(value) {
  return value.replace(/\s+/g, " ").slice(0, 240);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "Unknown error";
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
