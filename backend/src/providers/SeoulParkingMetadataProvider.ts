import type { ParkingSearchOptions } from "@parking/shared-types";
import type { ParkingProvider, RawParkingRecord } from "../types/provider.js";
import type { AppConfig } from "../config/env.js";
import { distanceMeters } from "../services/geo.js";
import { BaseProviderHealth } from "./BaseProviderHealth.js";

const SEOUL_PAGE_SIZE = 1000;
const SEOUL_MAX_ROWS = 10000;

export class SeoulParkingMetadataProvider extends BaseProviderHealth implements ParkingProvider {
  readonly name = "seoul-metadata";

  constructor(private readonly config: AppConfig) {
    super("seoul-metadata");
  }

  async fetchNearby(lat: number, lng: number, options: ParkingSearchOptions): Promise<RawParkingRecord[]> {
    if (!this.config.SEOUL_OPEN_DATA_KEY) {
      this.markFailure(new Error("SEOUL_OPEN_DATA_KEY가 설정되지 않았습니다."));
      return [];
    }

    try {
      const rows = await fetchAllSeoulRows<SeoulMetadataResponse, SeoulMetadataRow>(
        this.config,
        "GetParkInfo",
        (body) => body.GetParkInfo
      );
      const mapped = rows
        .map(mapMetadataRow)
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

interface SeoulMetadataResponse {
  GetParkInfo?: {
    list_total_count?: number;
    row?: SeoulMetadataRow[];
  };
}

interface SeoulMetadataRow {
  PKLT_CD?: string;
  PKLT_NM?: string;
  ADDR?: string;
  LAT?: number;
  LOT?: number;
  TPKCT?: number;
  WD_OPER_BGNG_TM?: string;
  WD_OPER_END_TM?: string;
  CHGD_FREE_NM?: string;
  PRK_CRG?: number;
  PRK_HM?: number;
  ADD_CRG?: number;
  ADD_UNIT_TM_MNT?: number;
  PRK_NOW_INFO_PVSN_YN?: string;
}

function mapMetadataRow(row: SeoulMetadataRow): RawParkingRecord | null {
  if (!row.PKLT_CD || !row.PKLT_NM) return null;
  return {
    source: "seoul-metadata",
    sourceParkingId: row.PKLT_CD,
    name: row.PKLT_NM,
    address: row.ADDR ?? null,
    lat: toNumber(row.LAT),
    lng: toNumber(row.LOT),
    totalCapacity: toNumber(row.TPKCT),
    realtimeAvailable: false,
    freshnessTimestamp: null,
    operatingHours: formatHours(row.WD_OPER_BGNG_TM, row.WD_OPER_END_TM),
    feeSummary: formatFee(row.PRK_CRG, row.PRK_HM, row.ADD_CRG, row.ADD_UNIT_TM_MNT, row.CHGD_FREE_NM),
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
  return Number.isFinite(number) && number !== 0 ? number : null;
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
