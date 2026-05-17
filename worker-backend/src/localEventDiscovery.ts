import type { LocalEvent, LocalEventStatus } from "@parking/shared-types";
import { inferLocalEventType, structureLocalEvent } from "../../backend/src/features/localEvents/localEventStructuring.js";
import { upsertLocalEvent } from "./localEvents.js";

export interface LocalEventDiscoveryEnv {
  LOCAL_EVENT_PROVIDER_ENABLED?: string;
  LOCAL_EVENT_AUTO_APPROVE_MIN_SCORE?: string;
  LOCAL_EVENT_SEARCH_MAX_QUERIES?: string;
  LOCAL_EVENT_MAX_PLACES_PER_REGION_CATEGORY?: string;
  KAKAO_CATEGORY_RADIUS_METERS?: string;
  KAKAO_CATEGORY_MAX_PAGES?: string;
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
  NAVER_SEARCH_BASE_URL?: string;
  NAVER_PLACE_BASE_URL?: string;
  KAKAO_REST_API_KEY?: string;
  KAKAO_LOCAL_BASE_URL?: string;
}

export interface LocalEventDiscoveryOptions {
  db: D1Database;
  env: LocalEventDiscoveryEnv;
  dryRun?: boolean;
  now?: Date;
}

export interface LocalEventDiscoveryResult {
  provider: "naver_place_feed_kakao_local";
  enabled: boolean;
  dryRun: boolean;
  searchedQueries: number;
  fetched: number;
  candidates: number;
  saved: number;
  approved: number;
  pending: number;
  skipped: number;
  errors: string[];
  generatedAt: string;
}

interface NaverLocalSearchResponse {
  items?: NaverLocalSearchItem[];
}

interface NaverLocalSearchItem {
  title?: string;
  link?: string;
  description?: string;
  address?: string;
  roadAddress?: string;
  mapx?: string;
  mapy?: string;
}

interface NaverPlaceFeedEntry {
  title: string | null;
  body: string;
  postedAt: string | null;
  imageUrl: string | null;
  permalink: string | null;
  raw: unknown;
}

interface KakaoCategoryResponse {
  documents?: KakaoPlace[];
  meta?: { total_count: number; pageable_count: number; is_end: boolean };
}

interface RegionCenter {
  name: string;
  lat: number;
  lng: number;
}

interface KakaoPlace {
  id?: string;
  place_name?: string;
  address_name?: string;
  road_address_name?: string;
  x?: string;
  y?: string;
  category_group_code?: string;
}

interface LocalEventCandidate {
  item: LocalEvent;
  sourceItem: NaverPlaceFeedEntry;
  query: string;
  kakaoPlace: KakaoPlace;
  naverPlace: NaverLocalSearchItem;
  naverPlaceId: string;
}

