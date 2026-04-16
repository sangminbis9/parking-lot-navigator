import type { Festival, ProviderHealth } from "@parking/shared-types";
import { BaseProviderHealth } from "../../../providers/BaseProviderHealth.js";
import { distanceMeters } from "../../../services/geo.js";
import type { DiscoverQuery, FestivalProvider } from "../common/discoverProvider.js";
import { discoverStatus, formatCompactDate, isWithinWindow, parseDate } from "../common/dateUtils.js";
import { sortByStatusThenDistance } from "../common/sortDiscover.js";

interface TourApiFestivalItem {
  contentid?: string;
  title?: string;
  addr1?: string;
  addr2?: string;
  eventstartdate?: string;
  eventenddate?: string;
  firstimage?: string;
  mapx?: string;
  mapy?: string;
  tel?: string;
  cat1?: string;
  cat2?: string;
  cat3?: string;
}

export class TourApiFestivalProvider extends BaseProviderHealth implements FestivalProvider {
  constructor(
    private readonly serviceKey: string,
    private readonly baseUrl: string
  ) {
    super("tourapi-festival");
  }

  async festivals(query: DiscoverQuery): Promise<Festival[]> {
    try {
      const url = new URL("/B551011/KorService2/searchFestival2", this.baseUrl);
      url.searchParams.set("serviceKey", this.serviceKey.trim());
      url.searchParams.set("MobileOS", "ETC");
      url.searchParams.set("MobileApp", "ParkingLotNavigator");
      url.searchParams.set("_type", "json");
      url.searchParams.set("numOfRows", "100");
      url.searchParams.set("pageNo", "1");
      url.searchParams.set("arrange", "E");
      url.searchParams.set("eventStartDate", formatCompactDate(new Date()));

      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 ParkingLotNavigator/1.0",
          Accept: "application/json,text/plain,*/*"
        }
      });
      if (!response.ok) throw new Error(`TourAPI festival failed: ${response.status}`);
      const body = (await response.json()) as {
        response?: {
          header?: { resultCode?: string; resultMsg?: string };
          body?: { items?: { item?: TourApiFestivalItem[] | TourApiFestivalItem } };
        };
      };
      const resultCode = body.response?.header?.resultCode;
      if (resultCode && resultCode !== "0000") {
        throw new Error(`TourAPI festival failed: ${body.response?.header?.resultMsg ?? resultCode}`);
      }
      const rawItems = body.response?.body?.items?.item;
      const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
      const normalized = items
        .map((item) => normalizeTourFestival(item, query))
        .filter((item): item is Festival => Boolean(item))
        .filter((item) => item.distanceMeters <= query.radiusMeters)
        .filter((item) => isWithinWindow(item.startDate, item.endDate, query.upcomingWithinDays))
        .filter((item) => !query.ongoingOnly || item.status === "ongoing");

      this.markSuccess(normalized.length > 0 ? 0.9 : 0.7);
      return sortByStatusThenDistance(normalized);
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }
}

function normalizeTourFestival(item: TourApiFestivalItem, query: DiscoverQuery): Festival | null {
  const lat = Number(item.mapy);
  const lng = Number(item.mapx);
  if (!item.contentid || !item.title || !item.eventstartdate || !item.eventenddate || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  const startDate = parseDate(item.eventstartdate);
  const endDate = parseDate(item.eventenddate);
  return {
    id: `tourapi:${item.contentid}`,
    title: item.title,
    subtitle: item.tel ?? null,
    startDate,
    endDate,
    status: discoverStatus(startDate, endDate),
    venueName: null,
    address: [item.addr1, item.addr2].filter(Boolean).join(" "),
    lat,
    lng,
    distanceMeters: distanceMeters(query.lat, query.lng, lat, lng),
    source: "tourapi",
    sourceUrl: null,
    imageUrl: item.firstimage ?? null,
    tags: [item.cat1, item.cat2, item.cat3].filter((value): value is string => Boolean(value))
  };
}
