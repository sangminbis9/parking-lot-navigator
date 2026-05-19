import type { FreeEvent } from "@parking/shared-types";
import { BaseProviderHealth } from "../../../providers/BaseProviderHealth.js";
import { sortByStatusThenDistance } from "../common/sortDiscover.js";
import type {
  DiscoverQuery,
  EventProvider,
} from "../common/discoverProvider.js";
import {
  EVENT_FEED_CACHE_TTL_MS,
  EVENT_PAGE_SIZE,
  KCISA_EVENT_GEOCODE_ROW_LIMIT,
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
    if (this.cachedItems && this.cachedItems.expiresAt > now)
      return this.cachedItems.items;
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
    const totalPages = Math.min(
      3,
      Math.max(
        1,
        Math.ceil((first.totalCount ?? first.rows.length) / EVENT_PAGE_SIZE),
      ),
    );
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        this.fetchPage(index + 2),
      ),
    );
    const rows = [...first.rows, ...rest.flatMap((page) => page.rows)];
    const geocodeRows = rows.slice(0, KCISA_EVENT_GEOCODE_ROW_LIMIT);
    if (this.input.resolver?.warmup) {
      const warmupInputs = geocodeRows
        .map((row) => this.resolverInputFromRow(row))
        .filter((input): input is ResolverInput => Boolean(input));
      await this.input.resolver.warmup(warmupInputs);
    }
    const items = await Promise.all(
      rows.map((row, index) =>
        this.mapRow(row, index < KCISA_EVENT_GEOCODE_ROW_LIMIT),
      ),
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
  ): Promise<{ rows: Record<string, unknown>[]; totalCount: number | null }> {
    const urls = this.endpointCandidates(page);
    let lastError: unknown = null;
    for (const url of urls) {
      try {
        const response = await fetchWithTimeout(url, {
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

function regionFallbackCoordinate(
  value: string | null,
): { lat: number; lng: number } | null {
  const text = value?.replace(/\s+/g, " ") ?? "";
  const regions: Array<[RegExp, { lat: number; lng: number }]> = [
    [
      /서울|종로|중구|용산|성동|광진|동대문|중랑|성북|강북|도봉|노원|은평|서대문|마포|양천|강서|구로|금천|영등포|동작|관악|서초|강남|송파|강동/,
      { lat: 37.5665, lng: 126.978 },
    ],
    [/부산/, { lat: 35.1796, lng: 129.0756 }],
    [/대구/, { lat: 35.8714, lng: 128.6014 }],
    [/인천/, { lat: 37.4563, lng: 126.7052 }],
    [/광주/, { lat: 35.1595, lng: 126.8526 }],
    [/대전/, { lat: 36.3504, lng: 127.3845 }],
    [/울산/, { lat: 35.5384, lng: 129.3114 }],
    [/세종/, { lat: 36.48, lng: 127.289 }],
    [
      /경기|수원|고양|성남|용인|부천|안산|안양|남양주|화성|평택|의정부|파주|김포|광명|군포|하남|오산|이천|안성|구리|의왕|포천|양평|여주|동두천|과천/,
      { lat: 37.2636, lng: 127.0286 },
    ],
    [
      /강원|춘천|원주|강릉|동해|태백|속초|삼척|홍천|횡성|영월|평창|정선|철원|화천|양구|인제|고성|양양/,
      { lat: 37.8813, lng: 127.7298 },
    ],
    [
      /충북|청주|충주|제천|보은|옥천|영동|증평|진천|괴산|음성|단양/,
      { lat: 36.6424, lng: 127.489 },
    ],
    [
      /충남|천안|공주|보령|아산|서산|논산|계룡|당진|금산|부여|서천|청양|홍성|예산|태안/,
      { lat: 36.6588, lng: 126.6728 },
    ],
    [
      /전북|전주|군산|익산|정읍|남원|김제|완주|진안|무주|장수|임실|순창|고창|부안/,
      { lat: 35.8242, lng: 127.148 },
    ],
    [
      /전남|목포|여수|순천|나주|광양|담양|곡성|구례|고흥|보성|화순|장흥|강진|해남|영암|무안|함평|영광|장성|완도|진도|신안/,
      { lat: 34.8118, lng: 126.3922 },
    ],
    [
      /경북|포항|경주|김천|안동|구미|영주|영천|상주|문경|경산|군위|의성|청송|영양|영덕|청도|고령|성주|칠곡|예천|봉화|울진|울릉/,
      { lat: 36.5684, lng: 128.7294 },
    ],
    [
      /경남|창원|진주|통영|사천|김해|밀양|거제|양산|의령|함안|창녕|고성|남해|하동|산청|함양|거창|합천/,
      { lat: 35.2279, lng: 128.6811 },
    ],
    [/제주|서귀포/, { lat: 33.4996, lng: 126.5312 }],
  ];
  return regions.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}
