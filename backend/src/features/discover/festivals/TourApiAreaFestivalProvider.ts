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
  mapWithConcurrency,
  resolveEventDates,
  TourApiDetailClient,
} from "./tourApiDetailClient.js";
import {
  tourAreaDateResolveMaxItems,
  tourAreaFestivalMaxPages,
  tourEnrichMaxItems,
} from "./tourApiFestivalConfig.js";

interface TourAreaItem {
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

interface CachedAreaFestival {
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

type ShapedAreaFestival = Omit<CachedAreaFestival, "startDate" | "endDate">;

const TOUR_AREA_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TOUR_AREA_FAILURE_COOLDOWN_MS = 60 * 1000;
const TOUR_AREA_PAGE_SIZE = 100;
const AREA_FETCH_CONCURRENCY = 2;
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
  private lastFailureAt: number | null = null;
  private readonly detailClient: TourApiDetailClient;

  constructor(
    private readonly serviceKey: string,
    private readonly baseUrl: string,
    private readonly maxPages: number = tourAreaFestivalMaxPages(),
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
    if (
      this.lastFailureAt &&
      now - this.lastFailureAt < TOUR_AREA_FAILURE_COOLDOWN_MS
    ) {
      throw new Error(
        "tourapi-area-festival: skipping retry, recent attempt failed",
      );
    }
    this.inFlightItems = this.fetchAllItems(signal)
      .then((items) => {
        this.cachedItems = { expiresAt: now + TOUR_AREA_CACHE_TTL_MS, items };
        return items;
      })
      .catch((error) => {
        this.lastFailureAt = Date.now();
        throw error;
      })
      .finally(() => {
        this.inFlightItems = null;
      });
    return this.inFlightItems;
  }

  private async fetchAllItems(
    signal?: AbortSignal,
  ): Promise<CachedAreaFestival[]> {
    // Firing all 17 area-code fetches via Promise.all exceeds Cloudflare
    // Workers' concurrent in-flight fetch() limit, which cancels the oldest
    // stalled response and breaks its .json() read. Throttle the fan-out.
    // TourAPI itself also rate-limits (HTTP 429) when too many requests land
    // within the same second, so this stays well below DETAIL_ENRICH_CONCURRENCY.
    const pages = await mapWithConcurrency(
      TOUR_AREA_CODES,
      AREA_FETCH_CONCURRENCY,
      (areaCode) => this.fetchArea(areaCode, signal),
    );
    const raw = pages.flat();
    const today = new Date().toISOString().slice(0, 10);
    // areaBasedList2 never returns eventstartdate/eventenddate on its list
    // items (unlike searchFestival2), so dates have to come from a
    // per-item detailIntro2 lookup before we can filter to upcoming ones.
    const shaped = shuffle(
      raw
        .map(shapeAreaFestival)
        .filter((item): item is ShapedAreaFestival => Boolean(item)),
    );
    const withDates = await resolveEventDates(
      shaped,
      this.detailClient,
      signal,
      tourAreaDateResolveMaxItems(),
    );
    const normalized: CachedAreaFestival[] = withDates
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
      `tourapi-area-festival fetched=${raw.length} shaped=${shaped.length} dated=${normalized.length} enriched=${enriched.length}`,
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
    const rest: TourAreaItem[][] = [];
    for (let page = 2; page <= totalPages; page += 1) {
      const result = await this.fetchPage(areaCode, page, signal);
      rest.push(result.items);
    }
    return [first.items, ...rest].flat();
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

function shapeAreaFestival(item: TourAreaItem): ShapedAreaFestival | null {
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
  // firstimage2는 firstimage의 썸네일(같은 사진 저해상도)이라 둘 다 담으면
  // 갤러리에 같은 사진이 두 장으로 보인다. 원본이 없을 때만 대체로 쓴다.
  const imageUrls = [item.firstimage?.trim() || item.firstimage2?.trim()].filter(
    (url): url is string => Boolean(url),
  );
  return {
    id: `area-based-tour:${item.contentid}`,
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

// resolveEventDates only affords a handful of candidates per sync cycle
// (see tourAreaDateResolveMaxItems), so shuffling avoids always spending
// that budget on the same area-code-1 prefix every cache refresh.
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function dedupeAreaFestivals(
  items: CachedAreaFestival[],
): CachedAreaFestival[] {
  const selected = new Map<string, CachedAreaFestival>();
  for (const item of items) selected.set(item.id, item);
  return [...selected.values()];
}
