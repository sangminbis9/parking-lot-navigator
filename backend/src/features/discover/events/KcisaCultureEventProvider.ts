import type { FreeEvent } from "@parking/shared-types";
import { BaseProviderHealth } from "../../../providers/BaseProviderHealth.js";
import { sortByStatusThenDistance } from "../common/sortDiscover.js";
import type {
  DiscoverQuery,
  EventProvider,
} from "../common/discoverProvider.js";
import {
  eventGeocodeMissBudget,
  kcisaMaxPages,
} from "./eventProviderConfig.js";
import {
  EVENT_FEED_CACHE_TTL_MS,
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
  regionFallbackCoordinate,
  type CachedEvent,
  type EventCoordinateResolver,
  type ResolverInput,
} from "./eventProviderUtils.js";

interface KcisaProviderInput {
  source: "kcisa_428" | "kcisa_196";
  serviceKey: string;
  baseUrl: string;
  path: string;
  defaultCategoryText: string;
  resolver?: EventCoordinateResolver;
  maxPages?: number;
}

export class KcisaCultureEventProvider
  extends BaseProviderHealth
  implements EventProvider
{
  private cachedItems: { expiresAt: number; items: CachedEvent[] } | null =
    null;
  private inFlightItems: Promise<CachedEvent[]> | null = null;

  constructor(private readonly input: KcisaProviderInput) {
    super(input.source);
  }

  async events(query: DiscoverQuery): Promise<FreeEvent[]> {
    try {
      const items = await this.fetchCachedItems(query.signal);
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

  private async fetchCachedItems(signal?: AbortSignal): Promise<CachedEvent[]> {
    const now = Date.now();
    if (this.cachedItems && this.cachedItems.expiresAt > now)
      return this.cachedItems.items;
    if (this.inFlightItems) return this.inFlightItems;
    this.inFlightItems = this.fetchAllItems(signal)
      .then((items) => {
        if (items.length > 0) {
          this.cachedItems = {
            expiresAt: now + EVENT_FEED_CACHE_TTL_MS,
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

  private async fetchAllItems(signal?: AbortSignal): Promise<CachedEvent[]> {
    const first = await this.fetchPage(1, signal);
    const maxPages = this.input.maxPages ?? kcisaMaxPages();
    const requiredPages = Math.max(
      1,
      Math.ceil((first.totalCount ?? first.rows.length) / EVENT_PAGE_SIZE),
    );
    const totalPages = Math.min(maxPages, requiredPages);
    if (requiredPages > totalPages) {
      console.warn(
        `${this.input.source} truncated_at_page=${totalPages} total_pages=${requiredPages} totalCount=${first.totalCount}; raise KCISA_MAX_PAGES to ingest more`,
      );
    }
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        this.fetchPage(index + 2, signal),
      ),
    );
    const rows = [...first.rows, ...rest.flatMap((page) => page.rows)];
    const today = new Date().toISOString().slice(0, 10);
    const futureRows = rows.filter((row) => rowEndsOnOrAfter(row, today));
    this.input.resolver?.setMissBudget?.(eventGeocodeMissBudget());
    if (this.input.resolver?.warmup) {
      const warmupInputs = futureRows
        .map((row) => this.resolverInputFromRow(row))
        .filter((input): input is ResolverInput => Boolean(input));
      await this.input.resolver.warmup(warmupInputs);
    }
    const items = await Promise.all(
      futureRows.map((row) => this.mapRow(row, true)),
    );
    if (this.input.resolver?.flush) {
      await this.input.resolver.flush();
    }
    const normalized = dedupeCachedEvents(
      items.filter((item): item is CachedEvent => Boolean(item)),
    );
    logProviderResult(this.input.source, rows.length, normalized.length);
    return normalized;
  }

  private resolverInputFromRow(
    row: Record<string, unknown>,
  ): ResolverInput | null {
    const title = getString(row, ["title", "alternativeTitle", "sourceTitle"]);
    if (!title) return null;
    const spatialCoverage = getString(row, [
      "spatialCoverage",
      "spatial",
      "venue",
    ]);
    return {
      title,
      venue: spatialCoverage,
      address: spatialCoverage,
      region: spatialCoverage,
    };
  }

  private async fetchPage(
    page: number,
    signal?: AbortSignal,
  ): Promise<{ rows: Record<string, unknown>[]; totalCount: number | null }> {
    const urls = this.endpointCandidates(page);
    let lastError: unknown = null;
    for (const url of urls) {
      try {
        const response = await fetchWithTimeout(url, {
          signal,
          headers: {
            Accept: "application/json, text/xml, */*",
            "Content-Type": "application/json",
          },
        });
        if (!response.ok) {
          const detail = await readErrorDetail(response);
          lastError = new Error(
            `${this.input.source} API failed: ${response.status}${detail ? ` ${detail}` : ""}`,
          );
          if (isRetryableGatewayStatus(response.status)) continue;
          throw lastError;
        }
        const text = await response.text();
        return this.parseResponse(text);
      } catch (error) {
        if (isAbortError(error)) throw error;
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`${this.input.source} API failed`);
  }

  private endpointCandidates(page: number): URL[] {
    const bases = [
      this.input.baseUrl,
      alternateProtocolBaseUrl(this.input.baseUrl),
    ].filter((base): base is string => Boolean(base));
    return bases.map((base) => {
      const url = new URL(this.input.path, base);
      url.searchParams.set(
        "serviceKey",
        normalizeServiceKey(this.input.serviceKey),
      );
      url.searchParams.set("numOfRows", String(EVENT_PAGE_SIZE));
      url.searchParams.set("pageNo", String(page));
      return url;
    });
  }

  private parseResponse(text: string): {
    rows: Record<string, unknown>[];
    totalCount: number | null;
  } {
    if (text.trim().startsWith("{")) {
      const body = JSON.parse(text) as unknown;
      return {
        rows: extractJsonItems(body),
        totalCount: extractTotalCount(body),
      };
    }
    return { rows: parseXmlItems(text), totalCount: null };
  }

  private async mapRow(
    row: Record<string, unknown>,
    resolveCoordinates: boolean,
  ): Promise<CachedEvent | null> {
    const title = getString(row, ["title", "alternativeTitle", "sourceTitle"]);
    if (!title) return null;
    const temporal = getString(row, [
      "eventPeriod",
      "temporalCoverage",
      "period",
    ]);
    const dates = parseDateRange(temporal);
    const categoryText =
      getString(row, ["subjectCategory", "subjectKeyword", "collectionDb"]) ??
      this.input.defaultCategoryText;
    const spatialCoverage = getString(row, [
      "spatialCoverage",
      "spatial",
      "venue",
    ]);
    const fallbackCoordinate = regionFallbackCoordinate(spatialCoverage);
    return normalizeEventForMap(
      {
        source: this.input.source,
        sourceId: getString(row, ["identifier", "url", "title"]) ?? title,
        title,
        description: getString(row, [
          "description",
          "subDescription",
          "abstract",
        ]),
        category: categoryFromText(categoryText),
        startDate: dates?.startDate,
        endDate: dates?.endDate,
        address: spatialCoverage,
        lat: fallbackCoordinate?.lat,
        lng: fallbackCoordinate?.lng,
        imageUrl: getString(row, ["referenceIdentifier", "thumbnail"]),
        officialUrl: getString(row, ["url", "sourceUrl"]),
        region: spatialCoverage,
        venue: spatialCoverage,
        updatedAt: getString(row, ["regDate", "modifiedDate"]),
        raw: row,
      },
      resolveCoordinates ? this.input.resolver : undefined,
    );
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function alternateProtocolBaseUrl(baseUrl: string): string | null {
  if (baseUrl.startsWith("https://"))
    return `http://${baseUrl.slice("https://".length)}`;
  if (baseUrl.startsWith("http://"))
    return `https://${baseUrl.slice("http://".length)}`;
  return null;
}

function isRetryableGatewayStatus(status: number): boolean {
  return status === 530 || status === 502 || status === 503 || status === 504;
}

function normalizeServiceKey(serviceKey: string): string {
  const trimmed = serviceKey.trim();
  if (!trimmed.includes("%")) return trimmed;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    return (
      text.replace(/\s+/g, " ").trim().slice(0, 160) ||
      response.statusText ||
      null
    );
  } catch {
    return response.statusText || null;
  }
}

function rowEndsOnOrAfter(
  row: Record<string, unknown>,
  todayIso: string,
): boolean {
  const temporal = getString(row, [
    "eventPeriod",
    "temporalCoverage",
    "period",
  ]);
  const dates = parseDateRange(temporal);
  if (!dates) return true;
  const endDate = dates.endDate ?? dates.startDate;
  if (!endDate) return true;
  return endDate >= todayIso;
}
