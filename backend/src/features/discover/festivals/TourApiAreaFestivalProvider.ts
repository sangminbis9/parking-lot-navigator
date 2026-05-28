import type { Festival } from "@parking/shared-types";
import { BaseProviderHealth } from "../../../providers/BaseProviderHealth.js";
import { distanceMeters } from "../../../services/geo.js";
import type {
  DiscoverQuery,
  FestivalProvider,
} from "../common/discoverProvider.js";
import {
  discoverStatus,
  isWithinWindow,
  parseDate,
} from "../common/dateUtils.js";
import { sortByStatusThenDistance } from "../common/sortDiscover.js";
import {
  enrichTourApiItems,
  TourApiDetailClient,
} from "./tourApiDetailClient.js";
import { tourFestivalMaxPages } from "./tourApiFestivalConfig.js";

interface TourAreaItem {
  contentid?: string;
  title?: string;
  addr1?: string;
  addr2?: string;
  eventstartdate?: string;
  eventenddate?: string;
  firstimage?: string;
  firstimage2?: string;
  mapx?: string;
  mapy?: string;
  tel?: string;
  cat1?: string;
  cat2?: string;
  cat3?: string;
}

interface CachedAreaFestival {
  id: string;
  contentId: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  startDate: string;
  endDate: string;
  venueName: null;
  address: string;
  lat: number;
  lng: number;
  imageUrl: string | null;
  imageUrls: string[];
  sourceUrl: string | null;
  tags: string[];
}

const TOUR_AREA_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TOUR_AREA_PAGE_SIZE = 100;
const TOUR_AREA_CODES = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "31",
  "32",
  "33",
  "34",
  "35",
  "36",
  "37",
  "38",
  "39",
];

export class TourApiAreaFestivalProvider
  extends BaseProviderHealth
  implements FestivalProvider
{
  private cachedItems: {
    expiresAt: number;
    items: CachedAreaFestival[];
  } | null = null;
  private inFlightItems: Promise<CachedAreaFestival[]> | null = null;
  private readonly detailClient: TourApiDetailClient;

  constructor(
    private readonly serviceKey: string,
    private readonly baseUrl: string,
    private readonly maxPages: number = tourFestivalMaxPages(),
  ) {
    super("tourapi-area-festival");
    this.detailClient = new TourApiDetailClient(serviceKey, baseUrl);
  }

  async festivals(query: DiscoverQuery): Promise<Festival[]> {
    try {
      const items = await this.fetchCachedItems(query.signal);
      const normalized = items
        .map((item) => ({
          ...item,
          status: discoverStatus(item.startDate, item.endDate),
          distanceMeters: distanceMeters(
            query.lat,
            query.lng,
            item.lat,
            item.lng,
          ),
          source: "area-based-tour",
          sourceUrl: item.sourceUrl,
        }))
        .filter((item) => item.distanceMeters <= query.radiusMeters)
        .filter((item) =>
          isWithinWindow(
            item.startDate,
            item.endDate,
            query.upcomingWithinDays,
          ),
        )
        .filter((item) => !query.ongoingOnly || item.status === "ongoing");
      this.markSuccess(normalized.length > 0 ? 0.82 : 0.65);
      return sortByStatusThenDistance(normalized);
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }

  private async fetchCachedItems(
    signal?: AbortSignal,
  ): Promise<CachedAreaFestival[]> {
    const now = Date.now();
    if (this.cachedItems && this.cachedItems.expiresAt > now) {
      return this.cachedItems.items;
    }
    if (this.inFlightItems) return this.inFlightItems;
    this.inFlightItems = this.fetchAllItems(signal)
      .then((items) => {
        if (items.length > 0) {
          this.cachedItems = { expiresAt: now + TOUR_AREA_CACHE_TTL_MS, items };
        }
        return items;
      })
      .finally(() => {
        this.inFlightItems = null;
      });
    return this.inFlightItems;
  }

  private async fetchAllItems(
    signal?: AbortSignal,
  ): Promise<CachedAreaFestival[]> {
    const pages = await Promise.all(
      TOUR_AREA_CODES.map((areaCode) => this.fetchArea(areaCode, signal)),
    );
    const raw = pages.flat();
    const today = new Date().toISOString().slice(0, 10);
    const normalized = raw
      .map(normalizeAreaFestival)
      .filter((item): item is CachedAreaFestival => Boolean(item))
      .filter((item) => item.endDate >= today);
    const enriched = await enrichTourApiItems(
      normalized,
      this.detailClient,
      signal,
    );
    console.info(
      `tourapi-area-festival fetched=${raw.length} normalized=${normalized.length} enriched=${enriched.length}`,
    );
    return dedupeAreaFestivals(enriched);
  }

  private async fetchArea(
    areaCode: string,
    signal?: AbortSignal,
  ): Promise<TourAreaItem[]> {
    const first = await this.fetchPage(areaCode, 1, signal);
    const totalCount = first.totalCount ?? first.items.length;
    const requiredPages = Math.max(
      1,
      Math.ceil(totalCount / TOUR_AREA_PAGE_SIZE),
    );
    const totalPages = Math.min(this.maxPages, requiredPages);
    if (requiredPages > totalPages) {
      console.warn(
        `tourapi-area-festival areaCode=${areaCode} truncated_at_page=${totalPages} total_pages=${requiredPages} totalCount=${totalCount}; raise TOUR_FESTIVAL_MAX_PAGES to ingest more`,
      );
    }
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        this.fetchPage(areaCode, index + 2, signal),
      ),
    );
    return [first.items, ...rest.map((page) => page.items)].flat();
  }

  private async fetchPage(
    areaCode: string,
    pageNo: number,
    signal?: AbortSignal,
  ): Promise<{ items: TourAreaItem[]; totalCount: number | null }> {
    const url = new URL("/B551011/KorService2/areaBasedList2", this.baseUrl);
    url.searchParams.set("serviceKey", this.serviceKey.trim());
    url.searchParams.set("MobileOS", "ETC");
    url.searchParams.set("MobileApp", "ParkingLotNavigator");
    url.searchParams.set("_type", "json");
    url.searchParams.set("contentTypeId", "15");
    url.searchParams.set("areaCode", areaCode);
    url.searchParams.set("cat1", "A02");
    url.searchParams.set("cat2", "A0207");
    url.searchParams.set("numOfRows", String(TOUR_AREA_PAGE_SIZE));
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("arrange", "E");

    const response = await fetch(url, {
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0 ParkingLotNavigator/1.0",
        Accept: "application/json,text/plain,*/*",
      },
    });
    if (!response.ok) {
      throw new Error(`TourAPI area festival failed: ${response.status}`);
    }
    return parseTourResponse(await response.json());
  }
}

