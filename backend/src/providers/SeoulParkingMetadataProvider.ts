import type { ParkingSearchOptions } from "@parking/shared-types";
import type { ParkingProvider, RawParkingRecord } from "../types/provider.js";
import type { AppConfig } from "../config/env.js";
import { distanceMeters } from "../services/geo.js";
import { BaseProviderHealth } from "./BaseProviderHealth.js";
import { fetchSeoulParkInfoRows, type SeoulParkInfoRow } from "./seoulOpenData.js";

const SEOUL_CENTER = { lat: 37.5665, lng: 126.9780 };
const SEOUL_SERVICE_RADIUS_METERS = 45000;

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
    if (!intersectsSeoulServiceArea(lat, lng, options.radiusMeters)) {
      this.markSuccess(0.6);
      return [];
    }

    try {
      const rows = await fetchSeoulParkInfoRows(this.config);
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

function intersectsSeoulServiceArea(lat: number, lng: number, radiusMeters: number): boolean {
  return distanceMeters(lat, lng, SEOUL_CENTER.lat, SEOUL_CENTER.lng) <= radiusMeters + SEOUL_SERVICE_RADIUS_METERS;
}

function mapMetadataRow(row: SeoulParkInfoRow): RawParkingRecord | null {
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
