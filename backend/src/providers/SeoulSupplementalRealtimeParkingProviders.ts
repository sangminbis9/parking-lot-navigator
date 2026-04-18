import type { ParkingSearchOptions } from "@parking/shared-types";
import type { AppConfig } from "../config/env.js";
import { distanceMeters } from "../services/geo.js";
import type { ParkingProvider, RawParkingRecord } from "../types/provider.js";
import { BaseProviderHealth } from "./BaseProviderHealth.js";

const SEOUL_CENTER = { lat: 37.5665, lng: 126.9780 };
const SEOUL_SERVICE_RADIUS_METERS = 45000;
const SEOUL_PAGE_SIZE = 1000;
const SEOUL_MAX_ROWS = 5000;

const SEONGDONG_SERVICES = [
  "SD_PUBLIC_PARKING",
  "SeongdongPublicParking",
  "TbSeongdongPublicParking",
  "SeongdongIotParking",
  "TbSeongdongIotParking"
];

const HANGANG_SERVICES = [
  "TbRiverParkParking",
  "TbHanriverParkParking",
  "HanRiverParkParking",
  "HangangParkParking",
  "GetHanRiverParkParkingInfo",
  "ListHangangParkParkingInfo"
];

export class SeoulSeongdongIotParkingProvider extends BaseProviderHealth implements ParkingProvider {
  readonly name = "seoul-seongdong-iot";

  constructor(private readonly config: AppConfig) {
    super("seoul-seongdong-iot");
  }

  async fetchNearby(lat: number, lng: number, options: ParkingSearchOptions): Promise<RawParkingRecord[]> {
    if (!this.config.SEOUL_SEONGDONG_IOT_KEY) {
      this.markFailure(new Error("SEOUL_SEONGDONG_IOT_KEY is not configured."));
      return [];
    }
    if (!intersectsSeoulServiceArea(lat, lng, options.radiusMeters)) {
      this.markSuccess(0.6);
      return [];
    }

    try {
      const rows = await fetchFirstWorkingSeoulService(
        this.config,
        this.config.SEOUL_SEONGDONG_IOT_KEY,
        SEONGDONG_SERVICES,
        "Seongdong IoT parking"
      );
      const mapped = mapSeongdongRows(rows)
        .filter((item): item is RawParkingRecord & { lat: number; lng: number } => Boolean(item?.lat && item.lng))
        .filter((item) => distanceMeters(lat, lng, item.lat, item.lng) <= options.radiusMeters);
      this.markSuccess(mapped.length > 0 ? 0.82 : 0.45);
      return mapped;
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }
}

export class SeoulHangangParkingProvider extends BaseProviderHealth implements ParkingProvider {
  readonly name = "seoul-hangang-parking";

  constructor(private readonly config: AppConfig) {
    super("seoul-hangang-parking");
  }

