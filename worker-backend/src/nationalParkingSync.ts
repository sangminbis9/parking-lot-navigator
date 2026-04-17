const NATIONAL_PARKING_PATH = "/openapi/tn_pubr_prkplce_info_api";
const NATIONAL_PARKING_PAGE_URL = "https://www.data.go.kr/data/15012896/standard.do";
const D1_BATCH_SIZE = 50;

export interface NationalParkingSyncInput {
  db?: D1Database;
  serviceKey: string;
  baseUrl: string;
  pageNo: number;
  numOfRows: number;
  dryRun: boolean;
}

export interface NationalParkingSyncResult {
  pageNo: number;
  numOfRows: number;
  totalCount: number | null;
  fetched: number;
  valid: number;
  skipped: number;
  upserted: number;
  dryRun: boolean;
  sample: NormalizedNationalParkingLot[];
}

interface NationalParkingApiResponse {
  response?: {
    header?: {
      resultCode?: string;
      resultMsg?: string;
    };
    body?: {
      items?: NationalParkingApiItem[] | { item?: NationalParkingApiItem[] | NationalParkingApiItem };
      totalCount?: number | string;
      numOfRows?: number | string;
      pageNo?: number | string;
    };
  };
}

interface NationalParkingApiItem {
  prkplceNo?: string;
  prkplceNm?: string;
  prkplceSe?: string;
  prkplceType?: string;
  rdnmadr?: string;
  lnmadr?: string;
  prkcmprt?: string | number;
  operDay?: string;
  weekdayOperOpenHhmm?: string;
  weekdayOperColseHhmm?: string;
  satOperOperOpenHhmm?: string;
  satOperCloseHhmm?: string;
  holidayOperOpenHhmm?: string;
  holidayCloseOpenHhmm?: string;
  parkingchrgeInfo?: string;
  basicTime?: string | number;
  basicCharge?: string | number;
  addUnitTime?: string | number;
  addUnitCharge?: string | number;
  dayCmmtkt?: string | number;
  monthCmmtkt?: string | number;
  metpay?: string;
  spcmnt?: string;
  institutionNm?: string;
  phoneNumber?: string;
  latitude?: string | number;
  longitude?: string | number;
  latitudeValue?: string | number;
  longitudeValue?: string | number;
  pwdbsPpkZoneYn?: string;
  referenceDate?: string;
  instt_code?: string;
}

interface NormalizedNationalParkingLot {
  id: string;
  source: string;
  sourceParkingId: string;
  name: string;
  address: string | null;
  roadAddress: string | null;
  lat: number;
  lng: number;
  totalCapacity: number | null;
  feeSummary: string | null;
  operatingHours: string | null;
  supportsEv: boolean;
  supportsAccessible: boolean;
  isPublic: boolean;
  isPrivate: boolean;
  region1: string | null;
  region2: string | null;
  dataUpdatedAt: string | null;
  raw: NationalParkingApiItem;
}

export async function syncNationalParkingPage(input: NationalParkingSyncInput): Promise<NationalParkingSyncResult> {
  const { items, totalCount } = await fetchNationalParkingItems(input);
  const normalized = items.map(normalizeNationalParkingLot).filter((item): item is NormalizedNationalParkingLot => item !== null);
  const skipped = items.length - normalized.length;

  if (!input.dryRun && input.db && normalized.length > 0) {
    await upsertNationalParkingLots(input.db, normalized);
  }

  return {
    pageNo: input.pageNo,
    numOfRows: input.numOfRows,
    totalCount,
    fetched: items.length,
    valid: normalized.length,
    skipped,
    upserted: input.dryRun ? 0 : normalized.length,
    dryRun: input.dryRun,
    sample: normalized.slice(0, 3)
  };
}

async function fetchNationalParkingItems(
  input: NationalParkingSyncInput
): Promise<{ items: NationalParkingApiItem[]; totalCount: number | null }> {
  try {
    const body = await fetchNationalParkingPage(input);
    ensureSuccess(body);
    return {
      items: extractItems(body),
      totalCount: toNumber(body.response?.body?.totalCount)
    };
  } catch (error) {
    if (input.pageNo !== 1) throw error;
    const fallbackItems = await fetchNationalParkingHtmlFallback();
    if (fallbackItems.length === 0) throw error;
    return {
      items: fallbackItems.slice(0, input.numOfRows),
      totalCount: null
    };
  }
}

