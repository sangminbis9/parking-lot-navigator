import type { EventCategory, FreeEvent } from "@parking/shared-types";
import type { AppConfig } from "../../../config/env.js";
import { logger } from "../../../logging/logger.js";
import { distanceMeters } from "../../../services/geo.js";
import {
  discoverStatus,
  isWithinWindow,
  parseDate,
} from "../common/dateUtils.js";
import type { DiscoverQuery } from "../common/discoverProvider.js";

export const EVENT_FEED_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const EVENT_FETCH_TIMEOUT_MS = 8_000;
export const EVENT_PAGE_SIZE = 100;

export interface NormalizedEventInput {
  source: string;
  sourceId: string;
  title: string;
  description?: string | null;
  category: EventCategory;
  startDate?: string | null;
  endDate?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  imageUrl?: string | null;
  officialUrl?: string | null;
  price?: string | null;
  region?: string | null;
  venue?: string | null;
  updatedAt?: string | null;
  isFree?: boolean | null;
  raw?: unknown;
}

export interface CachedEvent {
  id: string;
  title: string;
  eventType: string;
  category: EventCategory;
  sourceId: string;
  startDate: string;
  endDate: string;
  isFree: boolean;
  venueName: string | null;
  address: string;
  lat: number;
  lng: number;
  source: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  shortDescription: string | null;
  price: string | null;
  region: string | null;
  updatedAt: string;
}

export interface ResolverInput {
  title: string;
  venue?: string | null;
  address?: string | null;
  region?: string | null;
}

export interface EventCoordinateResolver {
  resolve(input: ResolverInput): Promise<{
    lat: number;
    lng: number;
    address: string | null;
    venue: string | null;
  } | null>;
  warmup?(inputs: ResolverInput[]): Promise<void>;
  flush?(): Promise<void>;
  setMissBudget?(budget: number): void;
}

export interface GeocodeStoreEntry {
  found: boolean;
  lat: number | null;
  lng: number | null;
  address: string | null;
  venue: string | null;
}

export interface GeocodeStore {
  getMany(queries: string[]): Promise<Map<string, GeocodeStoreEntry>>;
  setMany(
    entries: Array<{ query: string; entry: GeocodeStoreEntry }>,
  ): Promise<void>;
}

let globalGeocodeStore: GeocodeStore | null = null;

export function setGeocodeStore(store: GeocodeStore | null): void {
  globalGeocodeStore = store;
}

export function getGeocodeStore(): GeocodeStore | null {
  return globalGeocodeStore;
}

type ResolvedCoordinate = {
  lat: number;
  lng: number;
  address: string | null;
  venue: string | null;
} | null;

export class KakaoEventCoordinateResolver implements EventCoordinateResolver {
  private cache = new Map<string, Promise<ResolvedCoordinate>>();
  private pendingWrites = new Map<string, GeocodeStoreEntry>();
  private missBudget: number;
  private missCount = 0;

  constructor(
    private readonly config: AppConfig,
    options: { missBudget?: number } = {},
  ) {
    this.missBudget = options.missBudget ?? Number.POSITIVE_INFINITY;
  }

  setMissBudget(budget: number): void {
    this.missBudget = budget;
    this.missCount = 0;
  }

  async warmup(inputs: ResolverInput[]): Promise<void> {
    if (
      !this.config.KAKAO_REST_API_KEY ||
      this.config.PARKING_PROVIDER_MODE === "mock"
    )
      return;
    const store = getGeocodeStore();
    if (!store) return;
    const queries = new Set<string>();
    for (const input of inputs) {
      for (const query of candidateQueries(input)) queries.add(query);
    }
    if (queries.size === 0) return;
    let entries: Map<string, GeocodeStoreEntry>;
    try {
      entries = await store.getMany([...queries]);
    } catch {
      return;
    }
    for (const [query, entry] of entries.entries()) {
      if (this.cache.has(query)) continue;
      this.cache.set(query, Promise.resolve(entryToResolved(entry)));
    }
  }

