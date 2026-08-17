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
  kopisPageCycles,
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
  mapWithConcurrency,
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
    private readonly pageCycles: number = kopisPageCycles(),
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

  /// maxPages * EVENT_PAGE_SIZE가 전체 공연 수보다 작으면 항상 앞쪽 페이지만 읽게 되어
  /// 뒤쪽 공연은 영원히 갱신되지 않는다. 회차마다 시작 페이지를 옮겨 전체를 순회한다.
  private startPage(): number {
    if (this.pageCycles <= 1) return 1;
    const slot = Math.floor(Date.now() / 3_600_000) % this.pageCycles;
    return slot * this.maxPages + 1;
  }

  private async fetchPageWindow(
    startPage: number,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; offset < this.maxPages; offset += 1) {
      const pageRows = await this.fetchPage(startPage + offset, signal);
      rows.push(...pageRows);
      if (pageRows.length < EVENT_PAGE_SIZE) break;
    }
    return rows;
  }

  private async fetchAllItems(signal?: AbortSignal): Promise<CachedEvent[]> {
    const startPage = this.startPage();
    let rows = await this.fetchPageWindow(startPage, signal);
    if (rows.length === 0 && startPage > 1) {
      // 회전 구간이 실제 페이지 수를 넘어섰다. 빈 페이지 한 장만 버리고 앞에서 다시 읽는다.
      rows = await this.fetchPageWindow(1, signal);
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
    const items = await mapWithConcurrency(enrichedRows, 5, (row) =>
      this.mapRow(row, true),
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
    if (response.status === 429) {
      console.warn(`KOPIS rate limit hit at page ${page}, stopping pagination early`);
      return [];
    }
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
          null,
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
        programInfo: combineProgramInfo(row),
        raw: row,
      },
      resolveCoordinates ? this.resolver : undefined,
    );
  }
}

// 공연시간(dtguidance)·출연진(prfcast)·제작진(prfcrew)은 상세 API(pblprfr/{id})에만
// 있고 목록에는 없다. mapRow는 이들을 description fallback으로만 썼는데 sty(줄거리)가
// 먼저라 거의 항상 밀려 버려졌다. TourAPI의 combineProgramInfo와 같은 모양으로
// programInfo에 담아 상세 화면의 "프로그램 상세"에 그대로 노출한다.
function combineProgramInfo(row: Record<string, unknown>): string | null {
  const guidance = getString(row, ["dtguidance"]);
  const cast = getString(row, ["prfcast"]);
  const crew = getString(row, ["prfcrew"]);
  const parts = [
    guidance ? `공연시간: ${guidance}` : null,
    cast ? `출연: ${cast}` : null,
    crew ? `제작진: ${crew}` : null,
  ].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join("\n") : null;
}
