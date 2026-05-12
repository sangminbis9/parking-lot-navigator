import type { FreeEvent } from "@parking/shared-types";
import { BaseProviderHealth } from "../../../providers/BaseProviderHealth.js";
import { sortByStatusThenDistance } from "../common/sortDiscover.js";
import type { DiscoverQuery, EventProvider } from "../common/discoverProvider.js";
import {
  EVENT_FEED_CACHE_TTL_MS,
  EVENT_GEOCODE_ROW_LIMIT,
  EVENT_PAGE_SIZE,
  categoryFromText,
  dedupeCachedEvents,
  eventFromCached,
  extractJsonItems,
  extractTotalCount,
  fetchWithTimeout,
  getString,
  logProviderResult,
  normalizeEventForMap,
  parseDateRange,
  parseXmlItems,
  type CachedEvent,
  type EventCoordinateResolver
} from "./eventProviderUtils.js";

interface KcisaProviderInput {
  source: "kcisa_428" | "kcisa_196";
  serviceKey: string;
  baseUrl: string;
  path: string;
  defaultCategoryText: string;
  resolver?: EventCoordinateResolver;
}

export class KcisaCultureEventProvider extends BaseProviderHealth implements EventProvider {
  private cachedItems: { expiresAt: number; items: CachedEvent[] } | null = null;
  private inFlightItems: Promise<CachedEvent[]> | null = null;

  constructor(private readonly input: KcisaProviderInput) {
    super(input.source);
  }

  async events(query: DiscoverQuery): Promise<FreeEvent[]> {
    try {
      const items = await this.fetchCachedItems();
      const normalized = items
        .map((item) => eventFromCached(item, query))
        .filter((item): item is FreeEvent => Boolean(item));
      this.markSuccess(normalized.length > 0 ? 0.78 : 0.58);
      return sortByStatusThenDistance(normalized);
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }

  private async fetchCachedItems(): Promise<CachedEvent[]> {
    const now = Date.now();
    if (this.cachedItems && this.cachedItems.expiresAt > now) return this.cachedItems.items;
    if (this.inFlightItems) return this.inFlightItems;
    this.inFlightItems = this.fetchAllItems()
      .then((items) => {
        this.cachedItems = { expiresAt: now + EVENT_FEED_CACHE_TTL_MS, items };
        return items;
      })
      .finally(() => {
        this.inFlightItems = null;
      });
    return this.inFlightItems;
  }

  private async fetchAllItems(): Promise<CachedEvent[]> {
    const first = await this.fetchPage(1);
    const totalPages = Math.min(3, Math.max(1, Math.ceil((first.totalCount ?? first.rows.length) / EVENT_PAGE_SIZE)));
    const rest = await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => this.fetchPage(index + 2)));
    const rows = [...first.rows, ...rest.flatMap((page) => page.rows)];
    const items = await Promise.all(rows.map((row, index) => this.mapRow(row, index < EVENT_GEOCODE_ROW_LIMIT)));
    const normalized = dedupeCachedEvents(items.filter((item): item is CachedEvent => Boolean(item)));
    logProviderResult(this.input.source, rows.length, normalized.length);
    return normalized;
  }

  private async fetchPage(page: number): Promise<{ rows: Record<string, unknown>[]; totalCount: number | null }> {
    const url = new URL(this.input.path, this.input.baseUrl);
    url.searchParams.set("serviceKey", this.input.serviceKey.trim());
    url.searchParams.set("numOfRows", String(EVENT_PAGE_SIZE));
    url.searchParams.set("pageNo", String(page));

    const response = await fetchWithTimeout(url, { headers: { Accept: "application/json,text/xml,*/*" } });
    if (!response.ok) throw new Error(`${this.input.source} API failed: ${response.status}`);
    const text = await response.text();
    if (text.trim().startsWith("{")) {
      const body = JSON.parse(text) as unknown;
      return { rows: extractJsonItems(body), totalCount: extractTotalCount(body) };
    }
    return { rows: parseXmlItems(text), totalCount: null };
  }

  private async mapRow(row: Record<string, unknown>, resolveCoordinates: boolean): Promise<CachedEvent | null> {
    const title = getString(row, ["title", "alternativeTitle", "sourceTitle"]);
    if (!title) return null;
    const temporal = getString(row, ["eventPeriod", "temporalCoverage", "period"]);
    const dates = parseDateRange(temporal);
    const categoryText = getString(row, ["subjectCategory", "subjectKeyword", "collectionDb"]) ?? this.input.defaultCategoryText;
    return normalizeEventForMap(
      {
        source: this.input.source,
        sourceId: getString(row, ["identifier", "url", "title"]) ?? title,
        title,
        description: getString(row, ["description", "subDescription", "abstract"]),
        category: categoryFromText(categoryText),
        startDate: dates?.startDate,
        endDate: dates?.endDate,
        address: getString(row, ["spatialCoverage", "spatial", "venue"]),
        imageUrl: getString(row, ["referenceIdentifier", "thumbnail"]),
        officialUrl: getString(row, ["url", "sourceUrl"]),
        region: getString(row, ["spatialCoverage"]),
        venue: getString(row, ["spatialCoverage"]),
        updatedAt: getString(row, ["regDate", "modifiedDate"]),
        raw: row
      },
      resolveCoordinates ? this.input.resolver : undefined
    );
  }
}
