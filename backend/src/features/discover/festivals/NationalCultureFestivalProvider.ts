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
import { getGeocodeStore } from "../events/eventProviderUtils.js";
import { nationalCultureMaxPages } from "./tourApiFestivalConfig.js";

const NATIONAL_CULTURE_FESTIVAL_PATH =
  "/openapi/tn_pubr_public_cltur_fstvl_api";
const PAGE_SIZE = 1000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface NationalCultureFestivalApiResponse {
  response?: {
    header?: {
      resultCode?: string;
      resultMsg?: string;
    };
    body?: {
      items?:
        | NationalCultureFestivalItem[]
        | {
            item?: NationalCultureFestivalItem[] | NationalCultureFestivalItem;
          };
      totalCount?: number | string;
      pageNo?: number | string;
      numOfRows?: number | string;
    };
  };
}

interface NationalCultureFestivalItem {
  fstvlNm?: string;
  opar?: string;
  fstvlStartDate?: string;
  fstvlEndDate?: string;
  fstvlCo?: string;
  mnnstNm?: string;
  auspcInsttNm?: string;
  suprtInstt?: string;
  phoneNumber?: string;
  homepageUrl?: string;
  relateInfo?: string;
  rdnmadr?: string;
  lnmadr?: string;
  latitude?: string | number;
  longitude?: string | number;
  referenceDate?: string;
  insttCode?: string;
}

interface CachedNationalFestival {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  startDate: string;
  endDate: string;
  venueName: string | null;
  address: string;
  lat: number;
  lng: number;
  sourceUrl: string | null;
  imageUrl: null;
  tags: string[];
}

interface NormalizeResult {
  item: CachedNationalFestival | null;
  dropReason: "invalid" | "no_coord" | "past" | null;
}

export class NationalCultureFestivalProvider
  extends BaseProviderHealth
  implements FestivalProvider
{
  private cachedItems: {
    expiresAt: number;
    items: CachedNationalFestival[];
  } | null = null;
  private inFlightItems: Promise<CachedNationalFestival[]> | null = null;

  constructor(
    private readonly serviceKey: string,
    private readonly baseUrl: string,
    private readonly maxPages: number = nationalCultureMaxPages(),
  ) {
    super("public-data-culture-festival");
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
          source: "public-data-culture-festival" as const,
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

      this.markSuccess(normalized.length > 0 ? 0.84 : 0.65);
      return sortByStatusThenDistance(normalized);
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }

  private async fetchCachedItems(
    signal?: AbortSignal,
  ): Promise<CachedNationalFestival[]> {
    const now = Date.now();
    if (this.cachedItems && this.cachedItems.expiresAt > now) {
      return this.cachedItems.items;
    }
    if (this.inFlightItems) return this.inFlightItems;

    this.inFlightItems = this.fetchAllItems(signal)
      .then((items) => {
        if (items.length > 0) {
          this.cachedItems = { expiresAt: now + CACHE_TTL_MS, items };
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
  ): Promise<CachedNationalFestival[]> {
    const first = await this.fetchPage(1, signal);
    const totalCount = first.totalCount ?? first.items.length;
    const requiredPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const totalPages = Math.min(this.maxPages, requiredPages);
    if (requiredPages > totalPages) {
      console.warn(
        `public-data-culture-festival truncated_at_page=${totalPages} total_pages=${requiredPages} totalCount=${totalCount}; raise NATIONAL_CULTURE_MAX_PAGES to ingest more`,
      );
    }
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        this.fetchPage(index + 2, signal),
      ),
    );
    const today = new Date().toISOString().slice(0, 10);
    const rawItems = [...first.items, ...rest.flatMap((page) => page.items)];
    const cachedCoordinates = await lookupCachedCoordinates(rawItems);
    const results = await Promise.all(
      rawItems.map((row) =>
        normalizeNationalCultureFestival(row, today, cachedCoordinates),
      ),
    );
    const normalized = results
      .map((result) => result.item)
      .filter((item): item is CachedNationalFestival => Boolean(item));
    let droppedNoCoord = 0;
    let droppedPast = 0;
    for (const result of results) {
      if (result.dropReason === "no_coord") droppedNoCoord += 1;
      if (result.dropReason === "past") droppedPast += 1;
    }

    const deduped = dedupeItems(normalized);
    console.info(
      `public-data-culture-festival fetched=${rawItems.length} normalized=${normalized.length} deduped=${deduped.length} dropped_no_coord=${droppedNoCoord} dropped_past=${droppedPast}`,
    );
    return deduped;
  }

  private async fetchPage(
    pageNo: number,
    signal?: AbortSignal,
  ): Promise<{
    items: NationalCultureFestivalItem[];
    totalCount: number | null;
  }> {
    const url = new URL(NATIONAL_CULTURE_FESTIVAL_PATH, this.baseUrl);
    url.searchParams.set("serviceKey", this.serviceKey.trim());
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("numOfRows", String(PAGE_SIZE));
    url.searchParams.set("type", "json");

    const response = await fetch(url, {
      signal,
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "ParkingLotNavigator/0.1",
      },
    });
    if (!response.ok)
      throw new Error(
        `National culture festival API failed: ${response.status}`,
      );

    const text = await response.text();
    let body: NationalCultureFestivalApiResponse;
    try {
      body = JSON.parse(text) as NationalCultureFestivalApiResponse;
    } catch {
      throw new Error(
        `National culture festival API returned non-JSON body: ${text.replace(/\s+/g, " ").slice(0, 200)}`,
      );
    }

    const code = body.response?.header?.resultCode;
    if (code && code !== "00" && code !== "0") {
      throw new Error(
        `National culture festival API error: ${body.response?.header?.resultMsg ?? code}`,
      );
    }
    return {
      items: extractItems(body),
      totalCount: toNumber(body.response?.body?.totalCount),
    };
  }
}