  async flush(): Promise<void> {
    const store = getGeocodeStore();
    if (!store || this.pendingWrites.size === 0) return;
    const batch = [...this.pendingWrites.entries()].map(([query, entry]) => ({
      query,
      entry,
    }));
    this.pendingWrites.clear();
    try {
      await store.setMany(batch);
    } catch {
      // best-effort persistence; never fail sync because of cache write
    }
  }

  async resolve(input: ResolverInput): Promise<ResolvedCoordinate> {
    if (
      !this.config.KAKAO_REST_API_KEY ||
      this.config.PARKING_PROVIDER_MODE === "mock"
    )
      return null;
    const queries = candidateQueries(input);
    for (const query of queries) {
      const cached = this.cache.get(query);
      if (cached) {
        const resolved = await cached;
        if (resolved) return resolved;
        continue;
      }
      if (this.missCount >= this.missBudget) continue;
      this.missCount += 1;
      const promise = this.lookupCoordinate(query);
      this.cache.set(query, promise);
      const resolved = await promise;
      if (resolved) return resolved;
    }
    return null;
  }

  private async lookupCoordinate(query: string): Promise<ResolvedCoordinate> {
    const resolved = await this.fetchCoordinate(query);
    this.pendingWrites.set(
      query,
      resolved
        ? {
            found: true,
            lat: resolved.lat,
            lng: resolved.lng,
            address: resolved.address,
            venue: resolved.venue,
          }
        : {
            found: false,
            lat: null,
            lng: null,
            address: null,
            venue: null,
          },
    );
    return resolved;
  }

