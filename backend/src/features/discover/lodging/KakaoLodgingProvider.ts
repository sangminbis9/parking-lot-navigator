import type { LodgingOption } from "@parking/shared-types";
import type { AppConfig } from "../../../config/env.js";
import { BaseProviderHealth } from "../../../providers/BaseProviderHealth.js";
import { distanceMeters } from "../../../services/geo.js";
import type { DiscoverQuery, LodgingProvider } from "../common/discoverProvider.js";
import { sortByDistance } from "../common/sortDiscover.js";

const KAKAO_LODGING_CATEGORY = "AD5";
const KAKAO_MAX_RADIUS_METERS = 20000;
const KAKAO_PAGE_SIZE = 15;
const KAKAO_MAX_PAGES = 3;

interface KakaoCategoryResponse {
  documents?: KakaoLodgingDocument[];
  meta?: {
    is_end?: boolean;
  };
}

interface KakaoLodgingDocument {
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
}

export class KakaoLodgingProvider extends BaseProviderHealth implements LodgingProvider {
  constructor(private readonly config: AppConfig) {
    super("kakao-local-lodging");
  }

  async lodging(query: DiscoverQuery): Promise<LodgingOption[]> {
    if (!this.config.KAKAO_REST_API_KEY) {
      this.markFailure(new Error("KAKAO_REST_API_KEY is not configured"));
      return [];
    }

    try {
      const radius = Math.min(query.radiusMeters, KAKAO_MAX_RADIUS_METERS);
      const pages: KakaoCategoryResponse[] = [];
      for (let page = 1; page <= KAKAO_MAX_PAGES; page += 1) {
        const body = await fetchKakaoLodgingPage(this.config, { lat: query.lat, lng: query.lng, radius, page });
        pages.push(body);
        if (body.meta?.is_end) break;
      }

      const items = pages
        .flatMap((body) => (body.documents ?? []).map((doc) => mapKakaoDocument(doc, query)))
        .filter((item): item is LodgingOption => item !== null)
        .filter((item) => item.distanceMeters <= query.radiusMeters);

      this.markSuccess(items.length > 0 ? 0.72 : 0.5);
      return sortByDistance(items);
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }
}

async function fetchKakaoLodgingPage(
  config: AppConfig,
  input: { lat: number; lng: number; radius: number; page: number }
): Promise<KakaoCategoryResponse> {
  const url = new URL("/v2/local/search/category.json", config.KAKAO_LOCAL_BASE_URL);
  url.searchParams.set("category_group_code", KAKAO_LODGING_CATEGORY);
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
    throw new Error(`Kakao Local lodging search failed: ${response.status} ${body.slice(0, 120)}`);
  }

  return (await response.json()) as KakaoCategoryResponse;
}

function mapKakaoDocument(doc: KakaoLodgingDocument, query: DiscoverQuery): LodgingOption | null {
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  const name = doc.place_name?.trim();
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const address = doc.road_address_name || doc.address_name || "";
  return {
    id: `kakao:${doc.id || `${name}:${doc.x}:${doc.y}`}`,
    name,
    lodgingType: inferLodgingType(name, doc.category_name),
    address,
    lat,
    lng,
    distanceMeters: distanceMeters(query.lat, query.lng, lat, lng),
    rating: null,
    reviewCount: null,
    imageUrl: null,
    source: "kakao-local",
    sourceUrl: doc.place_url ?? null,
    lowestPriceText: null,
    lowestPricePlatform: null,
    offers: [],
    amenities: [doc.phone ? `tel ${doc.phone}` : null, doc.category_name].filter((value): value is string => Boolean(value))
  };
}

function inferLodgingType(name: string, category?: string): string {
  const text = `${name} ${category ?? ""}`.toLowerCase();
  if (text.includes("\uD638\uD154") || text.includes("hotel")) return "hotel";
  if (text.includes("\uB9AC\uC870\uD2B8") || text.includes("resort")) return "resort";
  if (text.includes("\uD39C\uC158") || text.includes("pension")) return "pension";
  if (text.includes("\uAC8C\uC2A4\uD2B8") || text.includes("hostel") || text.includes("guest")) return "guesthouse";
  if (text.includes("\uBAA8\uD154")) return "motel";
  return "lodging";
}
