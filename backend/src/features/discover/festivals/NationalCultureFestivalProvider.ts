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
import {
  nationalCultureMaxPages,
  nationalCulturePageCycles,
} from "./tourApiFestivalConfig.js";

const NATIONAL_CULTURE_FESTIVAL_PATH =
  "/openapi/tn_pubr_public_cltur_fstvl_api";
const PAGE_SIZE = 1000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/// 공유 fetch 자체의 상한. 호출자 signal을 쓰면 먼저 포기한 center 하나가
/// 나머지 center가 기다리던 공유 요청까지 abort시켜 전원이 빈손이 된다.
const SHARED_FETCH_TIMEOUT_MS = 55_000;

interface NationalCultureFestivalEnvelope {
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
  } | null;
}

/// 2026-08 무렵 원본이 `response` 래퍼를 벗고 header/body를 최상위로 올렸다.
/// 두 모양 다 받는다 — 래퍼만 보면 항목이 0건인데 예외도 안 나는 조용한 침묵이 된다.
interface NationalCultureFestivalApiResponse extends NationalCultureFestivalEnvelope {
  response?: NationalCultureFestivalEnvelope;
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
  contactPhone: string | null;
  organizerName: string | null;
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
    startPage: number;
    items: CachedNationalFestival[];
  } | null = null;
  private inFlightItems: Promise<CachedNationalFestival[]> | null = null;

  constructor(
    private readonly serviceKey: string,
    private readonly baseUrl: string,
    private readonly maxPages: number = nationalCultureMaxPages(),
    private readonly pageCycles: number = nationalCulturePageCycles(),
  ) {
    super("public-data-culture-festival");
  }

  async festivals(query: DiscoverQuery): Promise<Festival[]> {
    try {
      const items = await this.fetchCachedItems();
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

  private async fetchCachedItems(): Promise<CachedNationalFestival[]> {
    const now = Date.now();
    const startPage = this.startPage();
    /// 캐시는 회전 구간별로 따로 잡는다. isolate가 몇 시간 살아남으면 구간이 바뀌어도
    /// 옛 구간 캐시를 계속 돌려주게 되어 회전이 멈춘다.
    if (
      this.cachedItems &&
      this.cachedItems.expiresAt > now &&
      this.cachedItems.startPage === startPage
    ) {
      return this.cachedItems.items;
    }
    if (this.inFlightItems) return this.inFlightItems;

    this.inFlightItems = this.fetchAllItems(
      startPage,
      AbortSignal.timeout(SHARED_FETCH_TIMEOUT_MS),
    )
      .then((items) => {
        if (items.length > 0) {
          this.cachedItems = { expiresAt: now + CACHE_TTL_MS, startPage, items };
        }
        return items;
      })
      .finally(() => {
        this.inFlightItems = null;
      });
    return this.inFlightItems;
  }

  /// maxPages * PAGE_SIZE가 전체 축제 수보다 작으면 항상 앞쪽 페이지만 읽게 되어
  /// 뒤쪽 축제는 영원히 갱신되지 않는다. 회차마다 시작 페이지를 옮겨 전체를 순회한다.
  private startPage(): number {
    if (this.pageCycles <= 1) return 1;
    const slot = Math.floor(Date.now() / 3_600_000) % this.pageCycles;
    return slot * this.maxPages + 1;
  }

  private async fetchAllItems(
    startPage: number,
    signal?: AbortSignal,
  ): Promise<CachedNationalFestival[]> {
    let window = await this.fetchPageWindow(startPage, signal);
    if (window.rows.length === 0 && startPage > 1) {
      /// 회전 구간이 실제 페이지 수를 넘어섰다. 빈 페이지 한 장만 버리고 앞에서 다시 읽는다.
      window = await this.fetchPageWindow(1, signal);
    }
    const coverage = this.maxPages * this.pageCycles * PAGE_SIZE;
    if (window.totalCount !== null && window.totalCount > coverage) {
      console.warn(
        `public-data-culture-festival coverage=${coverage} totalCount=${window.totalCount}; raise NATIONAL_CULTURE_PAGE_CYCLES to ingest more`,
      );
    }
    const today = new Date().toISOString().slice(0, 10);
    const rawItems = window.rows;
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
      `public-data-culture-festival start_page=${startPage} fetched=${rawItems.length} normalized=${normalized.length} deduped=${deduped.length} dropped_no_coord=${droppedNoCoord} dropped_past=${droppedPast}`,
    );
    return deduped;
  }

  /// 페이지를 동시에 던지면 응답이 전부 한 번에 메모리에 올라가 invocation이 죽는다.
  /// 순차로 읽고, 마지막 페이지에 닿으면(짧은 페이지) 바로 멈춘다.
  private async fetchPageWindow(
    startPage: number,
    signal?: AbortSignal,
  ): Promise<{
    rows: NationalCultureFestivalItem[];
    totalCount: number | null;
  }> {
    const rows: NationalCultureFestivalItem[] = [];
    let totalCount: number | null = null;
    for (let offset = 0; offset < this.maxPages; offset += 1) {
      const page = await this.fetchPage(startPage + offset, signal);
      totalCount ??= page.totalCount;
      rows.push(...page.items);
      if (page.items.length < PAGE_SIZE) break;
    }
    return { rows, totalCount };
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

    const envelope = body.response ?? body;
    const code = envelope.header?.resultCode;
    /// 03(NODATA_ERROR)은 오류가 아니라 "이 페이지 너머엔 없다"다.
    /// 던지면 회전 구간이 끝을 넘을 때마다 provider가 down으로 떨어진다.
    if (code === "03") {
      return { items: [], totalCount: toNumber(envelope.body?.totalCount) };
    }
    if (code && code !== "00" && code !== "0") {
      throw new Error(
        `National culture festival API error: ${envelope.header?.resultMsg ?? code}`,
      );
    }
    const items = extractItems(envelope);
    if (items.length === 0) {
      /// 200 + resultCode 정상인데 항목이 0건인 회차를 가르기 위한 진단.
      /// 구독 만료면 안내 문구가, envelope 변경이면 낯선 키가 본문에 보인다.
      console.warn(
        `public-data-culture-festival empty page=${pageNo} body=${text.replace(/\s+/g, " ").slice(0, 300)}`,
      );
    }
    return {
      items,
      totalCount: toNumber(envelope.body?.totalCount),
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
      sourceUrl: normalizeHomepageUrl(row.homepageUrl),
      imageUrl: null,
      tags: [
        "culture-festival",
        clean(row.mnnstNm),
        clean(row.auspcInsttNm),
        clean(row.suprtInstt),
      ].filter((value): value is string => Boolean(value)),
      contactPhone: clean(row.phoneNumber),
      organizerName: clean(row.auspcInsttNm) ?? clean(row.mnnstNm),
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
  envelope: NationalCultureFestivalEnvelope,
): NationalCultureFestivalItem[] {
  const items = envelope.body?.items;
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

// homepageUrl often arrives without a scheme (e.g. "www.example.go.kr") or,
// when blank, this field used to fall back to relateInfo — a free-text
// description, not a URL. Both cases produced a source_url that the image
// enrichment agent's `LIKE 'http%'` filter silently excludes from scraping,
// so bare domains never got a chance and description text was never a URL
// to begin with.
function normalizeHomepageUrl(value: unknown): string | null {
  const text = clean(value);
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  const looksLikeDomain = !/\s/.test(text) && text.includes(".");
  return looksLikeDomain ? `https://${text}` : null;
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