const REGION_CENTERS: RegionCenter[] = [
  { name: "서울", lat: 37.5665, lng: 126.978 },
  { name: "강남", lat: 37.4979, lng: 127.0276 },
  { name: "홍대", lat: 37.5563, lng: 126.9235 },
  { name: "성수", lat: 37.5445, lng: 127.0558 },
  { name: "잠실", lat: 37.5132, lng: 127.1001 },
  { name: "명동", lat: 37.5636, lng: 126.983 },
  { name: "여의도", lat: 37.5219, lng: 126.9245 },
  { name: "이태원", lat: 37.5345, lng: 126.9946 },
  { name: "인천", lat: 37.4563, lng: 126.7052 },
  { name: "송도", lat: 37.3827, lng: 126.6564 },
  { name: "부평", lat: 37.4895, lng: 126.7247 },
  { name: "수원", lat: 37.2636, lng: 127.0286 },
  { name: "판교", lat: 37.3947, lng: 127.1112 },
  { name: "분당", lat: 37.3596, lng: 127.1054 },
  { name: "일산", lat: 37.6584, lng: 126.7712 },
  { name: "의정부", lat: 37.7381, lng: 127.0338 },
  { name: "안양", lat: 37.3943, lng: 126.9568 },
  { name: "부천", lat: 37.5035, lng: 126.766 },
  { name: "용인", lat: 37.2411, lng: 127.1776 },
  { name: "화성", lat: 37.1995, lng: 126.8312 },
  { name: "춘천", lat: 37.8813, lng: 127.7298 },
  { name: "원주", lat: 37.3422, lng: 127.9202 },
  { name: "강릉", lat: 37.7519, lng: 128.8761 },
  { name: "속초", lat: 38.2043, lng: 128.5918 },
  { name: "대전", lat: 36.3504, lng: 127.3845 },
  { name: "세종", lat: 36.4801, lng: 127.289 },
  { name: "청주", lat: 36.6424, lng: 127.489 },
  { name: "충주", lat: 36.991, lng: 127.9259 },
  { name: "천안", lat: 36.8151, lng: 127.1139 },
  { name: "아산", lat: 36.7898, lng: 127.0017 },
  { name: "공주", lat: 36.4465, lng: 127.119 },
  { name: "전주", lat: 35.8242, lng: 127.148 },
  { name: "군산", lat: 35.9677, lng: 126.7366 },
  { name: "익산", lat: 35.9483, lng: 126.9576 },
  { name: "광주", lat: 35.1595, lng: 126.8526 },
  { name: "목포", lat: 34.8118, lng: 126.3922 },
  { name: "여수", lat: 34.7604, lng: 127.6622 },
  { name: "순천", lat: 34.9506, lng: 127.4872 },
  { name: "나주", lat: 35.0158, lng: 126.7108 },
  { name: "부산", lat: 35.1796, lng: 129.0756 },
  { name: "해운대", lat: 35.1631, lng: 129.1636 },
  { name: "서면", lat: 35.1577, lng: 129.0592 },
  { name: "대구", lat: 35.8714, lng: 128.6014 },
  { name: "동성로", lat: 35.8692, lng: 128.5951 },
  { name: "울산", lat: 35.5384, lng: 129.3114 },
  { name: "창원", lat: 35.2279, lng: 128.6811 },
  { name: "마산", lat: 35.2138, lng: 128.5833 },
  { name: "진주", lat: 35.1802, lng: 128.1076 },
  { name: "김해", lat: 35.2285, lng: 128.8894 },
  { name: "포항", lat: 36.019, lng: 129.3435 },
  { name: "경주", lat: 35.8562, lng: 129.2247 },
  { name: "구미", lat: 36.1195, lng: 128.3446 },
  { name: "안동", lat: 36.5684, lng: 128.7294 },
  { name: "제주", lat: 33.4996, lng: 126.5312 },
  { name: "서귀포", lat: 33.2541, lng: 126.5601 },
  { name: "애월", lat: 33.4625, lng: 126.3092 }
];

const KAKAO_EVENT_CATEGORIES = ["FD6", "CE7"] as const;

const EVENT_KEYWORD_PATTERN = /(\ub9ac\ubdf0\s*\uc774\ubca4\ud2b8|\ubc29\ubb38\s*\uc774\ubca4\ud2b8|\uc624\ud508\s*\uc774\ubca4\ud2b8|\ud560\uc778|\ubb34\ub8cc|\uc99d\uc815|\ud31d\uc5c5|\ud55c\uc815|1\s*\+\s*1|coupon|discount|free|review|popup)/i;
const BENEFIT_PATTERN = /(\d{1,2}\s?%|\d{1,3}(?:,\d{3})*\s?\uc6d0|1\s*\+\s*1|\ubb34\ub8cc|\uc99d\uc815|\ucfe0\ud3f0|\ud560\uc778|\uc0ac\uc740\ud488|\uc11c\ube44\uc2a4|coupon|discount|free|gift)/i;