async function fetchNationalParkingPage(input: NationalParkingSyncInput): Promise<NationalParkingApiResponse> {
  const url = new URL(NATIONAL_PARKING_PATH, input.baseUrl);
  url.searchParams.set("serviceKey", input.serviceKey);
  url.searchParams.set("pageNo", String(input.pageNo));
  url.searchParams.set("numOfRows", String(input.numOfRows));
  url.searchParams.set("type", "json");

  const response = await fetch(url, {
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
    return JSON.parse(text) as NationalParkingApiResponse;
  } catch {
    throw new Error(`National parking API returned non-JSON body: ${sanitizeBody(text)}`);
  }
}

async function fetchNationalParkingHtmlFallback(): Promise<NationalParkingApiItem[]> {
  const response = await fetch(NATIONAL_PARKING_PAGE_URL, {
    headers: {
      Accept: "text/html,*/*",
      "User-Agent": "ParkingLotNavigator/0.1"
    }
  });
  if (!response.ok) return [];
  return parseNationalParkingHtml(await response.text());
}

function ensureSuccess(body: NationalParkingApiResponse): void {
  const code = body.response?.header?.resultCode;
  if (code && code !== "00" && code !== "0") {
    throw new Error(`National parking API error: ${body.response?.header?.resultMsg ?? code}`);
  }
}

function extractItems(body: NationalParkingApiResponse): NationalParkingApiItem[] {
  const items = body.response?.body?.items;
  if (Array.isArray(items)) return items;
  const item = items?.item;
  if (Array.isArray(item)) return item;
  return item ? [item] : [];
}

function parseNationalParkingHtml(html: string): NationalParkingApiItem[] {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .split(/\r?\n/)
    .map((line) => line.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .map(parseNationalParkingTextRow)
    .filter((item): item is NationalParkingApiItem => item !== null);
}

function parseNationalParkingTextRow(line: string): NationalParkingApiItem | null {
  const match = line.match(
    /^(\d{3}-\d-\d{6})\s+(.+?)\s+(\S+)\s+(\S+)\s+(.+?)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+?)\s+(\d{2}:\d{2})\s+(\d{2}:\d{2})\s+(\d{2}:\d{2})\s+(\d{2}:\d{2})\s+(\d{2}:\d{2})\s+(\d{2}:\d{2})\s+(\S+)\s+(\d+)\s+(\d+)(?:\s+(\d+)\s+(\d+))?.*?\s+(\d{2,3}-\d{3,4}-\d{4})\s+(\d{2}\.\d+)\s+(\d{3}\.\d+)\s+([YN])\s+(\d{4}-\d{2}-\d{2})$/
  );
  if (!match) return null;

  return {
    prkplceNo: match[1],
    prkplceNm: match[2],
    prkplceSe: match[3],
    prkplceType: match[4],
    rdnmadr: match[5],
    prkcmprt: match[6],
    feedingSe: match[7],
    enforceSe: match[8],
    operDay: match[9],
    weekdayOperOpenHhmm: match[10],
    weekdayOperColseHhmm: match[11],
    satOperOperOpenHhmm: match[12],
    satOperCloseHhmm: match[13],
    holidayOperOpenHhmm: match[14],
    holidayCloseOpenHhmm: match[15],
    parkingchrgeInfo: match[16],
    basicTime: match[17],
    basicCharge: match[18],
    addUnitTime: match[19],
    addUnitCharge: match[20],
    phoneNumber: match[21],
    latitude: match[22],
    longitude: match[23],
    pwdbsPpkZoneYn: match[24],
    referenceDate: match[25]
  };
}

function normalizeNationalParkingLot(row: NationalParkingApiItem): NormalizedNationalParkingLot | null {
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

async function upsertNationalParkingLots(db: D1Database, items: NormalizedNationalParkingLot[]): Promise<void> {
  const statements = items.map((item) =>
    db
      .prepare(
        `
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          synced_at = excluded.synced_at
        `
      )
      .bind(
        item.id,
        item.source,
        item.sourceParkingId,
        item.name,
        item.address,
        item.roadAddress,
        item.lat,
        item.lng,
        item.totalCapacity,
        item.feeSummary,
        item.operatingHours,
        Number(item.supportsEv),
        Number(item.supportsAccessible),
        Number(item.isPublic),
        Number(item.isPrivate),
        item.region1,
        item.region2,
        JSON.stringify(item.raw),
        item.dataUpdatedAt,
        new Date().toISOString()
      )
  );

  for (let index = 0; index < statements.length; index += D1_BATCH_SIZE) {
    await db.batch(statements.slice(index, index + D1_BATCH_SIZE));
  }
}

function formatFeeSummary(row: NationalParkingApiItem): string | null {
  const feeInfo = clean(row.parkingchrgeInfo);
  const basicTime = toNumber(row.basicTime);
  const basicCharge = toNumber(row.basicCharge);
  const addUnitTime = toNumber(row.addUnitTime);
  const addUnitCharge = toNumber(row.addUnitCharge);
  const dayPass = toNumber(row.dayCmmtkt);
  const monthPass = toNumber(row.monthCmmtkt);

  if (feeInfo?.includes("\ubb34\ub8cc")) return "\ubb34\ub8cc";
  const parts: string[] = [];
  if (feeInfo) parts.push(feeInfo);
  if (basicTime !== null && basicCharge !== null) parts.push(`base ${basicTime}min ${basicCharge.toLocaleString("ko-KR")} KRW`);
  if (addUnitTime !== null && addUnitCharge !== null) parts.push(`extra ${addUnitTime}min ${addUnitCharge.toLocaleString("ko-KR")} KRW`);
  if (dayPass !== null) parts.push(`day ${dayPass.toLocaleString("ko-KR")} KRW`);
  if (monthPass !== null) parts.push(`month ${monthPass.toLocaleString("ko-KR")} KRW`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function formatOperatingHours(row: NationalParkingApiItem): string | null {
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

function formatRange(start: unknown, end: unknown): string | null {
  const open = clean(start);
  const close = clean(end);
  if (!open || !close) return null;
  return `${open}-${close}`;
}

function splitRegion(address: string | null): { region1: string | null; region2: string | null } {
  const parts = address?.split(/\s+/).filter(Boolean) ?? [];
  return {
    region1: parts[0] ?? null,
    region2: parts[1] ?? null
  };
}

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number !== 0 ? number : null;
}

function yesLike(value: unknown): boolean {
  const text = clean(value);
  return Boolean(text && /(Y|YES|\uc608|\uc788\uc74c|\ubcf4\uc720|\uac00\ub2a5|\uc7a5\uc560\uc778)/i.test(text));
}

function isKoreaCoordinate(lat: number, lng: number): boolean {
  return lat >= 32 && lat <= 39.5 && lng >= 124 && lng <= 132;
}

function normalizeDate(value: unknown): string | null {
  const text = clean(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function sanitizeBody(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 240);
}