async function normalizeNationalCultureFestival(
  row: NationalCultureFestivalItem,
  today: string,
  cachedCoordinates: Map<string, { lat: number; lng: number }>,
): Promise<NormalizeResult> {
  const title = clean(row.fstvlNm);
  const startDate = normalizeDate(row.fstvlStartDate);
  const endDate = normalizeDate(row.fstvlEndDate) ?? startDate;
  if (!title || !startDate || !endDate) {
    return { item: null, dropReason: "invalid" };
  }
  if (endDate < today) {
    return { item: null, dropReason: "past" };
  }

  const address = clean(row.rdnmadr) ?? clean(row.lnmadr) ?? "";
  const venueName = clean(row.opar);
  let lat = toNumber(row.latitude);
  let lng = toNumber(row.longitude);
  if (lat === null || lng === null || !isKoreaCoordinate(lat, lng)) {
    const cached = lookupCachedCoordinate(address, cachedCoordinates);
    if (!cached) return { item: null, dropReason: "no_coord" };
    lat = cached.lat;
    lng = cached.lng;
  }
  const sourceItemKey = [
    clean(row.insttCode),
    title,
    startDate,
    endDate,
    address || venueName,
    lat.toFixed(5),
    lng.toFixed(5),
  ]
    .filter(Boolean)
    .join("|");

  return {
    item: {
      id: `public-data-culture:${await hashKey(sourceItemKey)}`,
      title,
      subtitle:
        clean(row.fstvlCo) ?? clean(row.suprtInstt) ?? null,
      description:
        clean(row.fstvlCo) ??
        clean(row.relateInfo) ??
        clean(row.suprtInstt) ??
        null,
      startDate,
      endDate,
      venueName,
      address,
      lat,
      lng,
      sourceUrl: clean(row.homepageUrl) ?? clean(row.relateInfo),
      imageUrl: null,
      tags: [
        "culture-festival",
        clean(row.mnnstNm),
        clean(row.auspcInsttNm),
        clean(row.suprtInstt),
      ].filter((value): value is string => Boolean(value)),
    },
    dropReason: null,
  };
}

function lookupCachedCoordinate(
  address: string,
  cachedCoordinates: Map<string, { lat: number; lng: number }>,
): { lat: number; lng: number } | null {
  return cachedCoordinates.get(address) ?? null;
}

async function lookupCachedCoordinates(
  rows: NationalCultureFestivalItem[],
): Promise<Map<string, { lat: number; lng: number }>> {
  const result = new Map<string, { lat: number; lng: number }>();
  const store = getGeocodeStore();
  if (!store) return result;
  const addresses = [
    ...new Set(
      rows
        .filter((row) => !hasValidCoordinate(row))
        .map((row) => clean(row.rdnmadr) ?? clean(row.lnmadr))
        .filter((address): address is string => Boolean(address)),
    ),
  ];
  if (addresses.length === 0) return result;
  try {
    const entries = await store.getMany(addresses);
    for (const address of addresses) {
      const entry = entries.get(address);
      if (
        entry?.found &&
        entry.lat !== null &&
        entry.lng !== null &&
        isKoreaCoordinate(entry.lat, entry.lng)
      ) {
        result.set(address, { lat: entry.lat, lng: entry.lng });
      }
    }
  } catch {
    return result;
  }
  return result;
}

function hasValidCoordinate(row: NationalCultureFestivalItem): boolean {
  const lat = toNumber(row.latitude);
  const lng = toNumber(row.longitude);
  return lat !== null && lng !== null && isKoreaCoordinate(lat, lng);
}

function extractItems(
  body: NationalCultureFestivalApiResponse,
): NationalCultureFestivalItem[] {
  const items = body.response?.body?.items;
  if (Array.isArray(items)) return items;
  const item = items?.item;
  if (Array.isArray(item)) return item;
  return item ? [item] : [];
}

function dedupeItems(
  items: CachedNationalFestival[],
): CachedNationalFestival[] {
  const selected = new Map<string, CachedNationalFestival>();
  for (const item of items) {
    const key = [
      normalizeTitle(item.title),
      item.startDate,
      item.endDate,
      Math.round(item.lat * 1000),
      Math.round(item.lng * 1000),
    ].join("|");
    if (!selected.has(key)) selected.set(key, item);
  }
  return [...selected.values()];
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/\d{4}/g, "")
    .replace(/\uC81C\s*\d+\s*\uD68C/g, "")
    .replace(/[()[\]{}"'`~!@#$%^&*_+=,./<>?:;|\\-]/g, "")
    .replace(/\s+/g, "");
}

function normalizeDate(value: unknown): string | null {
  const text = clean(value);
  if (!text) return null;
  return parseDate(text);
}

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isKoreaCoordinate(lat: number, lng: number): boolean {
  return lat >= 32 && lat <= 39.5 && lng >= 124 && lng <= 132;
}

async function hashKey(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