export async function syncLocalEventDiscovery(options: LocalEventDiscoveryOptions): Promise<LocalEventDiscoveryResult> {
  const generatedAt = (options.now ?? new Date()).toISOString();
  const result: LocalEventDiscoveryResult = {
    provider: "naver_place_feed_kakao_local",
    enabled: isEnabled(options.env.LOCAL_EVENT_PROVIDER_ENABLED),
    dryRun: options.dryRun ?? false,
    searchedQueries: 0,
    fetched: 0,
    candidates: 0,
    saved: 0,
    approved: 0,
    pending: 0,
    skipped: 0,
    errors: [],
    generatedAt
  };

  if (!result.enabled) return result;
  if (!options.env.NAVER_CLIENT_ID || !options.env.NAVER_CLIENT_SECRET) {
    result.errors.push("naver_local_search_credentials_not_configured");
    return result;
  }
  if (!options.env.KAKAO_REST_API_KEY) {
    result.errors.push("kakao_local_key_not_configured");
    return result;
  }

  const maxPlaces = clampInt(Number(options.env.LOCAL_EVENT_SEARCH_MAX_QUERIES ?? 1600), 1, 5000);
  const maxPlacesPerRegionCategory = clampInt(Number(options.env.LOCAL_EVENT_MAX_PLACES_PER_REGION_CATEGORY ?? 8), 1, 45);
  const seen = new Set<string>();

  outer:
  for (const region of REGION_CENTERS) {
    for (const categoryCode of KAKAO_EVENT_CATEGORIES) {
      if (seen.size >= maxPlaces) break outer;
      result.searchedQueries += 1;
      const places = await fetchKakaoPlaces(options.env, region, categoryCode);
      let processedForRegionCategory = 0;
      for (const place of places) {
        if (seen.size >= maxPlaces) break outer;
        if (processedForRegionCategory >= maxPlacesPerRegionCategory) break;
        const placeKey = place.id ?? stableHash([place.place_name, place.road_address_name, place.address_name].filter(Boolean).join("|"));
        if (!placeKey || seen.has(placeKey)) {
          result.skipped += 1;
          continue;
        }
        seen.add(placeKey);
        processedForRegionCategory += 1;
        result.fetched += 1;

        try {
          const candidate = await buildCandidateFromPlace(
            options.env,
            place,
            region.name,
            generatedAt,
            options.now ?? new Date()
          );
          if (!candidate) {
            result.skipped += 1;
            continue;
          }

          result.candidates += 1;
          if (!options.dryRun) {
            await upsertLocalEvent(options.db, candidate.item, {
              provider: result.provider,
              query: candidate.query,
              naverPlace: candidate.naverPlace,
              naverPlaceId: candidate.naverPlaceId,
              naverFeed: candidate.sourceItem,
              kakaoPlace: candidate.kakaoPlace
            });
          }
          result.saved += options.dryRun ? 0 : 1;
          if (candidate.item.status === "approved") result.approved += 1;
          if (candidate.item.status === "pending") result.pending += 1;
        } catch (error) {
          result.skipped += 1;
          result.errors.push(error instanceof Error ? error.message : "unknown_error");
        }
      }
    }
  }

  return result;
}

