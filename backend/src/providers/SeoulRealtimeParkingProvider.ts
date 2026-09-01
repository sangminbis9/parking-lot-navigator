import type { ParkingSearchOptions } from "@parking/shared-types";
import type { ParkingProvider, RawParkingRecord } from "../types/provider.js";
import type { AppConfig } from "../config/env.js";
import { MemoryCache } from "../cache/memoryCache.js";
import { distanceMeters } from "../services/geo.js";
import { BaseProviderHealth } from "./BaseProviderHealth.js";
import { fetchAllSeoulRows, fetchSeoulParkInfoRows, type SeoulParkInfoRow } from "./seoulOpenData.js";

const SEOUL_CENTER = { lat: 37.5665, lng: 126.9780 };
const SEOUL_SERVICE_RADIUS_METERS = 45000;
const KAKAO_GEOCODE_CONCURRENCY = 6;
const KAKAO_GEOCODE_CACHE_MAX_ENTRIES = 5000;
const geocodeCache = new MemoryCache<Coordinate | null>(KAKAO_GEOCODE_CACHE_MAX_ENTRIES);

export class SeoulRealtimeParkingProvider extends BaseProviderHealth implements ParkingProvider {
  readonly name = "seoul-realtime";

  constructor(private readonly config: AppConfig) {
    super("seoul-realtime");
  }

