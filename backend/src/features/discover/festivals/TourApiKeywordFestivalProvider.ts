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
  DETAIL_ENRICH_CONCURRENCY,
  enrichTourApiItems,
  mapWithConcurrency,
  resolveEventDates,
  TourApiDetailClient,
} from "./tourApiDetailClient.js";
import {
  tourAreaDateResolveMaxItems,
  tourEnrichMaxItems,
  tourFestivalMaxPages,
} from "./tourApiFestivalConfig.js";

interface TourKeywordItem {
  contentid?: string;
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
}

interface CachedKeywordFestival {
  id: string;
  contentId: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  startDate: string;
  endDate: string;
  venueName: string | null;
  address: string;
  lat: number;
  lng: number;
  imageUrl: string | null;
  imageUrls: string[];
  sourceUrl: string | null;
  tags: string[];
  admissionFee: string | null;
  discountInfo: string | null;
  bookingInfo: string | null;
  contactPhone: string | null;
  ageLimit: string | null;
  programInfo: string | null;
  organizerName: string | null;
}

type ShapedKeywordFestival = Omit<CachedKeywordFestival, "startDate" | "endDate">;

const TOUR_KEYWORD_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TOUR_KEYWORD_PAGE_SIZE = 100;
const TOUR_KEYWORD_CAT3 = ["A02070100", "A02070200", "A02070300"];

export class TourApiKeywordFestivalProvider
  extends BaseProviderHealth
  implements FestivalProvider
{
  private cachedItems: {
    expiresAt: number;
    items: CachedKeywordFestival[];
  } | null = null;
  private inFlightItems: Promise<CachedKeywordFestival[]> | null = null;
  private readonly detailClient: TourApiDetailClient;

  constructor(
    private readonly serviceKey: string,
    private readonly baseUrl: string,
    private readonly maxPages: number = tourFestivalMaxPages(),
  ) {
    super("tourapi-keyword-festival");
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
          source: "keyword-tour",
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
  ): Promise<CachedKeywordFestival[]> {
    const now = Date.now();
    if (this.cachedItems && this.cachedItems.expiresAt > now) {
      return this.cachedItems.items;
    }
    if (this.inFlightItems) return this.inFlightItems;
    this.inFlightItems = this.fetchAllItems(signal)
      .then((items) => {
        this.cachedItems = {
          expiresAt: now + TOUR_KEYWORD_CACHE_TTL_MS,
          items,
        };
        return items;
      })
      .finally(() => {
        this.inFlightItems = null;
      });
    return this.inFlightItems;
  }

  private async fetchAllItems(
    signal?: AbortSignal,
  ): Promise<CachedKeywordFestival[]> {
    // See TourApiAreaFestivalProvider: throttle fetch fan-out to stay under
    // Cloudflare Workers' concurrent in-flight fetch() limit.
    const pages = await mapWithConcurrency(
      TOUR_KEYWORD_CAT3,
      DETAIL_ENRICH_CONCURRENCY,
      (cat3) => this.fetchCat3(cat3, signal),
    );
    const raw = pages.flat();
    const today = new Date().toISOString().slice(0, 10);
    // searchKeyword2 never returns eventstartdate/eventenddate on its list
    // items (unlike searchFestival2), so dates have to come from a
    // per-item detailIntro2 lookup before we can filter to upcoming ones.
    const shaped = shuffle(
      raw
        .map(shapeKeywordFestival)
        .filter((item): item is ShapedKeywordFestival => Boolean(item)),
    );
    const withDates = await resolveEventDates(
      shaped,
      this.detailClient,
      signal,
      tourAreaDateResolveMaxItems(),
    );
    const normalized: CachedKeywordFestival[] = withDates
      .filter(
        (item): item is typeof item & { eventStartDate: string; eventEndDate: string } =>
          Boolean(item.eventStartDate) && Boolean(item.eventEndDate),
      )
      .map((item) => ({
        ...item,
        startDate: parseDate(item.eventStartDate),
        endDate: parseDate(item.eventEndDate),
      }))
      .filter((item) => item.endDate >= today);
    const enriched = await enrichTourApiItems(
      normalized,
      this.detailClient,
      signal,
      tourEnrichMaxItems(),
    );
    console.info(
      `tourapi-keyword-festival fetched=${raw.length} shaped=${shaped.length} dated=${normalized.length} enriched=${enriched.length}`,
    );
    return dedupeKeywordFestivals(enriched);
  }

  private async fetchCat3(
    cat3: string,
    signal?: AbortSignal,
  ): Promise<TourKeywordItem[]> {
    const first = await this.fetchPage(cat3, 1, signal);
    const totalCount = first.totalCount ?? first.items.length;
    const requiredPages = Math.max(
      1,
      Math.ceil(totalCount / TOUR_KEYWORD_PAGE_SIZE),
    );
    const totalPages = Math.min(this.maxPages, requiredPages);
    if (requiredPages > totalPages) {
      console.warn(
        `tourapi-keyword-festival cat3=${cat3} truncated_at_page=${totalPages} total_pages=${requiredPages} totalCount=${totalCount}; raise TOUR_FESTIVAL_MAX_PAGES to ingest more`,
      );
    }
    const pageNumbers = Array.from(
      { length: totalPages - 1 },
      (_, index) => index + 2,
    );
    const rest = await mapWithConcurrency(
      pageNumbers,
      DETAIL_ENRICH_CONCURRENCY,
      (pageNo) => this.fetchPage(cat3, pageNo, signal),
    );
    return [first.items, ...rest.map((page) => page.items)].flat();
  }

  private async fetchPage(
    cat3: string,
    pageNo: number,
    signal?: AbortSignal,
  ): Promise<{ items: TourKeywordItem[]; totalCount: number | null }> {
    const url = new URL("/B551011/KorService2/searchKeyword2", this.baseUrl);
    url.searchParams.set("serviceKey", this.serviceKey.trim());
    url.searchParams.set("MobileOS", "ETC");
    url.searchParams.set("MobileApp", "ParkingLotNavigator");
    url.searchParams.set("_type", "json");
    url.searchParams.set("keyword", "\uCD95\uC81C");
    url.searchParams.set("cat1", "A02");
    url.searchParams.set("cat2", "A0207");
    url.searchParams.set("cat3", cat3);
    url.searchParams.set("numOfRows", String(TOUR_KEYWORD_PAGE_SIZE));
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
      throw new Error(`TourAPI keyword festival failed: ${response.status}`);
    }
    return parseTourResponse(await response.json());
  }
}

