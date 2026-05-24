import type { FreeEvent } from "@parking/shared-types";
import { BaseProviderHealth } from "../../../providers/BaseProviderHealth.js";
import { sortByStatusThenDistance } from "../common/sortDiscover.js";
import type {
  DiscoverQuery,
  EventProvider,
} from "../common/discoverProvider.js";
import {
  EVENT_FEED_CACHE_TTL_MS,
  EVENT_GEOCODE_ROW_LIMIT,
  EVENT_PAGE_SIZE,
  KakaoEventCoordinateResolver,
  categoryFromText,
  clean,
  dedupeCachedEvents,
  eventFromCached,
  extractJsonItems,
  extractTotalCount,
  fetchWithTimeout,
  formatCompactDate,
  getNumber,
  getString,
  logProviderResult,
  normalizeEventForMap,
  parseXmlItemsAny,
  type CachedEvent,
  type EventCoordinateResolver,
  type ResolverInput,
} from "./eventProviderUtils.js";

export class CulturePortalEventProvider
  extends BaseProviderHealth
  implements EventProvider
{
  private cachedItems: { expiresAt: number; items: CachedEvent[] } | null =
    null;
  private inFlightItems: Promise<CachedEvent[]> | null = null;

  constructor(
    private readonly serviceKey: string,
    private readonly baseUrl: string,
    private readonly resolver?: EventCoordinateResolver,
  ) {
    super("culture-portal");
  }

  async events(query: DiscoverQuery): Promise<FreeEvent[]> {
    try {
      const items = await this.fetchCachedItems(query.signal);
      const normalized = items
        .map((item) => eventFromCached(item, query))
        .filter((item): item is FreeEvent => Boolean(item));
      this.markSuccess(normalized.length > 0 ? 0.86 : 0.66);
      return sortByStatusThenDistance(normalized);
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }

  private async fetchCachedItems(signal?: AbortSignal): Promise<CachedEvent[]> {
    const now = Date.now();
    if (this.cachedItems && this.cachedItems.expiresAt > now)
      return this.cachedItems.items;
    if (this.inFlightItems) return this.inFlightItems;
    this.inFlightItems = this.fetchAllItems(signal)
      .then((items) => {
        this.cachedItems = { expiresAt: now + EVENT_FEED_CACHE_TTL_MS, items };
        return items;
      })
      .finally(() => {
        this.inFlightItems = null;
      });
    return this.inFlightItems;
  }

  private async fetchAllItems(signal?: AbortSignal): Promise<CachedEvent[]> {
    const first = await this.fetchPage(1, signal);
    const totalPages = Math.min(
      5,
      Math.max(
        1,
        Math.ceil((first.totalCount ?? first.rows.length) / EVENT_PAGE_SIZE),
      ),
    );
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        this.fetchPage(index + 2, signal),
      ),
    );
    const rows = [...first.rows, ...rest.flatMap((page) => page.rows)];
    if (this.resolver?.warmup) {
      const inputs = rows
        .slice(0, EVENT_GEOCODE_ROW_LIMIT)
        .map((row) => this.resolverInputFromRow(row))
        .filter((input): input is ResolverInput => Boolean(input));
      await this.resolver.warmup(inputs);
    }
    const items = await Promise.all(
      rows.map((row, index) =>
        this.mapRow(row, index < EVENT_GEOCODE_ROW_LIMIT),
      ),
    );
    if (this.resolver?.flush) {
      await this.resolver.flush();
    }
    const normalized = dedupeCachedEvents(
      items.filter((item): item is CachedEvent => Boolean(item)),
    );
    logProviderResult("culture_portal", rows.length, normalized.length);
    return normalized;
  }

  private resolverInputFromRow(
    row: Record<string, unknown>,
  ): ResolverInput | null {
    const title = getString(row, ["title", "TITLE", "prfnm", "name"]);
    if (!title) return null;
    return {
      title,
      venue: getString(row, ["place", "placeName", "venue", "fcltynm"]),
      address: getString(row, ["placeAddr", "address", "addr", "area"]),
      region: getString(row, ["area", "sido", "region"]),
    };
  }

  private async fetchPage(
    page: number,
    signal?: AbortSignal,
  ): Promise<{ rows: Record<string, unknown>[]; totalCount: number | null }> {
    const now = new Date();
    const to = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const url = new URL("/B553457/cultureinfo/period2", this.baseUrl);
    url.searchParams.set("serviceKey", this.serviceKey.trim());
    url.searchParams.set("cPage", String(page));
    url.searchParams.set("rows", String(EVENT_PAGE_SIZE));
    url.searchParams.set("from", formatCompactDate(now));
    url.searchParams.set("to", formatCompactDate(to));
    url.searchParams.set("place", "");
    url.searchParams.set("gpsxfrom", "");
    url.searchParams.set("gpsyfrom", "");
    url.searchParams.set("gpsxto", "");
    url.searchParams.set("gpsyto", "");
    url.searchParams.set("keyword", "");
    url.searchParams.set("sortStdr", "1");

    const response = await fetchWithTimeout(url, {
      signal,
      headers: { Accept: "application/json,text/xml,*/*" },
    });
    if (!response.ok)
      throw new Error(`Culture portal API failed: ${response.status}`);
    const text = await response.text();
    if (text.trim().startsWith("{")) {
      const body = JSON.parse(text) as unknown;
      return {
        rows: extractJsonItems(body),
        totalCount: extractTotalCount(body),
      };
    }
    return {
      rows: parseXmlItemsAny(text, [
        "item",
        "perforList",
        "perforInfo",
        "publicPerformanceDisplay",
      ]),
      totalCount: null,
    };
  }

  private async mapRow(
    row: Record<string, unknown>,
    resolveCoordinates: boolean,
  ): Promise<CachedEvent | null> {
    const title = getString(row, ["title", "TITLE", "prfnm", "name"]);
    if (!title) return null;
    const categoryText = getString(row, [
      "realmName",
      "realmNameKr",
      "category",
      "subjectCategory",
      "codename",
    ]);
    const startDate = getString(row, [
      "startDate",
      "startdate",
      "startDt",
      "from",
      "periodStart",
    ]);
    const endDate =
      getString(row, ["endDate", "enddate", "endDt", "to", "periodEnd"]) ??
      startDate;
    return normalizeEventForMap(
      {
        source: "culture_portal",
        sourceId:
          getString(row, ["seq", "id", "contentId", "contentsId"]) ?? title,
        title,
        description: getString(row, [
          "contents1",
          "contents2",
          "description",
          "subTitle",
        ]),
        category: categoryFromText(categoryText ?? title),
        startDate,
        endDate,
        address: getString(row, ["placeAddr", "address", "addr", "area"]),
        lat: getNumber(row, ["gpsY", "gpsy", "lat", "latitude", "y"]),
        lng: getNumber(row, ["gpsX", "gpsx", "lng", "longitude", "x"]),
        imageUrl: getString(row, ["thumbnail", "image", "imgUrl", "imageUrl"]),
        officialUrl: getString(row, [
          "url",
          "placeUrl",
          "homepage",
          "homepageUrl",
        ]),
        price: getString(row, ["price", "charge", "useFee"]),
        region: getString(row, ["area", "sido", "region"]),
        venue: getString(row, ["place", "placeName", "venue", "fcltynm"]),
        updatedAt: getString(row, ["regDate", "modifiedDate", "updateDate"]),
        isFree:
          clean(getString(row, ["price", "charge", "useFee"]))?.includes(
            "\uBB34\uB8CC",
          ) ?? null,
        raw: row,
      },
      resolveCoordinates ? this.resolver : undefined,
    );
  }
}

export function createCulturePortalResolver(
  config: ConstructorParameters<typeof KakaoEventCoordinateResolver>[0],
): EventCoordinateResolver {
  return new KakaoEventCoordinateResolver(config);
}
