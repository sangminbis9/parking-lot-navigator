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
      const url = new URL("/B553881/Parking/PrkSttusInfo", this.config.PUBLIC_DATA_BASE_URL);
      url.searchParams.set("serviceKey", this.config.PUBLIC_DATA_SERVICE_KEY);
      url.searchParams.set("pageNo", "1");
      url.searchParams.set("numOfRows", "1000");
      url.searchParams.set("format", "2");

      const response = await fetch(url);
      if (!response.ok) throw new Error(`한국교통안전공단 API 호출 실패: ${response.status}`);
      const body = (await response.json()) as TSKoreaResponse;
      const resultCode = body.response?.header?.resultCode;
      if (resultCode && resultCode !== "00") {
        throw new Error(`한국교통안전공단 API 오류: ${body.response?.header?.resultMsg ?? resultCode}`);
      }
      const rows = normalizeItems(body.response?.body?.items?.item);
      const mapped = rows
        .map(mapTSKoreaRow)
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

interface TSKoreaResponse {
  response?: {
    header?: {
      resultCode?: string;
      resultMsg?: string;
    };
    body?: {
      items?: {
        item?: TSKoreaRow[] | TSKoreaRow;
      };
    };
  };
}

interface TSKoreaRow {
  prk_center_id?: string;
  prk_plce_nm?: string;
  prk_plce_adres?: string;
  prk_plce_entrc_la?: string | number;
  prk_plce_entrc_lo?: string | number;
  prk_cmprt_co?: string | number;
}

function normalizeItems(items: TSKoreaRow[] | TSKoreaRow | undefined): TSKoreaRow[] {
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

function mapTSKoreaRow(row: TSKoreaRow): RawParkingRecord | null {
  if (!row.prk_center_id || !row.prk_plce_nm) return null;
  return {
    source: "ts-korea",
    sourceParkingId: row.prk_center_id,
    name: row.prk_plce_nm,
    address: row.prk_plce_adres ?? null,
    lat: toNumber(row.prk_plce_entrc_la),
    lng: toNumber(row.prk_plce_entrc_lo),
    totalCapacity: toNumber(row.prk_cmprt_co),
    availableSpaces: null,
    congestionStatus: "unknown",
    realtimeAvailable: false,
    freshnessTimestamp: null,
    operatingHours: null,
    feeSummary: null,
    supportsEv: false,
    supportsAccessible: false,
    isPublic: false,
    isPrivate: true,
    rawSourcePayload: row
  };
}

function toNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number !== 0 ? number : null;
}