function shapeKeywordFestival(
  item: TourKeywordItem,
): ShapedKeywordFestival | null {
  const lat = Number(item.mapy);
  const lng = Number(item.mapx);
  if (
    !item.contentid ||
    !item.title ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }
  const imageUrls = [item.firstimage, item.firstimage2]
    .filter((url): url is string => Boolean(url?.trim()))
    .filter((url, i, arr) => arr.indexOf(url) === i);
  return {
    id: `keyword-tour:${item.contentid}`,
    contentId: item.contentid,
    title: item.title,
    subtitle: null,
    description: null,
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
    admissionFee: null,
    discountInfo: null,
    bookingInfo: null,
    contactPhone: null,
    ageLimit: null,
    programInfo: null,
    organizerName: null,
  };
}

function parseTourResponse(body: unknown): {
  items: TourKeywordItem[];
  totalCount: number | null;
} {
  const response = body as {
    response?: {
      header?: { resultCode?: string; resultMsg?: string };
      body?: {
        items?: { item?: TourKeywordItem[] | TourKeywordItem };
        totalCount?: number | string;
      };
    };
  };
  const code = response.response?.header?.resultCode;
  if (code && code !== "0000") {
    throw new Error(
      `TourAPI keyword festival failed: ${response.response?.header?.resultMsg ?? code}`,
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

// resolveEventDates only affords a handful of candidates per sync cycle
// (see tourAreaDateResolveMaxItems), so shuffling avoids always spending
// that budget on the same cat3-ordered prefix every cache refresh.
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function dedupeKeywordFestivals(
  items: CachedKeywordFestival[],
): CachedKeywordFestival[] {
  const selected = new Map<string, CachedKeywordFestival>();
  for (const item of items) selected.set(item.id, item);
  return [...selected.values()];
}
