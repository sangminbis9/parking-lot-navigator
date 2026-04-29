import type { LodgingOption } from "@parking/shared-types";
import { BaseProviderHealth } from "../../../providers/BaseProviderHealth.js";
import { distanceMeters } from "../../../services/geo.js";
import type { DiscoverQuery, LodgingProvider } from "../common/discoverProvider.js";
import { sortByDistance } from "../common/sortDiscover.js";

const TOURAPI_LODGING_CONTENT_TYPE_ID = "32";
const TOURAPI_MAX_RADIUS_METERS = 20000;

interface TourApiLodgingItem {
  contentid?: string;
  contenttypeid?: string;
  title?: string;
  addr1?: string;
  addr2?: string;
  firstimage?: string;
  firstimage2?: string;
  mapx?: string;
  mapy?: string;
  tel?: string;
  cat1?: string;
  cat2?: string;
  cat3?: string;
  dist?: string;
}

export class TourApiLodgingProvider extends BaseProviderHealth implements LodgingProvider {
  constructor(
    private readonly serviceKey: string,
    private readonly baseUrl: string
  ) {
    super("tourapi-lodging");
  }

  async lodging(query: DiscoverQuery): Promise<LodgingOption[]> {
    try {
      const url = new URL("/B551011/KorService2/locationBasedList2", this.baseUrl);
      url.searchParams.set("serviceKey", this.serviceKey.trim());
      url.searchParams.set("MobileOS", "ETC");
      url.searchParams.set("MobileApp", "ParkingLotNavigator");
      url.searchParams.set("_type", "json");
      url.searchParams.set("numOfRows", "80");
      url.searchParams.set("pageNo", "1");
      url.searchParams.set("arrange", "E");
      url.searchParams.set("contentTypeId", TOURAPI_LODGING_CONTENT_TYPE_ID);
      url.searchParams.set("mapX", String(query.lng));
      url.searchParams.set("mapY", String(query.lat));
      url.searchParams.set("radius", String(Math.min(query.radiusMeters, TOURAPI_MAX_RADIUS_METERS)));

      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 ParkingLotNavigator/1.0",
          Accept: "application/json,text/plain,*/*"
        }
      });
      if (!response.ok) throw new Error(`TourAPI lodging failed: ${response.status}`);

      const body = (await response.json()) as {
        response?: {
          header?: { resultCode?: string; resultMsg?: string };
          body?: { items?: { item?: TourApiLodgingItem[] | TourApiLodgingItem } };
        };
      };
      const resultCode = body.response?.header?.resultCode;
      if (resultCode && resultCode !== "0000") {
        throw new Error(`TourAPI lodging failed: ${body.response?.header?.resultMsg ?? resultCode}`);
      }

      const rawItems = body.response?.body?.items?.item;
      const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
      const normalized = items
        .map((item) => normalizeTourLodging(item, query))
        .filter((item): item is LodgingOption => Boolean(item))
        .filter((item) => item.distanceMeters <= query.radiusMeters);

      this.markSuccess(normalized.length > 0 ? 0.82 : 0.62);
      return sortByDistance(normalized);
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }
}

function normalizeTourLodging(item: TourApiLodgingItem, query: DiscoverQuery): LodgingOption | null {
  const lat = Number(item.mapy);
  const lng = Number(item.mapx);
  const title = item.title?.trim();
  if (!item.contentid || !title || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const address = [item.addr1, item.addr2].filter(Boolean).join(" ");
  const amenities = [item.tel ? `tel ${item.tel}` : null, item.cat2, item.cat3].filter((value): value is string =>
    Boolean(value)
  );

  return {
    id: `tourapi:${item.contentid}`,
    name: title,
    lodgingType: inferLodgingType(title, address, item.cat3),
    address,
    lat,
    lng,
    distanceMeters: distanceMeters(query.lat, query.lng, lat, lng),
    rating: null,
    reviewCount: null,
    imageUrl: item.firstimage || item.firstimage2 || null,
    source: "tourapi",
    sourceUrl: null,
    lowestPriceText: null,
    lowestPricePlatform: null,
    offers: [],
    amenities
  };
}

function inferLodgingType(name: string, address: string, category?: string): string {
  const text = `${name} ${address} ${category ?? ""}`.toLowerCase();
  if (text.includes("\uD638\uD154") || text.includes("hotel")) return "hotel";
  if (text.includes("\uB9AC\uC870\uD2B8") || text.includes("resort")) return "resort";
  if (text.includes("\uD39C\uC158") || text.includes("pension")) return "pension";
  if (text.includes("\uAC8C\uC2A4\uD2B8") || text.includes("hostel") || text.includes("guest")) return "guesthouse";
  if (text.includes("\uBAA8\uD154")) return "motel";
  if (category?.trim()) return category.trim();
  return "lodging";
}
