import type { LocalEvent, LocalEventStatus } from "@parking/shared-types";
import { inferLocalEventType, structureLocalEvent } from "../../backend/src/features/localEvents/localEventStructuring.js";
import { upsertLocalEvent } from "./localEvents.js";

export interface LocalEventDiscoveryEnv {
  LOCAL_EVENT_PROVIDER_ENABLED?: string;
  LOCAL_EVENT_AUTO_APPROVE_MIN_SCORE?: string;
  LOCAL_EVENT_SEARCH_MAX_QUERIES?: string;
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

interface KakaoKeywordResponse {
  documents?: KakaoPlace[];
}

interface KakaoPlace {
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
  kakaoPlace: KakaoPlace | null;
}

const DEFAULT_SEARCH_REGIONS = [
  "\uc11c\uc6b8",
  "\uac15\ub0a8",
  "\ud64d\ub300",
  "\uc131\uc218",
  "\uc5f0\ub0a8",
  "\ud569\uc815",
  "\uc7a0\uc2e4",
  "\uac74\ub300",
  "\uc2e0\ucd0c",
  "\uba85\ub3d9",
  "\ubd80\uc0b0",
  "\uc81c\uc8fc"
];

const DEFAULT_SEARCH_KEYWORDS = [
  "\ub9ac\ubdf0\uc774\ubca4\ud2b8",
  "\ubc29\ubb38\uc774\ubca4\ud2b8",
  "\uc624\ud508\uc774\ubca4\ud2b8",
  "\ud560\uc778 \uc774\ubca4\ud2b8",
  "\ubb34\ub8cc \uc99d\uc815",
  "\ud31d\uc5c5 \uc774\ubca4\ud2b8",
  "\ud55c\uc815 \uba54\ub274"
];

const EVENT_KEYWORD_PATTERN = /(\ub9ac\ubdf0\s*\uc774\ubca4\ud2b8|\ubc29\ubb38\s*\uc774\ubca4\ud2b8|\uc624\ud508\s*\uc774\ubca4\ud2b8|\ud560\uc778|\ubb34\ub8cc|\uc99d\uc815|\ud31d\uc5c5|\ud55c\uc815|1\s*\+\s*1|coupon|discount|free|review|popup)/i;
const BENEFIT_PATTERN = /(\d{1,2}\s?%|\d{1,3}(?:,\d{3})*\s?\uc6d0|1\s*\+\s*1|\ubb34\ub8cc|\uc99d\uc815|\ucfe0\ud3f0|\ud560\uc778|\uc0ac\uc740\ud488|\uc11c\ube44\uc2a4|coupon|discount|free|gift)/i;
const NOISY_STORE_TOKENS = /(\uc11c\uc6b8|\uac15\ub0a8|\ud64d\ub300|\uc131\uc218|\uc5f0\ub0a8|\ud569\uc815|\uc7a0\uc2e4|\uac74\ub300|\uc2e0\ucd0c|\uba85\ub3d9|\ubd80\uc0b0|\uc81c\uc8fc|\ub9db\uc9d1|\uce74\ud398|\uc2dd\ub2f9|\ub9e4\uc7a5|\uc774\ubca4\ud2b8|\ub9ac\ubdf0|\ubc29\ubb38|\ud560\uc778|\ubb34\ub8cc|\uc99d\uc815|\ud31d\uc5c5|\uc624\ud508|\ud55c\uc815)/g;

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

  const maxQueries = clampInt(Number(options.env.LOCAL_EVENT_SEARCH_MAX_QUERIES ?? 24), 1, 84);
  const queries = buildSearchQueries().slice(0, maxQueries);
  const seen = new Set<string>();

