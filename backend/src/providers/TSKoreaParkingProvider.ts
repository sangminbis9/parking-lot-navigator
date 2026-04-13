import type { ParkingSearchOptions } from "@parking/shared-types";
import type { ParkingProvider, RawParkingRecord } from "../types/provider.js";
import type { AppConfig } from "../config/env.js";
import { distanceMeters } from "../services/geo.js";
import { BaseProviderHealth } from "./BaseProviderHealth.js";

export class TSKoreaParkingProvider extends BaseProviderHealth implements ParkingProvider {
  readonly name = "ts-korea";

  constructor(private readonly config: AppConfig) {
    super("ts-korea");
  }

  async fetchNearby(lat: number, lng: number, options: ParkingSearchOptions): Promise<RawParkingRecord[]> {
    if (!this.config.PUBLIC_DATA_SERVICE_KEY) {
      this.markFailure(new Error("PUBLIC_DATA_SERVICE_KEY가 설정되지 않았습니다."));
      return [];
    }

    try {
      const [statusBody, operationBody, realtimeBody] = await Promise.all([
        fetchTSKoreaJson<TSStatusResponse>(this.config, "PrkSttusInfo"),
        fetchTSKoreaJson<TSOperationResponse>(this.config, "PrkOprInfo"),
        fetchTSKoreaJson<TSRealtimeResponse>(this.config, "PrkRealtimeInfo")
      ]);
      ensureSuccess(statusBody.resultCode, statusBody.resultMsg);
      ensureSuccess(operationBody.resultCode, operationBody.resultMsg);
      ensureSuccess(realtimeBody.resultCode, realtimeBody.resultMsg);

      const operations = new Map(operationBody.PrkOprInfo.map((row) => [row.prk_center_id, row]));
      const realtime = new Map(realtimeBody.PrkRealtimeInfo.map((row) => [row.prk_center_id, row]));
      const mapped = statusBody.PrkSttusInfo
        .map((row) => mapTSKoreaRow(row, operations.get(row.prk_center_id), realtime.get(row.prk_center_id)))
        .filter((item): item is RawParkingRecord & { lat: number; lng: number } => Boolean(item?.lat && item.lng))
        .filter((item) => distanceMeters(lat, lng, item.lat, item.lng) <= options.radiusMeters);
      this.markSuccess(mapped.length > 0 ? 0.62 : 0.38);
      return mapped;
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }
}

interface TSBaseResponse {
  resultCode?: string;
  resultMsg?: string;
}

interface TSStatusResponse extends TSBaseResponse {
  PrkSttusInfo: TSStatusRow[];
}

interface TSOperationResponse extends TSBaseResponse {
  PrkOprInfo: TSOperationRow[];
}

interface TSRealtimeResponse extends TSBaseResponse {
  PrkRealtimeInfo: TSRealtimeRow[];
}

interface TSStatusRow {
  prk_center_id: string;
  prk_plce_nm?: string;
  prk_plce_adres?: string;
  prk_plce_entrc_la?: string | number;
  prk_plce_entrc_lo?: string | number;
  prk_cmprt_co?: string | number;
}

interface TSOperationRow {
  prk_center_id: string;
  basic_info?: {
    parking_chrge_bs_time?: string | number;
    parking_chrge_bs_chrge?: string | number;
    parking_chrge_adit_unit_time?: string | number;
    parking_chrge_adit_unit_chrge?: string | number;
  };
  Monday?: {
    opertn_start_time?: string;
    opertn_end_time?: string;
  };
}

interface TSRealtimeRow {
  prk_center_id: string;
  pkfc_Available_ParkingLots_total?: string | number;
  pkfc_ParkingLots_total?: string | number;
}

function mapTSKoreaRow(
  row: TSStatusRow,
  operation: TSOperationRow | undefined,
  realtime: TSRealtimeRow | undefined
): RawParkingRecord | null {
  if (!row.prk_center_id || !row.prk_plce_nm) return null;
  const realtimeAvailableSpaces = toNumber(realtime?.pkfc_Available_ParkingLots_total);
  const realtimeTotal = toNumber(realtime?.pkfc_ParkingLots_total);
  return {
    source: "ts-korea",
    sourceParkingId: row.prk_center_id,
    name: row.prk_plce_nm,
    address: row.prk_plce_adres ?? null,
    lat: toNumber(row.prk_plce_entrc_la),
    lng: toNumber(row.prk_plce_entrc_lo),
    totalCapacity: realtimeTotal ?? toNumber(row.prk_cmprt_co),
    availableSpaces: realtimeAvailableSpaces,
    congestionStatus: "unknown",
    realtimeAvailable: realtimeAvailableSpaces !== null,
    freshnessTimestamp: realtimeAvailableSpaces !== null ? new Date().toISOString() : null,
    operatingHours: formatOperatingHours(operation?.Monday),
    feeSummary: formatFee(operation?.basic_info),
    supportsEv: false,
    supportsAccessible: false,
    isPublic: false,
    isPrivate: true,
    rawSourcePayload: row
  };
}

async function fetchTSKoreaJson<T extends TSBaseResponse>(
  config: AppConfig,
  functionName: "PrkSttusInfo" | "PrkOprInfo" | "PrkRealtimeInfo"
): Promise<T> {
  const url = new URL(`/B553881/Parking/${functionName}`, config.PUBLIC_DATA_BASE_URL);
  url.searchParams.set("serviceKey", config.PUBLIC_DATA_SERVICE_KEY ?? "");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "1000");
  url.searchParams.set("format", "2");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 ParkingLotNavigator/0.1",
      Accept: "application/json,text/plain,*/*"
    }
  });
  if (!response.ok) throw new Error(`한국교통안전공단 API 호출 실패: ${response.status}`);
  return (await response.json()) as T;
}

function ensureSuccess(resultCode?: string, resultMsg?: string): void {
  if (resultCode && resultCode !== "0" && resultCode !== "00") {
    throw new Error(`한국교통안전공단 API 오류: ${resultMsg ?? resultCode}`);
  }
}

function toNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number !== 0 ? number : null;
}

function formatOperatingHours(day?: TSOperationRow["Monday"]): string | null {
  if (!day?.opertn_start_time || !day?.opertn_end_time) return null;
  return `${formatTime(day.opertn_start_time)}-${formatTime(day.opertn_end_time)}`;
}

function formatTime(value: string): string {
  return value.length >= 4 ? `${value.slice(0, 2)}:${value.slice(2, 4)}` : value;
}

function formatFee(info?: TSOperationRow["basic_info"]): string | null {
  const baseMinutes = toNumber(info?.parking_chrge_bs_time);
  const baseFee = toNumber(info?.parking_chrge_bs_chrge);
  const addMinutes = toNumber(info?.parking_chrge_adit_unit_time);
  const addFee = toNumber(info?.parking_chrge_adit_unit_chrge);
  if (baseFee === 0) return "무료";
  if (baseMinutes === null || baseFee === null) return null;
  const addText = addMinutes !== null && addFee !== null ? `, 추가 ${addMinutes}분 ${addFee.toLocaleString("ko-KR")}원` : "";
  return `기본 ${baseMinutes}분 ${baseFee.toLocaleString("ko-KR")}원${addText}`;
}