  async fetchNearby(lat: number, lng: number, options: ParkingSearchOptions): Promise<RawParkingRecord[]> {
    if (!this.config.SEOUL_HANGANG_PARKING_KEY) {
      this.markFailure(new Error("SEOUL_HANGANG_PARKING_KEY is not configured."));
      return [];
    }
    if (!intersectsSeoulServiceArea(lat, lng, options.radiusMeters)) {
      this.markSuccess(0.6);
      return [];
    }

    try {
      const rows = await fetchFirstWorkingSeoulService(
        this.config,
        this.config.SEOUL_HANGANG_PARKING_KEY,
        HANGANG_SERVICES,
        "Hangang parking"
      );
      const mapped = rows
        .map(mapHangangRow)
        .filter((item): item is RawParkingRecord & { lat: number; lng: number } => Boolean(item?.lat && item.lng))
        .filter((item) => distanceMeters(lat, lng, item.lat, item.lng) <= options.radiusMeters);
      this.markSuccess(mapped.length > 0 ? 0.78 : 0.45);
      return mapped;
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }
}

async function fetchFirstWorkingSeoulService(
  config: AppConfig,
  key: string,
  services: string[],
  label: string
): Promise<JsonRow[]> {
  const errors: string[] = [];
  for (const service of services) {
    try {
      const rows = await fetchAllSeoulRows(config, key, service);
      if (rows.length > 0) return rows;
      errors.push(`${service}: empty`);
    } catch (error) {
      errors.push(`${service}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  throw new Error(`${label} API did not return rows. ${errors.slice(0, 3).join("; ")}`);
}

async function fetchAllSeoulRows(config: AppConfig, key: string, service: string): Promise<JsonRow[]> {
  const first = await fetchSeoulRows(config, key, service, 1, SEOUL_PAGE_SIZE);
  const totalCount = Math.min(first.totalCount ?? first.rows.length, SEOUL_MAX_ROWS);
  if (totalCount <= SEOUL_PAGE_SIZE) return first.rows;

  const ranges: Array<[number, number]> = [];
  for (let start = SEOUL_PAGE_SIZE + 1; start <= totalCount; start += SEOUL_PAGE_SIZE) {
    ranges.push([start, Math.min(start + SEOUL_PAGE_SIZE - 1, totalCount)]);
  }
  const remaining = await Promise.all(ranges.map(([start, end]) => fetchSeoulRows(config, key, service, start, end)));
  return [...first.rows, ...remaining.flatMap((page) => page.rows)];
}

async function fetchSeoulRows(
  config: AppConfig,
  key: string,
  service: string,
  start: number,
  end: number
): Promise<{ rows: JsonRow[]; totalCount: number | null }> {
  const url = `${config.SEOUL_OPEN_DATA_BASE_URL}/${key}/json/${service}/${start}/${end}/`;
  const response = await fetch(url, defaultFetchOptions());
  if (!response.ok) throw new Error(`${service} failed: ${response.status}`);
  const body = await response.json();
  const error = seoulError(body);
  if (error) throw new Error(`${service} returned ${error}`);
  return {
    rows: extractSeoulRows(body),
    totalCount: extractSeoulTotalCount(body)
  };
}

function mapSeongdongRows(rows: JsonRow[]): RawParkingRecord[] {
  const groups = new Map<string, { row: JsonRow; total: number; available: number; occupied: number }>();
  for (const row of rows) {
    const lat = coordinate(row, "lat");
    const lng = coordinate(row, "lng");
    if (lat === null || lng === null) continue;

    const name = parkingName(row) ?? `Seongdong shared parking ${stableId(JSON.stringify(row)).slice(0, 6)}`;
    const address = parkingAddress(row);
    const key = `${name}|${address ?? ""}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
    const existing = groups.get(key) ?? { row, total: 0, available: 0, occupied: 0 };
    const status = parkingStatusCode(row);
    if (status === "3030") continue;
    existing.total += 1;
    if (status === "3032") existing.available += 1;
    if (status === "3031") existing.occupied += 1;
    groups.set(key, existing);
  }

  return [...groups.entries()].map(([key, group]) => {
    const lat = coordinate(group.row, "lat");
    const lng = coordinate(group.row, "lng");
    return {
      source: "seoul-seongdong-iot",
      sourceParkingId: stableId(key),
      name: parkingName(group.row) ?? "Seongdong shared parking",
      address: parkingAddress(group.row),
      lat,
      lng,
      totalCapacity: group.total > 0 ? group.total : null,
      availableSpaces: group.total > 0 ? group.available : null,
      realtimeAvailable: group.total > 0,
      freshnessTimestamp: timestamp(group.row) ?? new Date().toISOString(),
      operatingHours: null,
      feeSummary: null,
      supportsEv: false,
      supportsAccessible: false,
      isPublic: true,
      isPrivate: false,
      rawSourcePayload: { sample: group.row, totalSensors: group.total, occupiedSensors: group.occupied }
    };
  });
}

function mapHangangRow(row: JsonRow): RawParkingRecord | null {
  const lat = coordinate(row, "lat");
  const lng = coordinate(row, "lng");
  if (lat === null || lng === null) return null;
  const name = parkingName(row);
  if (!name) return null;
  const totalCapacity = capacity(row);
  const availableSpaces = available(row, totalCapacity);
  return {
    source: "seoul-hangang-parking",
    sourceParkingId: stableId(`${name}|${parkingAddress(row) ?? ""}|${lat}|${lng}`),
    name,
    address: parkingAddress(row),
    lat,
    lng,
    totalCapacity,
    availableSpaces,
    realtimeAvailable: availableSpaces !== null,
    freshnessTimestamp: timestamp(row) ?? new Date().toISOString(),
    operatingHours: hours(row),
    feeSummary: fee(row),
    supportsEv: false,
    supportsAccessible: numberByKey(row, ["disabled", "handicap", "accessible"]) !== null,
    isPublic: true,
    isPrivate: false,
    rawSourcePayload: row
  };
}

function intersectsSeoulServiceArea(lat: number, lng: number, radiusMeters: number): boolean {
  return distanceMeters(lat, lng, SEOUL_CENTER.lat, SEOUL_CENTER.lng) <= radiusMeters + SEOUL_SERVICE_RADIUS_METERS;
}

type JsonRow = Record<string, unknown>;

function extractSeoulRows(body: unknown): JsonRow[] {
  if (!isObject(body)) return [];
  for (const value of Object.values(body)) {
    if (!isObject(value)) continue;
    const rows = value.row;
    if (Array.isArray(rows)) return rows.filter(isObject);
    if (isObject(rows)) return [rows];
  }
  return [];
}

function extractSeoulTotalCount(body: unknown): number | null {
  if (!isObject(body)) return null;
  for (const value of Object.values(body)) {
    if (!isObject(value)) continue;
    const count = toNumber(value.list_total_count);
    if (count !== null) return count;
  }
  return null;
}

function seoulError(body: unknown): string | null {
  if (!isObject(body)) return "invalid body";
  const result = body.RESULT;
  if (!isObject(result)) return null;
  const code = String(result.CODE ?? "");
  if (code === "INFO-000") return null;
  return `${code || "ERROR"} ${String(result.MESSAGE ?? "")}`.trim();
}

function parkingName(row: JsonRow): string | null {
  return stringByKey(row, ["PKLT_NM", "PARKING_NM", "PARKING_NAME", "PARK_NM", "NAME", "NM"]);
}

function parkingAddress(row: JsonRow): string | null {
  return stringByKey(row, ["ADDR", "ADDRESS", "PARKING_ADDR", "LOCATION", "PLACE", "POSITION"]);
}

function parkingStatusCode(row: JsonRow): string | null {
  return stringByKey(row, ["PARKING_YN", "PARKING_STATUS", "STATUS", "SENSOR_STATUS", "USE_YN", "STAT_CD"]);
}

function timestamp(row: JsonRow): string | null {
  const value = stringByKey(row, ["NOW_PRK_VHCL_UPDT_TM", "UPDT_TM", "UPDATE_TIME", "REG_DATE", "REG_DT", "BASE_DATE"]);
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(`${normalized}${/[zZ]|[+-]\d\d:?\d\d$/.test(normalized) ? "" : "+09:00"}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function hours(row: JsonRow): string | null {
  return stringByKey(row, ["OPER_TIME", "USE_TIME", "WEEKDAY_USE_TIME", "WD_OPER_TIME"]);
}

function fee(row: JsonRow): string | null {
  return stringByKey(row, ["PARKING_FEE", "WEEKDAY_FEE", "FEE", "PAY"]);
}

function capacity(row: JsonRow): number | null {
  return numberByKey(row, ["TPKCT", "CAPACITY", "TOTAL", "TOTAL_CNT", "PARKING_CNT", "PARKING_COUNT", "SPACE_CNT"]);
}

function available(row: JsonRow, totalCapacity: number | null): number | null {
  const value = numberByKey(row, ["AVAILABLE", "AVAILABLE_CNT", "EMPTY", "EMPTY_CNT", "REMAIN", "REMAIN_CNT"]);
  if (value === null || value < 0) return null;
  if (totalCapacity !== null && value > totalCapacity) return null;
  return value;
}

function coordinate(row: JsonRow, kind: "lat" | "lng"): number | null {
  const direct = kind === "lat"
    ? numberByKey(row, ["LAT", "LATITUDE", "Y", "WGS84_LAT"])
    : numberByKey(row, ["LNG", "LON", "LONGITUDE", "LOT", "X", "WGS84_LON"]);
  if (direct !== null) return direct;

  const location = stringByKey(row, ["LOCATION", "POSITION", "COORDINATE", "COORDS", "POINT"]);
  if (!location) return null;
  const numbers = [...location.matchAll(/-?\d+(?:\.\d+)?/g)]
    .map((match) => Number(match[0]))
    .filter(Number.isFinite);
  if (numbers.length < 2) return null;
  const [a, b] = numbers;
  if (a > 120 && b > 30) return kind === "lat" ? b : a;
  return kind === "lat" ? a : b;
}

function stringByKey(row: JsonRow, keys: string[]): string | null {
  for (const key of keys) {
    const value = valueByExactOrFuzzyKey(row, key);
    if (value === null || value === undefined || value === "") continue;
    return String(value).trim();
  }
  return null;
}

function numberByKey(row: JsonRow, keys: string[]): number | null {
  for (const key of keys) {
    const value = valueByExactOrFuzzyKey(row, key);
    const number = toNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function valueByExactOrFuzzyKey(row: JsonRow, key: string): unknown {
  if (row[key] !== undefined) return row[key];
  const normalizedKey = normalizeKey(key);
  const found = Object.entries(row).find(([candidate]) => normalizeKey(candidate).includes(normalizedKey));
  return found?.[1];
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) && number !== 0 ? number : null;
}

function stableId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function isObject(value: unknown): value is JsonRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultFetchOptions(): RequestInit {
  return {
    headers: {
      "User-Agent": "Mozilla/5.0 ParkingLotNavigator/1.0",
      Accept: "application/json,text/plain,*/*"
    }
  };
}
