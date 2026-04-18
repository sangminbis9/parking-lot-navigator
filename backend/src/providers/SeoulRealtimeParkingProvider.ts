import type { ParkingSearchOptions } from "@parking/shared-types";
import type { ParkingProvider, RawParkingRecord } from "../types/provider.js";
import type { AppConfig } from "../config/env.js";
import { distanceMeters } from "../services/geo.js";
import { BaseProviderHealth } from "./BaseProviderHealth.js";

const SEOUL_PAGE_SIZE = 1000;
const SEOUL_MAX_ROWS = 10000;
const SEOUL_CENTER = { lat: 37.5665, lng: 126.9780 };
const SEOUL_SERVICE_RADIUS_METERS = 45000;

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
      const rows = await fetchAllSeoulRows<SeoulRealtimeResponse, SeoulRealtimeRow>(
        this.config,
        "GetParkingInfo",
        (body) => body.GetParkingInfo
      );
      this.markSuccess(rows.length > 0 ? 0.82 : 0.35);
      return rows.map(mapRealtimeRow).filter((item): item is RawParkingRecord => item !== null);
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

function mapRealtimeRow(row: SeoulRealtimeRow): RawParkingRecord | null {
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

async function fetchSeoulJson<T>(
  config: AppConfig,
  service: string,
  start: number,
  end: number
): Promise<T> {
  const url = `${config.SEOUL_OPEN_DATA_BASE_URL}/${config.SEOUL_OPEN_DATA_KEY}/json/${service}/${start}/${end}/`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`서울 열린데이터광장 호출 실패: ${response.status}`);
  return (await response.json()) as T;
}

async function fetchAllSeoulRows<TBody, TRow>(
  config: AppConfig,
  service: string,
  extract: (body: TBody) => { list_total_count?: number; row?: TRow[] } | undefined
): Promise<TRow[]> {
  const firstBody = await fetchSeoulJson<TBody>(config, service, 1, SEOUL_PAGE_SIZE);
  const firstResult = extract(firstBody);
  const firstRows = firstResult?.row ?? [];
  const totalCount = Math.min(firstResult?.list_total_count ?? firstRows.length, SEOUL_MAX_ROWS);
  if (totalCount <= SEOUL_PAGE_SIZE) return firstRows;

  const ranges: Array<[number, number]> = [];
  for (let start = SEOUL_PAGE_SIZE + 1; start <= totalCount; start += SEOUL_PAGE_SIZE) {
    ranges.push([start, Math.min(start + SEOUL_PAGE_SIZE - 1, totalCount)]);
  }

  const remaining = await Promise.all(
    ranges.map(async ([start, end]) => {
      const body = await fetchSeoulJson<TBody>(config, service, start, end);
      return extract(body)?.row ?? [];
    })
  );

  return [...firstRows, ...remaining.flat()];
}

function toNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