async function fetchKakaoPlaces(
  env: LocalEventDiscoveryEnv,
  region: RegionCenter,
  categoryCode: string
): Promise<KakaoPlace[]> {
  const baseUrl = env.KAKAO_LOCAL_BASE_URL ?? "https://dapi.kakao.com";
  const radius = clampInt(Number(env.KAKAO_CATEGORY_RADIUS_METERS ?? 3000), 1, 20000);
  const maxPages = clampInt(Number(env.KAKAO_CATEGORY_MAX_PAGES ?? 3), 1, 3);
  const places: KakaoPlace[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL("/v2/local/search/category.json", baseUrl);
    url.searchParams.set("category_group_code", categoryCode);
    url.searchParams.set("x", String(region.lng));
    url.searchParams.set("y", String(region.lat));
    url.searchParams.set("radius", String(radius));
    url.searchParams.set("size", "15");
    url.searchParams.set("page", String(page));

    try {
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY ?? ""}`
        }
      });
      if (!response.ok) {
        return places;
      }
      const body = (await response.json()) as KakaoCategoryResponse;
      places.push(...(body.documents ?? []));
      if (body.meta?.is_end) break;
    } catch {
      return places;
    }
  }

  return places;
}

async function searchNaverLocal(env: LocalEventDiscoveryEnv, place: KakaoPlace): Promise<NaverLocalSearchItem[]> {
  const baseUrl = env.NAVER_SEARCH_BASE_URL ?? "https://openapi.naver.com";
  const placeName = cleanHtml(place.place_name);
  const address = cleanHtml(place.road_address_name || place.address_name);
  const url = new URL("/v1/search/local.json", baseUrl);
  url.searchParams.set("query", [placeName, address].filter(Boolean).join(" "));
  url.searchParams.set("display", "5");

  const response = await fetch(url.toString(), {
    headers: {
      "X-Naver-Client-Id": env.NAVER_CLIENT_ID ?? "",
      "X-Naver-Client-Secret": env.NAVER_CLIENT_SECRET ?? ""
    }
  });
  if (!response.ok) {
    throw new Error(`naver_local_search_failed:${response.status}`);
  }
  const body = (await response.json()) as NaverLocalSearchResponse;
  return body.items ?? [];
}

function selectNaverPlace(place: KakaoPlace, items: NaverLocalSearchItem[]): { item: NaverLocalSearchItem; id: string } | null {
  const placeName = cleanHtml(place.place_name);
  const address = cleanHtml(place.road_address_name || place.address_name);
  const kakaoLat = numberOrNull(place.y);
  const kakaoLng = numberOrNull(place.x);
  let best: { item: NaverLocalSearchItem; id: string; score: number } | null = null;

  for (const item of items) {
    const id = extractNaverPlaceId(item.link);
    if (!id) continue;

    const naverName = cleanHtml(item.title);
    const naverAddress = cleanHtml(item.roadAddress || item.address);
    let score = 0;
    if (nameMatchScore(placeName, naverName) >= 0.55) score += 0.5;
    if (address && naverAddress && overlapRatio(address, naverAddress) >= 0.35) score += 0.3;

    const naverLng = naverCoordinate(item.mapx);
    const naverLat = naverCoordinate(item.mapy);
    if (kakaoLat !== null && kakaoLng !== null && naverLat !== null && naverLng !== null) {
      const distance = distanceMeters(kakaoLat, kakaoLng, naverLat, naverLng);
      if (distance <= 150) score += 0.2;
      else if (distance <= 350) score += 0.1;
    }

    if (!best || score > best.score) {
      best = { item, id, score };
    }
  }

  return best && best.score >= 0.5 ? { item: best.item, id: best.id } : null;
}

async function fetchNaverPlaceFeed(
  env: LocalEventDiscoveryEnv,
  placeId: string,
  naverPlace: NaverLocalSearchItem
): Promise<NaverPlaceFeedEntry[]> {
  const feedUrl = naverFeedUrl(env, placeId, naverPlace.link);
  try {
    const response = await fetch(feedUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "parking-lot-navigator/1.0 (+local event discovery)"
      }
    });
    if (response.status === 403 || response.status === 429) return [];
    if (!response.ok) {
      throw new Error(`naver_place_feed_failed:${response.status}`);
    }
    return parseNaverPlaceFeed(await response.text(), feedUrl);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("naver_place_feed_failed:")) throw error;
    return [];
  }
}

function parseNaverPlaceFeed(html: string, feedUrl: string): NaverPlaceFeedEntry[] {
  const entries: NaverPlaceFeedEntry[] = [];
  for (const jsonText of extractEmbeddedJson(html)) {
    try {
      collectFeedEntries(JSON.parse(jsonText), entries, feedUrl);
    } catch {
      // Ignore stale or schema-shifted script payloads and continue with other blocks.
    }
  }

  if (entries.length === 0) {
    const fallbackText = cleanHtml(html).slice(0, 4000);
    if (EVENT_KEYWORD_PATTERN.test(fallbackText)) {
      entries.push({
        title: extractHtmlTitle(html),
        body: fallbackText,
        postedAt: null,
        imageUrl: firstImageUrl(html),
        permalink: feedUrl,
        raw: { fallback: true }
      });
    }
  }

  const seen = new Set<string>();
  return entries
    .filter((entry) => EVENT_KEYWORD_PATTERN.test([entry.title, entry.body].filter(Boolean).join(" ")))
    .filter((entry) => {
      const key = stableHash([entry.title, entry.body.slice(0, 300), entry.permalink].filter(Boolean).join("|"));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

async function buildCandidateFromPlace(
  env: LocalEventDiscoveryEnv,
  place: KakaoPlace,
  region: string,
  generatedAt: string,
  now: Date
): Promise<LocalEventCandidate | null> {
  const placeName = cleanHtml(place.place_name);
  if (!placeName) return null;

  const naverPlace = selectNaverPlace(place, await searchNaverLocal(env, place));
  if (!naverPlace) return null;

  const feedItems = await fetchNaverPlaceFeed(env, naverPlace.id, naverPlace.item);
  const sourceItem = feedItems[0] ?? null;
  if (!sourceItem) return null;

  const combinedText = [cleanHtml(sourceItem.title), cleanHtml(sourceItem.body)].filter(Boolean).join(". ");
  if (!combinedText) return null;

  const sourceUrl = canonicalUrl(sourceItem.permalink ?? naverFeedUrl(env, naverPlace.id, naverPlace.item.link));
  if (!sourceUrl) return null;
  const titleText = cleanHtml(sourceItem.title);
  const address = place.road_address_name || place.address_name || "";
  const lat = numberOrNull(place.y) ?? 0;
  const lng = numberOrNull(place.x) ?? 0;
  const benefit = extractBenefit(combinedText);
  const dates = extractDateRange(combinedText, now);
  const structured = structureLocalEvent({
    sourceUrl,
    captionText: combinedText,
    storeName: placeName,
    address,
    now
  });

  const confidenceScore = scoreCandidate({
    title: titleText || structured.title,
    benefit: benefit ?? structured.benefit,
    storeName: placeName,
    address,
    lat,
    lng,
    endDate: dates.endDate ?? structured.endDate,
    kakaoPlace: place
  });
  const threshold = clampNumber(Number(env.LOCAL_EVENT_AUTO_APPROVE_MIN_SCORE ?? 0.85), 0.5, 1);
  const hasClearEndDate = Boolean(dates.endDate ?? structured.endDate);
  const expired = isExpired(dates.endDate ?? structured.endDate, now);
  const status: LocalEventStatus =
    confidenceScore >= threshold && !expired && lat !== 0 && lng !== 0 ? "approved" : "pending";
  const needsReview = status !== "approved" || !hasClearEndDate;
  const sourceId = stableHash([naverPlace.id, sourceUrl, combinedText.slice(0, 300)].join("|"));
  const resolvedTitle = structured.title || titleText || `${placeName} event`;
  const description = structured.description ?? (combinedText || null);
  const resolvedBenefit = benefit ?? structured.benefit;

  return {
    sourceItem,
    query: [placeName, address].filter(Boolean).join(" "),
    kakaoPlace: place,
    naverPlace: naverPlace.item,
    naverPlaceId: naverPlace.id,
    item: {
      id: `naver-place:${sourceId}`,
      title: truncate(resolvedTitle, 200),
      eventType: inferLocalEventType([resolvedTitle, description, resolvedBenefit].filter(Boolean).join(" ")),
      category: "local_event",
      sourceId,
      startDate: dates.startDate ?? structured.startDate ?? today(now),
      endDate: dates.endDate ?? structured.endDate,
      status,
      storeName: truncate(placeName, 200),
      venueName: truncate(placeName, 200),
      address,
      lat,
      lng,
      distanceMeters: 0,
      source: "naver_place",
      sourceUrl,
      imageUrl: canonicalUrl(sourceItem.imageUrl ?? "") ?? null,
      benefit: resolvedBenefit ? truncate(resolvedBenefit, 500) : null,
      shortDescription: description ? truncate(description, 5000) : null,
      region,
      updatedAt: generatedAt,
      confidenceScore,
      needsReview,
      isSponsored: false,
      sponsorTier: null,
      paidUntil: null,
      priorityScore: status === "approved" ? Math.round(confidenceScore * 100) : 0
    }
  };
}

function extractEmbeddedJson(html: string): string[] {
  const blocks: string[] = [];
  const nextData = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (nextData) blocks.push(decodeHtmlEntities(nextData.trim()));

  const apolloData = html.match(/<script[^>]+id=["']__APOLLO_STATE__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (apolloData) blocks.push(decodeHtmlEntities(apolloData.trim()));

  for (const match of html.matchAll(/window\.__(?:APOLLO_STATE__|PRELOADED_STATE__)\s*=\s*({[\s\S]*?})\s*;?\s*<\/script>/g)) {
    if (match[1]) blocks.push(decodeHtmlEntities(match[1].trim()));
  }

  return blocks;
}

function collectFeedEntries(value: unknown, entries: NaverPlaceFeedEntry[], feedUrl: string, depth = 0): void {
  if (entries.length >= 10 || depth > 9 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) collectFeedEntries(item, entries, feedUrl, depth + 1);
    return;
  }
  if (typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const body = feedText(record);
  if (body.length >= 12 && EVENT_KEYWORD_PATTERN.test(body)) {
    entries.push({
      title: firstString(record, ["title", "subject", "name"]) ?? null,
      body: truncate(body, 5000),
      postedAt: feedDate(record),
      imageUrl: findUrl(record, "image"),
      permalink: canonicalUrl(findUrl(record, "page") ?? feedUrl) ?? feedUrl,
      raw: compactRaw(record)
    });
  }

  for (const child of Object.values(record)) {
    if (typeof child === "object") collectFeedEntries(child, entries, feedUrl, depth + 1);
  }
}

function feedText(record: Record<string, unknown>): string {
  const values: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "string") continue;
    if (!/(title|subject|name|body|content|description|desc|text|notice|event|promotion|feed|message)/i.test(key)) continue;
    const cleaned = cleanHtml(value);
    if (cleaned) values.push(cleaned);
  }
  return values.join(". ");
}

function compactRaw(record: Record<string, unknown>): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      raw[key] = typeof value === "string" ? truncate(cleanHtml(value), 500) : value;
    }
  }
  return raw;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && cleanHtml(value)) return cleanHtml(value);
  }
  return null;
}

function feedDate(record: Record<string, unknown>): string | null {
  for (const key of ["postedAt", "createdAt", "createdDate", "regDate", "date", "writeDate", "updatedAt"]) {
    const value = record[key];
    const normalized = normalizeDateValue(value);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeDateValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1000000000000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  if (typeof value !== "string") return null;
  const cleaned = cleanHtml(value);
  const parsed = Date.parse(cleaned);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  const date = cleaned.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (date) return `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}T00:00:00.000Z`;
  return null;
}

function findUrl(value: unknown, kind: "image" | "page", depth = 0): string | null {
  if (depth > 6 || value === null || value === undefined) return null;
  if (typeof value === "string") {
    const cleaned = decodeHtmlEntities(value);
    if (!/^https?:\/\//i.test(cleaned)) return null;
    if (kind === "image" && /(image|img|photo|thumb|pstatic|phinf|jpg|jpeg|png|webp)/i.test(cleaned)) {
      return cleaned;
    }
    if (kind === "page" && /(place\.naver\.com|m\.place\.naver\.com|map\.naver\.com)/i.test(cleaned)) {
      return cleaned;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUrl(item, kind, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      const found = findUrl(child, kind, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function extractHtmlTitle(html: string): string | null {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (ogTitle) return cleanHtml(ogTitle);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? cleanHtml(title) : null;
}

function firstImageUrl(html: string): string | null {
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
  return ogImage ? canonicalUrl(decodeHtmlEntities(ogImage)) : null;
}

function extractNaverPlaceId(value: string | null | undefined): string | null {
  const cleaned = decodeHtmlEntities(value ?? "");
  const patterns = [
    /[?&](?:code|id)=([0-9]+)/i,
    /\/(?:restaurant|place|hospital|hairshop|accommodation|attraction)\/([0-9]+)/i,
    /\/entry\/place\/([0-9]+)/i
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function naverFeedUrl(env: LocalEventDiscoveryEnv, placeId: string, sourceLink: string | undefined): string {
  const baseUrl = env.NAVER_PLACE_BASE_URL ?? "https://m.place.naver.com";
  const link = canonicalUrl(decodeHtmlEntities(sourceLink ?? ""));
  if (link) {
    const path = new URL(link).pathname;
    const match = path.match(/\/(restaurant|place|hospital|hairshop|accommodation|attraction)\/([0-9]+)/i);
    if (match) {
      return `${baseUrl}/${match[1]}/${match[2]}/feed`;
    }
  }
  return `${baseUrl}/restaurant/${placeId}/feed`;
}

function naverCoordinate(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.abs(parsed) > 1000 ? parsed / 10000000 : parsed;
}

function nameMatchScore(left: string, right: string): number {
  return overlapRatio(normalizeName(left), normalizeName(right));
}

function overlapRatio(left: string, right: string): number {
  if (!left || !right) return 0;
  const short = left.length <= right.length ? left : right;
  const long = left.length > right.length ? left : right;
  if (long.includes(short)) return 1;
  const chars = new Set([...short]);
  let overlap = 0;
  for (const char of chars) {
    if (long.includes(char)) overlap += 1;
  }
  return overlap / chars.size;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[()[\]{}"'`~!@#$%^&*_+=,./<>?:;|\\-]/g, "");
}