  async fetchNearby(lat: number, lng: number, options: ParkingSearchOptions): Promise<RawParkingRecord[]> {
    if (!this.config.SEOUL_OPEN_DATA_KEY) {
      this.markFailure(new Error("SEOUL_OPEN_DATA_KEY가 설정되지 않았습니다."));
      return [];
    }
    if (!intersectsSeoulServiceArea(lat, lng, options.radiusMeters)) {
      this.markSuccess(0.6);
      return [];
    }

    try {
      const [rows, metadataRows] = await Promise.all([
        fetchAllSeoulRows<SeoulRealtimeResponse, SeoulRealtimeRow>(
          this.config,
          "GetParkingInfo",
          (body) => body.GetParkingInfo
        ),
        fetchSeoulParkInfoRows(this.config)
      ]);
      const coordinatesByCode = new Map(
        metadataRows
          .map((row): [string, Coordinate] | null => {
            const lat = toNumber(row.LAT);
            const lng = toNumber(row.LOT);
            return row.PKLT_CD && lat !== null && lng !== null ? [row.PKLT_CD, { lat, lng }] : null;
          })
          .filter((item): item is [string, Coordinate] => item !== null)
      );
      const mapped = rows
        .map((row) => mapRealtimeRow(row, coordinatesByCode.get(row.PKLT_CD ?? "")))
        .filter((item): item is RawParkingRecord => item !== null);
      const enriched = shouldGeocodeMissingCoordinates(options)
        ? await enrichMissingCoordinates(this.config, mapped)
        : mapped;
      this.markSuccess(enriched.length > 0 ? 0.82 : 0.35);
      return enriched;
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }
}

function intersectsSeoulServiceArea(lat: number, lng: number, radiusMeters: number): boolean {
  return distanceMeters(lat, lng, SEOUL_CENTER.lat, SEOUL_CENTER.lng) <= radiusMeters + SEOUL_SERVICE_RADIUS_METERS;
}

interface SeoulRealtimeResponse {
  GetParkingInfo?: {
    list_total_count?: number;
    row?: SeoulRealtimeRow[];
  };
}

interface SeoulRealtimeRow {
  PKLT_CD?: string;
  PKLT_NM?: string;
  ADDR?: string;
  TPKCT?: number;
  NOW_PRK_VHCL_CNT?: number;
  NOW_PRK_VHCL_UPDT_TM?: string;
  PRK_STTS_YN?: string;
  PRK_STTS_NM?: string;
  WD_OPER_BGNG_TM?: string;
  WD_OPER_END_TM?: string;
  BSC_PRK_CRG?: number;
  BSC_PRK_HR?: number;
  ADD_PRK_CRG?: number;
  ADD_PRK_HR?: number;
  PAY_YN_NM?: string;
}

interface Coordinate {
  lat: number;
  lng: number;
}

function mapRealtimeRow(row: SeoulRealtimeRow, coordinate?: Coordinate): RawParkingRecord | null {
  if (!row.PKLT_CD || !row.PKLT_NM) return null;
  const totalCapacity = toNumber(row.TPKCT);
  const currentVehicles = toNumber(row.NOW_PRK_VHCL_CNT);
  const availableSpaces =
    totalCapacity !== null && currentVehicles !== null ? Math.max(0, totalCapacity - currentVehicles) : null;
  return {
    source: "seoul-realtime",
    sourceParkingId: row.PKLT_CD,
    name: row.PKLT_NM,
    address: row.ADDR ?? null,
    lat: coordinate?.lat,
    lng: coordinate?.lng,
    totalCapacity,
    availableSpaces,
    realtimeAvailable: row.PRK_STTS_YN === "1" || availableSpaces !== null,
    freshnessTimestamp: parseSeoulDate(row.NOW_PRK_VHCL_UPDT_TM),
    operatingHours: formatHours(row.WD_OPER_BGNG_TM, row.WD_OPER_END_TM),
    feeSummary: formatFee(row.BSC_PRK_CRG, row.BSC_PRK_HR, row.ADD_PRK_CRG, row.ADD_PRK_HR, row.PAY_YN_NM),
    supportsEv: false,
    supportsAccessible: false,
    isPublic: true,
    isPrivate: false,
    rawSourcePayload: row
  };
}

async function enrichMissingCoordinates(
  config: AppConfig,
  records: RawParkingRecord[]
): Promise<RawParkingRecord[]> {
  if (!config.KAKAO_REST_API_KEY) return records;
  const missing = records.filter((record) => !validCoord(record.lat) || !validCoord(record.lng));
  const geocoded = await mapWithConcurrency(missing, KAKAO_GEOCODE_CONCURRENCY, async (record) => {
    const coordinate = await geocodeSeoulParking(config, record);
    return coordinate
      ? { ...record, lat: coordinate.lat, lng: coordinate.lng, coordinateIsApproximate: true }
      : record;
  });
  const byId = new Map(geocoded.map((record) => [record.sourceParkingId, record]));
  return records.map((record) => byId.get(record.sourceParkingId) ?? record);
}

async function geocodeSeoulParking(config: AppConfig, record: RawParkingRecord): Promise<Coordinate | null> {
  const query = geocodeQuery(record);
  if (!query) return null;
  if (geocodeCache.has(query)) return geocodeCache.get(query);

  try {
    const url = new URL("/v2/local/search/address.json", config.KAKAO_LOCAL_BASE_URL);
    url.searchParams.set("query", query);
    const response = await fetch(url, {
      headers: {
        Authorization: `KakaoAK ${config.KAKAO_REST_API_KEY}`,
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      geocodeCache.set(query, null, config.CACHE_TTL_SECONDS);
      return null;
    }
    const body = (await response.json()) as KakaoAddressResponse;
    const document = body.documents?.[0];
    const coordinate = document ? { lat: toNumber(document.y), lng: toNumber(document.x) } : null;
    const valid =
      coordinate &&
      coordinate.lat !== null &&
      coordinate.lng !== null &&
      validCoord(coordinate.lat) &&
      validCoord(coordinate.lng)
        ? { lat: coordinate.lat, lng: coordinate.lng }
        : null;
    geocodeCache.set(query, valid, config.CACHE_TTL_SECONDS);
    return valid;
  } catch {
    geocodeCache.set(query, null, config.CACHE_TTL_SECONDS);
    return null;
  }
}

function geocodeQuery(record: RawParkingRecord): string | null {
  const address = record.address?.trim();
  if (!address) return null;
  return address.includes("서울") ? address : `서울특별시 ${address}`;
}

interface KakaoAddressResponse {
  documents?: Array<{
    x?: string;
    y?: string;
  }>;
}

function toNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validCoord(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value !== 0;
}

function shouldGeocodeMissingCoordinates(options: ParkingSearchOptions): boolean {
  return options.radiusMeters >= SEOUL_SERVICE_RADIUS_METERS;
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>
): Promise<U[]> {
  const results: U[] = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

function parseSeoulDate(value?: string): string | null {
  if (!value) return null;
  const normalized = value.replace(" ", "T") + "+09:00";
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatHours(start?: string, end?: string): string | null {
  if (!start || !end) return null;
  return `${start.slice(0, 2)}:${start.slice(2)}-${end.slice(0, 2)}:${end.slice(2)}`;
}

function formatFee(base?: number, baseMinutes?: number, add?: number, addMinutes?: number, payName?: string): string | null {
  if (payName?.includes("무료")) return "무료";
  if (!base || !baseMinutes) return payName ?? null;
  const addText = add && addMinutes ? `, 추가 ${addMinutes}분 ${add.toLocaleString("ko-KR")}원` : "";
  return `기본 ${baseMinutes}분 ${base.toLocaleString("ko-KR")}원${addText}`;
}