  private async fetchCoordinate(query: string): Promise<ResolvedCoordinate> {
    const url = new URL(
      "/v2/local/search/keyword.json",
      this.config.KAKAO_LOCAL_BASE_URL,
    );
    url.searchParams.set("query", query);
    url.searchParams.set("size", "1");
    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `KakaoAK ${this.config.KAKAO_REST_API_KEY}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      documents?: Array<{
        place_name?: string;
        road_address_name?: string;
        address_name?: string;
        x?: string;
        y?: string;
      }>;
    };
    const doc = body.documents?.[0];
    const lat = toNumber(doc?.y);
    const lng = toNumber(doc?.x);
    if (lat === null || lng === null || !isKoreaCoordinate(lat, lng))
      return null;
    return {
      lat,
      lng,
      address: clean(doc?.road_address_name) ?? clean(doc?.address_name),
      venue: clean(doc?.place_name),
    };
  }
}

function candidateQueries(input: ResolverInput): string[] {
  return uniqueQueries([
    clean(input.address),
    [input.region, input.venue].map(clean).filter(Boolean).join(" "),
    clean(input.venue),
    [input.venue, input.title].map(clean).filter(Boolean).join(" "),
    [input.region, input.title].map(clean).filter(Boolean).join(" "),
  ]);
}

function entryToResolved(entry: GeocodeStoreEntry): ResolvedCoordinate {
  if (!entry.found || entry.lat === null || entry.lng === null) return null;
  return {
    lat: entry.lat,
    lng: entry.lng,
    address: entry.address,
    venue: entry.venue,
  };
}

export async function normalizeEventForMap(
  input: NormalizedEventInput,
  resolver?: EventCoordinateResolver,
): Promise<CachedEvent | null> {
  const title = clean(input.title);
  const startDate = normalizeDate(input.startDate);
  const endDate = normalizeDate(input.endDate) ?? startDate;
  if (!title || !startDate || !endDate) return null;

  let lat = input.lat ?? null;
  let lng = input.lng ?? null;
  let address = clean(input.address) ?? "";
  let venue = clean(input.venue);
  if (
    (lat === null || lng === null || !isKoreaCoordinate(lat, lng)) &&
    resolver
  ) {
    const resolved = await resolver.resolve({
      title,
      venue,
      address,
      region: input.region,
    });
    if (resolved) {
      lat = resolved.lat;
      lng = resolved.lng;
      address = address || resolved.address || "";
      venue = venue ?? resolved.venue;
    }
  }
  if (lat === null || lng === null || !isKoreaCoordinate(lat, lng)) return null;

  const sourceId =
    clean(input.sourceId) ??
    hashKey(
      `${input.source}:${title}:${startDate}:${venue ?? address}:${lat}:${lng}`,
    );
  const price = clean(input.price);
  return {
    id: `${input.source}:${sourceId}`,
    title,
    eventType: input.category,
    category: input.category,
    sourceId,
    startDate,
    endDate,
    isFree: input.isFree ?? isFreeText(price),
    venueName: venue,
    address,
    lat,
    lng,
    source: input.source,
    sourceUrl: clean(input.officialUrl),
    imageUrl: clean(input.imageUrl),
    shortDescription: cleanDescription(input.description),
    price,
    region: clean(input.region) ?? regionFromAddress(address),
    updatedAt: clean(input.updatedAt) ?? new Date().toISOString(),
  };
}

export function eventFromCached(
  item: CachedEvent,
  query: DiscoverQuery,
): FreeEvent | null {
  const distance = distanceMeters(query.lat, query.lng, item.lat, item.lng);
  if (distance > query.radiusMeters) return null;
  if (!isWithinWindow(item.startDate, item.endDate, query.upcomingWithinDays))
    return null;
  const status = discoverStatus(item.startDate, item.endDate);
  if (query.ongoingOnly && status !== "ongoing") return null;
  if (query.freeOnly && !item.isFree) return null;
  return {
    ...item,
    status,
    distanceMeters: distance,
  };
}

export async function fetchWithTimeout(
  url: URL,
  init: RequestInit = {},
  timeoutMs = EVENT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  if (externalSignal?.aborted) controller.abort();
  const abortFromExternal = () => controller.abort();
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

export function extractJsonItems(body: unknown): Record<string, unknown>[] {
  const candidates = [
    body,
    getPath(body, ["response", "body", "items", "item"]),
    getPath(body, ["response", "body", "items"]),
    getPath(body, ["items", "item"]),
    getPath(body, ["items"]),
    getPath(body, ["data"]),
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter(isObject);
    if (isObject(candidate)) return [candidate];
  }
  return [];
}

export function extractTotalCount(body: unknown): number | null {
  return (
    toNumber(getPath(body, ["response", "body", "totalCount"])) ??
    toNumber(getPath(body, ["totalCount"]))
  );
}

export function parseXmlItems(
  xml: string,
  itemTag = "item",
): Record<string, string>[] {
  const regex = new RegExp(
    `<${itemTag}[^>]*>([\\s\\S]*?)<\\/${itemTag}>`,
    "gi",
  );
  return [...xml.matchAll(regex)].map((match) => parseXmlObject(match[1]));
}

export function parseXmlItemsAny(
  xml: string,
  itemTags: string[],
): Record<string, string>[] {
  for (const tag of itemTags) {
    const items = parseXmlItems(xml, tag);
    if (items.length > 0) return items;
  }
  return [];
}

export function parseXmlObject(xml: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const match of xml.matchAll(
    /<([A-Za-z0-9_:-]+)[^>]*>([\s\S]*?)<\/\1>/g,
  )) {
    values[match[1]] = decodeXml(match[2].replace(/<[^>]+>/g, " ")).trim();
  }
  return values;
}

export function getString(
  row: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = clean(row[key]);
    if (value) return value;
  }
  return null;
}

export function getNumber(
  row: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = toNumber(row[key]);
    if (value !== null) return value;
  }
  return null;
}

export function categoryFromText(
  text: string | null | undefined,
): EventCategory {
  const lower = (text ?? "").toLowerCase();
  if (
    containsAny(lower, ["festival", "\uCD95\uC81C", "\uD398\uC2A4\uD2F0\uBC8C"])
  )
    return "festival";
  if (
    containsAny(lower, [
      "performance",
      "concert",
      "theater",
      "\uACF5\uC5F0",
      "\uC5F0\uADF9",
      "\uBBA4\uC9C0\uCEEC",
      "\uC74C\uC545",
      "\uCF58\uC11C\uD2B8",
      "\uBB34\uC6A9",
    ])
  )
    return "performance";
  if (
    containsAny(lower, [
      "exhibition",
      "exhibit",
      "\uC804\uC2DC",
      "\uBBF8\uC220",
      "\uBC15\uBB3C\uAD00",
      "\uAC24\uB7EC\uB9AC",
    ])
  )
    return "exhibition";
  if (
    containsAny(lower, [
      "\uC9C0\uC5ED",
      "\uB9C8\uC744",
      "\uC2DC\uC7A5",
      "local",
    ])
  )
    return "local_event";
  if (
    containsAny(lower, [
      "culture",
      "\uBB38\uD654",
      "\uAD50\uC721",
      "\uCCB4\uD5D8",
      "\uD589\uC0AC",
    ])
  )
    return "culture";
  return "other";
}
export function parseDateRange(
  value: string | null | undefined,
): { startDate: string; endDate: string } | null {
  const text = clean(value);
  if (!text) return null;
  const matches = [
    ...text.matchAll(/\d{4}[-.\/]?\d{1,2}[-.\/]?\d{1,2}/g),
    ...text.matchAll(/\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일/g),
  ]
    .map((match) => normalizeDate(match[0]))
    .filter((date): date is string => Boolean(date));
  if (matches.length === 0) return null;
  return {
    startDate: matches[0],
    endDate: matches[matches.length - 1] ?? matches[0],
  };
}

export function formatCompactDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
}

export function dedupeCachedEvents(items: CachedEvent[]): CachedEvent[] {
  const selected = new Map<string, CachedEvent>();
  for (const item of items) {
    const key = [
      normalizeTitle(item.title),
      item.startDate,
      item.endDate,
      Math.round(item.lat * 1000),
      Math.round(item.lng * 1000),
    ].join("|");
    const previous = selected.get(key);
    if (
      !previous ||
      sourcePriority(item.source) > sourcePriority(previous.source)
    ) {
      selected.set(key, item);
    }
  }
  return [...selected.values()];
}

export function logProviderResult(
  provider: string,
  fetched: number,
  normalized: number,
): void {
  logger.info({ provider, fetched, normalized }, "event provider fetched");
}

export function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > 0 && text !== "null" ? text : null;
}

export function cleanDescription(value: unknown): string | null {
  const text = clean(value);
  if (!text) return null;
  const normalized = text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized === "-" || normalized === "null") return null;
  return normalized;
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(number) && number !== 0 ? number : null;
}

export function isKoreaCoordinate(lat: number, lng: number): boolean {
  return lat >= 32 && lat <= 39.5 && lng >= 124 && lng <= 132;
}

export function regionFallbackCoordinate(
  value: string | null | undefined,
): { lat: number; lng: number } | null {
  const text = value?.replace(/\s+/g, " ") ?? "";
  if (!text) return null;
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

function normalizeDate(value: unknown): string | null {
  const text = clean(value);
  if (!text) return null;
  const parts = text.match(/(\d{4})[-.\/]?(\d{1,2})[-.\/]?(\d{1,2})/);
  if (parts) {
    return `${parts[1]}-${parts[2].padStart(2, "0")}-${parts[3].padStart(2, "0")}`;
  }
  const koreanParts = text.match(
    /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/,
  );
  if (koreanParts) {
    return `${koreanParts[1]}-${koreanParts[2].padStart(2, "0")}-${koreanParts[3].padStart(2, "0")}`;
  }
  return parseDate(text);
}

function isFreeText(value: string | null): boolean {
  const text = value?.toLowerCase() ?? "";
  return (
    text.includes("free") ||
    text.includes("\uBB34\uB8CC") ||
    text.includes("0\uC6D0")
  );
}

function regionFromAddress(address: string): string | null {
  return clean(address.split(/\s+/)[0]);
}

function getPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function containsAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle.toLowerCase()));
}

function uniqueQueries(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const value of values) {
    const query = clean(value);
    if (!query || seen.has(query)) continue;
    seen.add(query);
    queries.push(query);
  }
  return queries;
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/\d{4}/g, "")
    .replace(/\uC81C\s*\d+\s*\uD68C/g, "")
    .replace(/[()[\]{}"'`~!@#$%^&*_+=,./<>?:;|\\-]/g, "")
    .replace(/\s+/g, "");
}

function sourcePriority(source: string): number {
  if (source === "culture_portal") return 6;
  if (source === "kopis") return 5;
  if (source === "kcisa_428") return 4;
  if (source === "kcisa_196") return 3;
  if (source === "seoul_open_data") return 2;
  return 1;
}

function hashKey(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}
