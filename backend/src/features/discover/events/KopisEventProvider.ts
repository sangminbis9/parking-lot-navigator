import type { FreeEvent } from "@parking/shared-types";
import { BaseProviderHealth } from "../../../providers/BaseProviderHealth.js";
import { sortByStatusThenDistance } from "../common/sortDiscover.js";
import type {
  DiscoverQuery,
  EventProvider,
} from "../common/discoverProvider.js";
import {
  kopisDetailMaxItems,
  eventGeocodeMissBudget,
  kopisMaxPages,
} from "./eventProviderConfig.js";
import {
  EVENT_FEED_CACHE_TTL_MS,
  EVENT_PAGE_SIZE,
  categoryFromText,
  dedupeCachedEvents,
  eventFromCached,
  fetchWithTimeout,
  formatCompactDate,
  getString,
  logProviderResult,
  normalizeEventForMap,
  parseXmlItems,
  regionFallbackCoordinate,
  type CachedEvent,
  type EventCoordinateResolver,
  type ResolverInput,
} from "./eventProviderUtils.js";

export class KopisEventProvider
  extends BaseProviderHealth
  implements EventProvider
{
  private cachedItems: { expiresAt: number; items: CachedEvent[] } | null =
    null;
  private inFlightItems: Promise<CachedEvent[]> | null = null;
  private readonly detailCache = new Map<
    string,
    Promise<Record<string, unknown> | null>
  >();

  constructor(
    private readonly serviceKey: string,
    private readonly baseUrl: string,
    private readonly resolver?: EventCoordinateResolver,
    private readonly maxPages: number = kopisMaxPages(),
    private readonly detailMaxItems: number = kopisDetailMaxItems(),
  ) {
    super("kopis");
  }

  async events(query: DiscoverQuery): Promise<FreeEvent[]> {
    try {
      const items = await this.fetchCachedItems(query.signal);
      const normalized = items
        .map((item) => eventFromCached(item, query))
        .filter((item): item is FreeEvent => Boolean(item));
      this.markSuccess(normalized.length > 0 ? 0.82 : 0.62);
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
    const rows: Record<string, unknown>[] = [];
    for (let page = 1; page <= this.maxPages; page += 1) {
      const pageRows = await this.fetchPage(page, signal);
      rows.push(...pageRows);
      if (pageRows.length < EVENT_PAGE_SIZE) break;
    }
    this.resolver?.setMissBudget?.(eventGeocodeMissBudget());
    if (this.resolver?.warmup) {
      const inputs = rows
        .map((row) => this.resolverInputFromRow(row))
        .filter((input): input is ResolverInput => Boolean(input));
      await this.resolver.warmup(inputs);
    }
    const rowsForDetail = rows.slice(0, this.detailMaxItems);
    const detailById = new Map<string, Record<string, unknown>>();
    const details = await mapWithConcurrency(rowsForDetail, 3, async (row) => {
      const id = getString(row, ["mt20id", "id"]);
      const detail = await this.fetchDetailForRow(row, signal);
      return id && detail ? { id, detail } : null;
    });
    for (const entry of details) {
      if (entry) detailById.set(entry.id, entry.detail);
    }
    const enrichedRows = rows.map((row) => {
      const id = getString(row, ["mt20id", "id"]);
      const detail = id ? detailById.get(id) : null;
      return detail ? { ...row, ...detail } : row;
    });
    const items = await Promise.all(
      enrichedRows.map((row) => this.mapRow(row, true)),
    );
    if (this.resolver?.flush) {
      await this.resolver.flush();
    }
    const normalized = dedupeCachedEvents(
      items.filter((item): item is CachedEvent => Boolean(item)),
    );
    logProviderResult("kopis", rows.length, normalized.length);
    return normalized;
  }

  private resolverInputFromRow(
    row: Record<string, unknown>,
  ): ResolverInput | null {
    const title = getString(row, ["prfnm", "title"]);
    if (!title) return null;
    return {
      title,
      venue: getString(row, ["fcltynm", "prfplcnm", "venue"]),
      address: getString(row, ["adres", "address"]),
      region: getString(row, ["area", "sido", "region"]),
    };
  }

  private async fetchPage(
    page: number,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]> {
    const now = new Date();
    const to = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const url = new URL("/openApi/restful/pblprfr", this.baseUrl);
    url.searchParams.set("service", this.serviceKey.trim());
    url.searchParams.set("stdate", formatCompactDate(now));
    url.searchParams.set("eddate", formatCompactDate(to));
    url.searchParams.set("cpage", String(page));
    url.searchParams.set("rows", String(EVENT_PAGE_SIZE));
    url.searchParams.set("shcate", "");

    const response = await fetchWithTimeout(url, {
      signal,
      headers: { Accept: "application/xml,text/xml,*/*" },
    });
    if (!response.ok) throw new Error(`KOPIS API failed: ${response.status}`);
    return parseXmlItems(await response.text(), "db");
  }

  private async fetchDetailForRow(
    row: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown> | null> {
    const id = getString(row, ["mt20id", "id"]);
    if (!id) return null;
    const cached = this.detailCache.get(id);
    if (cached) return cached;
    const promise = this.fetchDetail(id, signal).catch(() => null);
    this.detailCache.set(id, promise);
    return promise;
  }

  private async fetchDetail(
    id: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown> | null> {
    const url = new URL(`/openApi/restful/pblprfr/${id}`, this.baseUrl);
    url.searchParams.set("service", this.serviceKey.trim());
    const response = await fetchWithTimeout(url, {
      signal,
      headers: { Accept: "application/xml,text/xml,*/*" },
    });
    if (!response.ok) throw new Error(`KOPIS detail API failed: ${response.status}`);
    return parseXmlItems(await response.text(), "db")[0] ?? null;
  }

  private async mapRow(
    row: Record<string, unknown>,
    resolveCoordinates: boolean,
  ): Promise<CachedEvent | null> {
    const title = getString(row, ["prfnm", "title"]);
    if (!title) return null;
    const genre = getString(row, ["genrenm", "genre", "category"]);
    const venue = getString(row, ["fcltynm", "prfplcnm", "venue"]);
    const region = getString(row, ["area", "sido", "region"]);
    const address = getString(row, ["adres", "address"]);
    const fallback =
      regionFallbackCoordinate(address) ?? regionFallbackCoordinate(region);
    return normalizeEventForMap(
      {
        source: "kopis",
        sourceId: getString(row, ["mt20id", "id"]) ?? title,
        title,
        description:
          getString(row, ["sty", "description", "dtguidance", "prfcast"]) ??
          getString(row, ["prfstate"]),
        category: categoryFromText(genre ?? "performance"),
        startDate: getString(row, ["prfpdfrom", "startDate"]),
        endDate: getString(row, ["prfpdto", "endDate"]),
        address,
        lat: fallback?.lat,
        lng: fallback?.lng,
        imageUrl: getString(row, ["poster", "imageUrl"]),
        officialUrl: getString(row, ["relateurl", "url", "styurl"]),
        price: getString(row, ["pcseguidance", "price"]),
        region,
        venue,
        raw: row,
      },
      resolveCoordinates ? this.resolver : undefined,
    );
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]);
      }
    }),
  );
  return results;
}
