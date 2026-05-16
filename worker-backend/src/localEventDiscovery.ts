import type { LocalEvent, LocalEventStatus } from "@parking/shared-types";
import { inferLocalEventType, structureLocalEvent } from "../../backend/src/features/localEvents/localEventStructuring.js";
import { upsertLocalEvent } from "./localEvents.js";

export interface LocalEventDiscoveryEnv {
  LOCAL_EVENT_PROVIDER_ENABLED?: string;
  LOCAL_EVENT_AUTO_APPROVE_MIN_SCORE?: string;
  LOCAL_EVENT_SEARCH_MAX_QUERIES?: string;
  KAKAO_CATEGORY_RADIUS_METERS?: string;
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
  NAVER_SEARCH_BASE_URL?: string;
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
  provider: "naver_search_kakao_local";
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

interface NaverSearchResponse {
  items?: NaverSearchItem[];
}

interface NaverSearchItem {
  title?: string;
  link?: string;
  description?: string;
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
  sourceItem: NaverSearchItem;
  query: string;
  kakaoPlace: KakaoPlace;
}

const REGION_CENTERS: RegionCenter[] = [
  { name: "\uc11c\uc6b8", lat: 37.5665, lng: 126.978 },
  { name: "\uac15\ub0a8", lat: 37.4979, lng: 127.0276 },
  { name: "\ud64d\ub300", lat: 37.5563, lng: 126.9235 },
  { name: "\uc131\uc218", lat: 37.5445, lng: 127.0558 },
  { name: "\uc5f0\ub0a8", lat: 37.5626, lng: 126.9233 },
  { name: "\ud569\uc815", lat: 37.5497, lng: 126.9143 },
  { name: "\uc7a0\uc2e4", lat: 37.5132, lng: 127.1001 },
  { name: "\uac74\ub300", lat: 37.5404, lng: 127.0693 },
  { name: "\uc2e0\ucd0c", lat: 37.5596, lng: 126.9424 },
  { name: "\uba85\ub3d9", lat: 37.5636, lng: 126.983 },
  { name: "\ubd80\uc0b0", lat: 35.1796, lng: 129.0756 },
  { name: "\uc81c\uc8fc", lat: 33.4996, lng: 126.5312 }
];

const KAKAO_EVENT_CATEGORIES = ["FD6", "CE7"] as const;

const EVENT_KEYWORD_PATTERN = /(\ub9ac\ubdf0\s*\uc774\ubca4\ud2b8|\ubc29\ubb38\s*\uc774\ubca4\ud2b8|\uc624\ud508\s*\uc774\ubca4\ud2b8|\ud560\uc778|\ubb34\ub8cc|\uc99d\uc815|\ud31d\uc5c5|\ud55c\uc815|1\s*\+\s*1|coupon|discount|free|review|popup)/i;
const BENEFIT_PATTERN = /(\d{1,2}\s?%|\d{1,3}(?:,\d{3})*\s?\uc6d0|1\s*\+\s*1|\ubb34\ub8cc|\uc99d\uc815|\ucfe0\ud3f0|\ud560\uc778|\uc0ac\uc740\ud488|\uc11c\ube44\uc2a4|coupon|discount|free|gift)/i;

export async function syncLocalEventDiscovery(options: LocalEventDiscoveryOptions): Promise<LocalEventDiscoveryResult> {
  const generatedAt = (options.now ?? new Date()).toISOString();
  const result: LocalEventDiscoveryResult = {
    provider: "naver_search_kakao_local",
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
    result.errors.push("naver_search_credentials_not_configured");
    return result;
  }
  if (!options.env.KAKAO_REST_API_KEY) {
    result.errors.push("kakao_local_key_not_configured");
    return result;
  }

  const maxPlaces = clampInt(Number(options.env.LOCAL_EVENT_SEARCH_MAX_QUERIES ?? 360), 1, 360);
  const seen = new Set<string>();

  outer:
  for (const region of REGION_CENTERS) {
    for (const categoryCode of KAKAO_EVENT_CATEGORIES) {
      if (seen.size >= maxPlaces) break outer;
      result.searchedQueries += 1;
      const places = await fetchKakaoPlaces(options.env, region, categoryCode);
      for (const place of places) {
        if (seen.size >= maxPlaces) break outer;
        const placeKey = place.id ?? stableHash([place.place_name, place.road_address_name, place.address_name].filter(Boolean).join("|"));
        if (!placeKey || seen.has(placeKey)) {
          result.skipped += 1;
          continue;
        }
        seen.add(placeKey);
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
              naver: candidate.sourceItem,
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
  const radius = clampInt(Number(env.KAKAO_CATEGORY_RADIUS_METERS ?? 1500), 1, 20000);
  const url = new URL("/v2/local/search/category.json", baseUrl);
  url.searchParams.set("category_group_code", categoryCode);
  url.searchParams.set("x", String(region.lng));
  url.searchParams.set("y", String(region.lat));
  url.searchParams.set("radius", String(radius));
  url.searchParams.set("size", "15");

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY ?? ""}`
      }
    });
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as KakaoCategoryResponse;
    return body.documents ?? [];
  } catch {
    return [];
  }
}

async function searchNaverBlog(env: LocalEventDiscoveryEnv, placeName: string): Promise<NaverSearchItem[]> {
  const baseUrl = env.NAVER_SEARCH_BASE_URL ?? "https://openapi.naver.com";
  const url = new URL("/v1/search/blog.json", baseUrl);
  url.searchParams.set("query", `"${placeName}" \uc774\ubca4\ud2b8`);
  url.searchParams.set("display", "3");
  url.searchParams.set("sort", "date");

  const response = await fetch(url.toString(), {
    headers: {
      "X-Naver-Client-Id": env.NAVER_CLIENT_ID ?? "",
      "X-Naver-Client-Secret": env.NAVER_CLIENT_SECRET ?? ""
    }
  });
  if (!response.ok) {
    throw new Error(`naver_blog_search_failed:${response.status}`);
  }
  const body = (await response.json()) as NaverSearchResponse;
  return body.items ?? [];
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

  const blogItems = await searchNaverBlog(env, placeName);
  let sourceItem: NaverSearchItem | null = null;
  let combinedText = "";
  for (const item of blogItems) {
    const text = [cleanHtml(item.title), cleanHtml(item.description)].filter(Boolean).join(". ");
    if (EVENT_KEYWORD_PATTERN.test(text)) {
      sourceItem = item;
      combinedText = text;
      break;
    }
  }
  if (!sourceItem || !combinedText) return null;

  const sourceUrl = canonicalUrl(cleanHtml(sourceItem.link));
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
  const sourceId = stableHash(sourceUrl);
  const resolvedTitle = structured.title || titleText || `${placeName} event`;
  const description = structured.description ?? (combinedText || null);
  const resolvedBenefit = benefit ?? structured.benefit;

  return {
    sourceItem,
    query: `"${placeName}" \uc774\ubca4\ud2b8`,
    kakaoPlace: place,
    item: {
      id: `naver:${sourceId}`,
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
      source: "other",
      sourceUrl,
      imageUrl: null,
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