  for (const query of queries) {
    result.searchedQueries += 1;
    try {
      const items = await searchNaver(options.env, query);
      result.fetched += items.length;
      for (const sourceItem of items) {
        const sourceUrl = canonicalUrl(cleanHtml(sourceItem.link));
        if (!sourceUrl || seen.has(sourceUrl)) {
          result.skipped += 1;
          continue;
        }
        seen.add(sourceUrl);
        const candidate = await buildCandidate(options.env, sourceItem, query, sourceUrl, generatedAt, options.now ?? new Date());
        if (!candidate) {
          result.skipped += 1;
          continue;
        }

        result.candidates += 1;
        if (!options.dryRun) {
          await upsertLocalEvent(options.db, candidate.item, {
            provider: result.provider,
            query,
            naver: candidate.sourceItem,
            kakaoPlace: candidate.kakaoPlace
          });
        }
        result.saved += options.dryRun ? 0 : 1;
        if (candidate.item.status === "approved") result.approved += 1;
        if (candidate.item.status === "pending") result.pending += 1;
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : "unknown_error");
    }
  }

  return result;
}

function buildSearchQueries(): string[] {
  const queries: string[] = [];
  for (const region of DEFAULT_SEARCH_REGIONS) {
    for (const keyword of DEFAULT_SEARCH_KEYWORDS) {
      queries.push(`${region} ${keyword}`);
    }
  }
  return queries;
}

async function searchNaver(env: LocalEventDiscoveryEnv, query: string): Promise<NaverSearchItem[]> {
  const baseUrl = env.NAVER_SEARCH_BASE_URL ?? "https://openapi.naver.com";
  const url = new URL("/v1/search/webkr.json", baseUrl);
  url.searchParams.set("query", query);
  url.searchParams.set("display", "10");
  url.searchParams.set("start", "1");
  url.searchParams.set("sort", "date");

  const response = await fetch(url.toString(), {
    headers: {
      "X-Naver-Client-Id": env.NAVER_CLIENT_ID ?? "",
      "X-Naver-Client-Secret": env.NAVER_CLIENT_SECRET ?? ""
    }
  });
  if (!response.ok) {
    throw new Error(`naver_search_failed:${response.status}`);
  }
  const body = (await response.json()) as NaverSearchResponse;
  return body.items ?? [];
}