function distanceMeters(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const radius = 6371000;
  const dLat = ((toLat - fromLat) * Math.PI) / 180;
  const dLng = ((toLng - fromLng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((fromLat * Math.PI) / 180) * Math.cos((toLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function extractBenefit(text: string): string | null {
  const match = text.match(BENEFIT_PATTERN);
  if (!match?.[0]) return null;
  return match[0].trim();
}

function extractDateRange(text: string, now: Date): { startDate: string | null; endDate: string | null } {
  const isoRange = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2}).{0,12}?(\d{4})?[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (isoRange) {
    const startYear = Number(isoRange[1]);
    const endYear = Number(isoRange[4] ?? isoRange[1]);
    return {
      startDate: formatDate(startYear, Number(isoRange[2]), Number(isoRange[3])),
      endDate: formatDate(endYear, Number(isoRange[5]), Number(isoRange[6]))
    };
  }

  const monthDayRange = text.match(/(\d{1,2})\s*\uc6d4\s*(\d{1,2})\s*\uc77c?.{0,12}?(\d{1,2})\s*\uc6d4\s*(\d{1,2})\s*\uc77c/);
  if (monthDayRange) {
    const year = now.getFullYear();
    return {
      startDate: formatDate(year, Number(monthDayRange[1]), Number(monthDayRange[2])),
      endDate: formatDate(year, Number(monthDayRange[3]), Number(monthDayRange[4]))
    };
  }

  const sameMonthRange = text.match(/(\d{1,2})\s*\uc6d4\s*(\d{1,2})\s*\uc77c?.{0,12}?(\d{1,2})\s*\uc77c/);
  if (sameMonthRange) {
    const year = now.getFullYear();
    const month = Number(sameMonthRange[1]);
    return {
      startDate: formatDate(year, month, Number(sameMonthRange[2])),
      endDate: formatDate(year, month, Number(sameMonthRange[3]))
    };
  }

  const untilDate = text.match(/(\d{1,2})\s*\uc6d4\s*(\d{1,2})\s*\uc77c?\s*(?:\uae4c\uc9c0|\ub9c8\uac10)/);
  if (untilDate) {
    const year = now.getFullYear();
    return {
      startDate: today(now),
      endDate: formatDate(year, Number(untilDate[1]), Number(untilDate[2]))
    };
  }

  if (/\uc624\ub298\s*\uae4c\uc9c0/.test(text)) {
    const value = today(now);
    return { startDate: value, endDate: value };
  }

  return { startDate: null, endDate: null };
}

function scoreCandidate(value: {
  title: string | null;
  benefit: string | null;
  storeName: string | null;
  address: string | null;
  lat: number;
  lng: number;
  endDate: string | null;
  kakaoPlace: KakaoPlace | null;
}): number {
  let score = 0;
  if (value.title) score += 0.15;
  if (value.benefit) score += 0.2;
  if (value.storeName) score += 0.15;
  if (value.address && value.lat !== 0 && value.lng !== 0) score += 0.3;
  if (value.endDate) score += 0.15;
  if (value.kakaoPlace?.category_group_code) score += 0.05;
  return Number(Math.min(score, 1).toFixed(2));
}

function cleanHtml(value: string | null | undefined): string {
  return decodeHtmlEntities(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function canonicalUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|n_media|n_query|n_rank|n_ad_group)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isEnabled(value: string | undefined): boolean {
  return value === undefined ? false : value.toLowerCase() === "true";
}

function isExpired(value: string | null | undefined, now: Date): boolean {
  if (!value) return false;
  return value < today(now);
}

function numberOrNull(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : value.slice(0, length);
}

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function formatDate(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}