function normalizeAreaFestival(item: TourAreaItem): CachedAreaFestival | null {
  const lat = Number(item.mapy);
  const lng = Number(item.mapx);
  if (
    !item.contentid ||
    !item.title ||
    !item.eventstartdate ||
    !item.eventenddate ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }
  const imageUrls = [item.firstimage, item.firstimage2]
    .filter((url): url is string => Boolean(url?.trim()))
    .filter((url, i, arr) => arr.indexOf(url) === i);
  return {
    id: `area-based-tour:${item.contentid}`,
    contentId: item.contentid,
    title: item.title,
    subtitle: item.tel ?? null,
    description: null,
    startDate: parseDate(item.eventstartdate),
    endDate: parseDate(item.eventenddate),
    venueName: null,
    address: [item.addr1, item.addr2].filter(Boolean).join(" "),
    lat,
    lng,
    imageUrl: imageUrls[0] ?? null,
    imageUrls,
    sourceUrl: null,
    tags: [item.cat1, item.cat2, item.cat3].filter((value): value is string =>
      Boolean(value),
    ),
  };
}

function parseTourResponse(body: unknown): {
  items: TourAreaItem[];
  totalCount: number | null;
} {
  const response = body as {
    response?: {
      header?: { resultCode?: string; resultMsg?: string };
      body?: {
        items?: { item?: TourAreaItem[] | TourAreaItem };
        totalCount?: number | string;
      };
    };
  };
  const code = response.response?.header?.resultCode;
  if (code && code !== "0000") {
    throw new Error(
      `TourAPI area festival failed: ${response.response?.header?.resultMsg ?? code}`,
    );
  }
  const rawItems = response.response?.body?.items?.item;
  const totalCountRaw = response.response?.body?.totalCount;
  const totalCount =
    typeof totalCountRaw === "number"
      ? totalCountRaw
      : typeof totalCountRaw === "string" && totalCountRaw.trim() !== ""
        ? Number(totalCountRaw)
        : null;
  return {
    items: Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [],
    totalCount: Number.isFinite(totalCount) ? totalCount : null,
  };
}

function dedupeAreaFestivals(
  items: CachedAreaFestival[],
): CachedAreaFestival[] {
  const selected = new Map<string, CachedAreaFestival>();
  for (const item of items) selected.set(item.id, item);
  return [...selected.values()];
}