async function buildCandidate(
  env: LocalEventDiscoveryEnv,
  sourceItem: NaverSearchItem,
  query: string,
  sourceUrl: string,
  generatedAt: string,
  now: Date
): Promise<LocalEventCandidate | null> {
  const titleText = cleanHtml(sourceItem.title);
  const descriptionText = cleanHtml(sourceItem.description);
  const combinedText = [titleText, descriptionText].filter(Boolean).join(". ");
  if (!EVENT_KEYWORD_PATTERN.test(combinedText)) return null;

  const region = query.split(" ")[0] ?? "";
  const storeCandidate = extractStoreName(titleText, descriptionText, region);
  if (!storeCandidate) return null;

  const kakaoPlace = await verifyKakaoPlace(env, storeCandidate, region);
  const address = kakaoPlace?.road_address_name || kakaoPlace?.address_name || "";
  const lat = numberOrNull(kakaoPlace?.y) ?? 0;
  const lng = numberOrNull(kakaoPlace?.x) ?? 0;
  const benefit = extractBenefit(combinedText);
  const dates = extractDateRange(combinedText, now);
  const structured = structureLocalEvent({
    sourceUrl,
    captionText: combinedText,
    storeName: kakaoPlace?.place_name ?? storeCandidate,
    address,
    now
  });

  const confidenceScore = scoreCandidate({
    title: titleText || structured.title,
    benefit: benefit ?? structured.benefit,
    storeName: kakaoPlace?.place_name ?? storeCandidate,
    address,
    lat,
    lng,
    endDate: dates.endDate ?? structured.endDate,
    kakaoPlace
  });
  const threshold = clampNumber(Number(env.LOCAL_EVENT_AUTO_APPROVE_MIN_SCORE ?? 0.85), 0.5, 1);
  const hasClearEndDate = Boolean(dates.endDate ?? structured.endDate);
  const expired = isExpired(dates.endDate ?? structured.endDate, now);
  const status: LocalEventStatus =
    confidenceScore >= threshold && hasClearEndDate && !expired && lat !== 0 && lng !== 0 ? "approved" : "pending";
  const needsReview = status !== "approved";
  const sourceId = stableHash(sourceUrl);
  const storeName = kakaoPlace?.place_name ?? storeCandidate;
  const resolvedTitle = structured.title || titleText || `${storeName} event`;
  const description = structured.description ?? (combinedText || null);
  const resolvedBenefit = benefit ?? structured.benefit;

  return {
    sourceItem,
    query,
    kakaoPlace,
    item: {
      id: `naver:${sourceId}`,
      title: truncate(resolvedTitle, 200),
      eventType: inferLocalEventType([resolvedTitle, description, resolvedBenefit].filter(Boolean).join(" ")),
      category: "local_event",
      sourceId,
      startDate: dates.startDate ?? structured.startDate ?? today(now),
      endDate: dates.endDate ?? structured.endDate,
      status,
      storeName: truncate(storeName, 200),
      venueName: truncate(storeName, 200),
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

async function verifyKakaoPlace(env: LocalEventDiscoveryEnv, storeName: string, region: string): Promise<KakaoPlace | null> {
  const baseUrl = env.KAKAO_LOCAL_BASE_URL ?? "https://dapi.kakao.com";
  const url = new URL("/v2/local/search/keyword.json", baseUrl);
  url.searchParams.set("query", `${region} ${storeName}`.trim());
  url.searchParams.set("size", "5");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY ?? ""}`
    }
  });
  if (!response.ok) {
    throw new Error(`kakao_local_failed:${response.status}`);
  }

  const body = (await response.json()) as KakaoKeywordResponse;
  const documents = body.documents ?? [];
  let best: { place: KakaoPlace; score: number } | null = null;
  for (const place of documents) {
    const score = placeMatchScore(storeName, region, place);
    if (!best || score > best.score) {
      best = { place, score };
    }
  }
  return best && best.score >= 0.55 ? best.place : null;
}

function extractStoreName(title: string, description: string, region: string): string | null {
  const bracketMatch = title.match(/[\[\(\u3010\u300c]([^\]\)\u3011\u300d]{2,30})[\]\)\u3011\u300d]/);
  if (bracketMatch?.[1]) return cleanStoreCandidate(bracketMatch[1]);

  const keywordIndex = title.search(EVENT_KEYWORD_PATTERN);
  const prefix = keywordIndex > 1 ? title.slice(0, keywordIndex) : title;
  const parts = prefix
    .split(/[-|:>]/)
    .map((item) => cleanStoreCandidate(item))
    .filter((item): item is string => Boolean(item));
  const best = parts.find((item) => item !== region && normalize(item).length >= 2);
  if (best) return best;

  const descriptionMatch = description.match(/([^\s,.\-:]{2,20})\s*(?:\uc5d0\uc11c|\uc758)?\s*(?:\ub9ac\ubdf0|\ubc29\ubb38|\ud560\uc778|\ubb34\ub8cc|\uc99d\uc815|\ud31d\uc5c5|\uc624\ud508)\s*\uc774\ubca4\ud2b8/);
  return cleanStoreCandidate(descriptionMatch?.[1]);
}

function cleanStoreCandidate(value: string | null | undefined): string | null {
  const cleaned = cleanHtml(value)
    .replace(NOISY_STORE_TOKENS, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 60) return null;
  return cleaned;
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

function placeMatchScore(storeName: string, region: string, place: KakaoPlace): number {
  const store = normalize(storeName);
  const placeName = normalize(place.place_name ?? "");
  const address = normalize([place.road_address_name, place.address_name].filter(Boolean).join(" "));
  let score = 0;
  if (placeName && (placeName.includes(store) || store.includes(placeName))) score += 0.55;
  if (overlapRatio(store, placeName) >= 0.5) score += 0.25;
  if (region && address.includes(normalize(region))) score += 0.1;
  if (["FD6", "CE7", "MT1", "CS2"].includes(place.category_group_code ?? "")) score += 0.1;
  if (numberOrNull(place.x) !== null && numberOrNull(place.y) !== null) score += 0.1;
  return Math.min(score, 1);
}

function overlapRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  const aChars = new Set([...a]);
  const bChars = new Set([...b]);
  let overlap = 0;
  for (const char of aChars) {
    if (bChars.has(char)) overlap += 1;
  }
  return overlap / Math.max(aChars.size, bChars.size);
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

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[()[\]{}"'`~!@#$%^&*_+=,./<>?:;|\\-]/g, "");
}

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function formatDate(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}
