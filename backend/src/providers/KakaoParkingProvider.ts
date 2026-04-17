import type { ParkingSearchOptions } from "@parking/shared-types";
import type { AppConfig } from "../config/env.js";
import type { ParkingProvider, RawParkingRecord } from "../types/provider.js";
import { BaseProviderHealth } from "./BaseProviderHealth.js";

const KAKAO_PARKING_CATEGORY = "PK6";
const KAKAO_MAX_RADIUS_METERS = 20000;
const KAKAO_PAGE_SIZE = 15;
const KAKAO_MAX_PAGES = 3;

export class KakaoParkingProvider extends BaseProviderHealth implements ParkingProvider {
  readonly name = "kakao-local";

  constructor(private readonly config: AppConfig) {
    super("kakao-local");
  }

  async fetchNearby(lat: number, lng: number, options: ParkingSearchOptions): Promise<RawParkingRecord[]> {
    if (!this.config.KAKAO_REST_API_KEY) {
      this.markFailure(new Error("KAKAO_REST_API_KEY is not configured"));
      return [];
    }

    try {
      const radius = Math.min(options.radiusMeters, KAKAO_MAX_RADIUS_METERS);
      const pages: KakaoCategoryResponse[] = [];
      for (let page = 1; page <= KAKAO_MAX_PAGES; page += 1) {
        const body = await fetchKakaoParkingPage(this.config, { lat, lng, radius, page });
        pages.push(body);
        if (body.meta?.is_end) break;
      }

      const records = pages
        .flatMap((body) => (body.documents ?? []).map(mapKakaoDocument))
        .filter((record): record is RawParkingRecord => record !== null);
      this.markSuccess(records.length > 0 ? 0.68 : 0.42);
      return records;
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }
}

interface KakaoCategoryResponse {
  documents?: KakaoParkingDocument[];
  meta?: {
    is_end?: boolean;
  };
}

interface KakaoParkingDocument {
  id?: string;
  place_name?: string;
  road_address_name?: string;
  address_name?: string;
  x?: string;
  y?: string;
  phone?: string;
  place_url?: string;
  category_name?: string;
  category_group_code?: string;
  category_group_name?: string;
  distance?: string;
}

async function fetchKakaoParkingPage(
  config: AppConfig,
  input: { lat: number; lng: number; radius: number; page: number }
): Promise<KakaoCategoryResponse> {
  const url = new URL("/v2/local/search/category.json", config.KAKAO_LOCAL_BASE_URL);
  url.searchParams.set("category_group_code", KAKAO_PARKING_CATEGORY);
  url.searchParams.set("x", String(input.lng));
  url.searchParams.set("y", String(input.lat));
  url.searchParams.set("radius", String(input.radius));
  url.searchParams.set("sort", "distance");
  url.searchParams.set("size", String(KAKAO_PAGE_SIZE));
  url.searchParams.set("page", String(input.page));

  const response = await fetch(url, {
    headers: {
      Authorization: `KakaoAK ${config.KAKAO_REST_API_KEY}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Kakao Local parking search failed: ${response.status} ${body.slice(0, 120)}`);
  }

  return (await response.json()) as KakaoCategoryResponse;
}

function mapKakaoDocument(doc: KakaoParkingDocument): RawParkingRecord | null {
  const lat = toNumber(doc.y);
  const lng = toNumber(doc.x);
  const name = doc.place_name?.trim();
  if (!name || lat === null || lng === null) return null;

  return {
    source: "kakao-local",
    sourceParkingId: doc.id || `${name}:${doc.x}:${doc.y}`,
    name,
    address: doc.road_address_name || doc.address_name || null,
    lat,
    lng,
    totalCapacity: null,
    availableSpaces: null,
    congestionStatus: "unknown",
    realtimeAvailable: false,
    freshnessTimestamp: null,
    operatingHours: null,
    feeSummary: null,
    supportsEv: false,
    supportsAccessible: false,
    isPublic: false,
    isPrivate: false,
    rawSourcePayload: doc
  };
}

function toNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number !== 0 ? number : null;
}
