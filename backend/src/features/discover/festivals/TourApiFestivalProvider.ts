import type { Festival, ProviderHealth } from "@parking/shared-types";
import { BaseProviderHealth } from "../../../providers/BaseProviderHealth.js";
import { distanceMeters } from "../../../services/geo.js";
import type {
  DiscoverQuery,
  FestivalProvider,
} from "../common/discoverProvider.js";
import {
  discoverStatus,
  formatCompactDate,
  isWithinWindow,
  parseDate,
} from "../common/dateUtils.js";
import { sortByStatusThenDistance } from "../common/sortDiscover.js";
import {
  enrichTourApiItems,
  TourApiDetailClient,
} from "./tourApiDetailClient.js";
import { tourFestivalMaxPages } from "./tourApiFestivalConfig.js";

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

interface CachedTourFestival {
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
  sourceUrl: string | null;
  tags: string[];
}

const TOUR_FESTIVAL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TOUR_FESTIVAL_PAGE_SIZE = 100;

export class TourApiFestivalProvider
  extends BaseProviderHealth
  implements FestivalProvider
{
  private cachedItems: {
    expiresAt: number;
    items: CachedTourFestival[];
  } | null = null;
  private inFlightItems: Promise<CachedTourFestival[]> | null = null;
  private readonly detailClient: TourApiDetailClient;

  constructor(
    private readonly serviceKey: string,
    private readonly baseUrl: string,
    private readonly maxPages: number = tourFestivalMaxPages(),
  ) {
    super("tourapi-festival");
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
          source: "tourapi" as const,
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

      this.markSuccess(normalized.length > 0 ? 0.9 : 0.7);
      return sortByStatusThenDistance(normalized);
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }

  private async fetchCachedItems(
    signal?: AbortSignal,
  ): Promise<CachedTourFestival[]> {
    const now = Date.now();
    if (this.cachedItems && this.cachedItems.expiresAt > now) {
      return this.cachedItems.items;
    }
    if (this.inFlightItems) return this.inFlightItems;

    this.inFlightItems = this.fetchAllItems(signal)
      .then((items) => {
        if (items.length > 0) {
          this.cachedItems = {
            expiresAt: now + TOUR_FESTIVAL_CACHE_TTL_MS,
            items,
          };
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
  ): Promise<CachedTourFestival[]> {
    const eventStartDate = formatCompactDate(new Date());
    const first = await this.fetchPage(1, eventStartDate, signal);
    const totalCount = first.totalCount ?? first.items.length;
    const requiredPages = Math.max(
      1,
      Math.ceil(totalCount / TOUR_FESTIVAL_PAGE_SIZE),
    );
    const totalPages = Math.min(this.maxPages, requiredPages);
    if (requiredPages > totalPages) {
      console.warn(
        `tourapi-festival truncated_at_page=${totalPages} total_pages=${requiredPages} totalCount=${totalCount}; raise TOUR_FESTIVAL_MAX_PAGES to ingest more`,
      );
    }
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        this.fetchPage(index + 2, eventStartDate, signal),
      ),
    );
    const raw = [...first.items, ...rest.flatMap((page) => page.items)];
    const normalized = raw
      .map(normalizeTourFestival)
      .filter((item): item is CachedTourFestival => Boolean(item));
    const today = new Date().toISOString().slice(0, 10);
    const futureOnly = normalized.filter((item) => item.endDate >= today);
    const enriched = await enrichTourApiItems(
      futureOnly,
      this.detailClient,
      signal,
    );
    console.info(
      `tourapi-festival fetched=${raw.length} normalized=${normalized.length} future=${futureOnly.length} enriched=${enriched.length}`,
    );
    return enriched;
  }

  private async fetchPage(
    pageNo: number,
    eventStartDate: string,
    signal?: AbortSignal,
  ): Promise<{ items: TourApiFestivalItem[]; totalCount: number | null }> {
    const url = new URL("/B551011/KorService2/searchFestival2", this.baseUrl);
    url.searchParams.set("serviceKey", this.serviceKey.trim());
    url.searchParams.set("MobileOS", "ETC");
    url.searchParams.set("MobileApp", "ParkingLotNavigator");
    url.searchParams.set("_type", "json");
    url.searchParams.set("numOfRows", String(TOUR_FESTIVAL_PAGE_SIZE));
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("arrange", "E");
    url.searchParams.set("eventStartDate", eventStartDate);

    const response = await fetch(url, {
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0 ParkingLotNavigator/1.0",
        Accept: "application/json,text/plain,*/*",
      },
    });
    if (!response.ok)
      throw new Error(`TourAPI festival failed: ${response.status}`);
    const body = (await response.json()) as {
      response?: {
        header?: { resultCode?: string; resultMsg?: string };
        body?: {
          items?: { item?: TourApiFestivalItem[] | TourApiFestivalItem };
          totalCount?: number | string;
        };
      };
    };
    const resultCode = body.response?.header?.resultCode;
    if (resultCode && resultCode !== "0000") {
      throw new Error(
        `TourAPI festival failed: ${body.response?.header?.resultMsg ?? resultCode}`,
      );
    }
    const rawItems = body.response?.body?.items?.item;
    const items = Array.isArray(rawItems)
      ? rawItems
      : rawItems
        ? [rawItems]
        : [];
    const totalCountRaw = body.response?.body?.totalCount;
    const totalCount =
      typeof totalCountRaw === "number"
        ? totalCountRaw
        : typeof totalCountRaw === "string" && totalCountRaw.trim() !== ""
          ? Number(totalCountRaw)
          : null;
    return {
      items,
      totalCount: Number.isFinite(totalCount) ? totalCount : null,
    };
  }
}

function normalizeTourFestival(
  item: TourApiFestivalItem,
): CachedTourFestival | null {
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
  const startDate = parseDate(item.eventstartdate);
  const endDate = parseDate(item.eventenddate);
  return {
    id: `tourapi:${item.contentid}`,
    contentId: item.contentid,
    title: item.title,
    subtitle: item.tel ?? null,
    description: null,
    startDate,
    endDate,
    venueName: null,
    address: [item.addr1, item.addr2].filter(Boolean).join(" "),
    lat,
    lng,
    imageUrl: item.firstimage ?? null,
    sourceUrl: null,
    tags: [item.cat1, item.cat2, item.cat3].filter((value): value is string =>
      Boolean(value),
    ),
  };
}
