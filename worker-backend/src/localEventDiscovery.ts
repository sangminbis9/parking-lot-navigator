import type { LocalEvent, LocalEventStatus } from "@parking/shared-types";
import {
  inferLocalEventType,
  structureLocalEvent,
} from "../../backend/src/features/localEvents/localEventStructuring.js";
import { upsertLocalEvent } from "./localEvents.js";

export interface LocalEventDiscoveryEnv {
  LOCAL_EVENT_PROVIDER_ENABLED?: string;
  LOCAL_EVENT_AUTO_APPROVE_MIN_SCORE?: string;
  LOCAL_EVENT_SEARCH_MAX_QUERIES?: string;
  LOCAL_EVENT_MAX_KAKAO_LOOKUPS?: string;
  LOCAL_EVENT_BLOG_DISPLAY?: string;
  LOCAL_EVENT_KAKAO_RADIUS_METERS?: string;
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
  chunkIndex?: number;
  chunkCount?: number;
}

export interface LocalEventDiscoveryResult {
  provider: "naver_blog_kakao_local";
  enabled: boolean;
  dryRun: boolean;
  chunkIndex: number;
  chunkCount: number;
  regionsProcessed: number;
  searchedQueries: number;
  fetched: number;
  candidates: number;
  saved: number;
  approved: number;
  pending: number;
  skipped: number;
  skipReasons: Record<string, number>;
  errors: string[];
  generatedAt: string;
}

type CandidateOutcome =
  | { kind: "ok"; candidate: LocalEventCandidate }
  | { kind: "skip"; reason: string };

interface NaverBlogItem {
  title: string;
  link: string;
  description: string;
  bloggername: string;
  bloggerlink: string;
  postdate: string;
}

interface KakaoKeywordPlace {
  id?: string;
  place_name?: string;
  address_name?: string;
  road_address_name?: string;
  x?: string;
  y?: string;
  category_name?: string;
  category_group_code?: string;
  place_url?: string;
}

interface KakaoKeywordResponse {
  documents?: KakaoKeywordPlace[];
  meta?: { total_count: number; pageable_count: number; is_end: boolean };
}

interface NaverBlogSearchResponse {
  items?: NaverBlogItem[];
}

interface RegionCenter {
  name: string;
  lat: number;
  lng: number;
}

interface LocalEventCandidate {
  item: LocalEvent;
  blogItem: NaverBlogItem;
  query: string;
  kakaoPlace: KakaoKeywordPlace;
  storeName: string;
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
  { name: "성남", lat: 37.42, lng: 127.1265 },
  { name: "안산", lat: 37.3236, lng: 126.8219 },
  { name: "광명", lat: 37.4783, lng: 126.8645 },
  { name: "평택", lat: 36.9919, lng: 127.1129 },
  { name: "안성", lat: 37.008, lng: 127.2799 },
  { name: "김포", lat: 37.6151, lng: 126.715 },
  { name: "파주", lat: 37.76, lng: 126.7799 },
  { name: "춘천", lat: 37.8813, lng: 127.7298 },
  { name: "원주", lat: 37.3422, lng: 127.9202 },
  { name: "강릉", lat: 37.7519, lng: 128.8761 },
  { name: "속초", lat: 38.2043, lng: 128.5918 },
  { name: "동해", lat: 37.5247, lng: 129.1142 },
  { name: "삼척", lat: 37.4499, lng: 129.1657 },
  { name: "영월", lat: 37.1839, lng: 128.4612 },
  { name: "평창", lat: 37.3705, lng: 128.3902 },
  { name: "대전", lat: 36.3504, lng: 127.3845 },
  { name: "세종", lat: 36.4801, lng: 127.289 },
  { name: "청주", lat: 36.6424, lng: 127.489 },
  { name: "충주", lat: 36.991, lng: 127.9259 },
  { name: "천안", lat: 36.8151, lng: 127.1139 },
  { name: "아산", lat: 36.7898, lng: 127.0017 },
  { name: "공주", lat: 36.4465, lng: 127.119 },
  { name: "서산", lat: 36.7848, lng: 126.4503 },
  { name: "당진", lat: 36.8896, lng: 126.6286 },
  { name: "논산", lat: 36.1872, lng: 127.0986 },
  { name: "제천", lat: 37.1326, lng: 128.1909 },
  { name: "전주", lat: 35.8242, lng: 127.148 },
  { name: "군산", lat: 35.9677, lng: 126.7366 },
  { name: "익산", lat: 35.9483, lng: 126.9576 },
  { name: "정읍", lat: 35.5697, lng: 126.8559 },
  { name: "남원", lat: 35.4164, lng: 127.3905 },
  { name: "광주", lat: 35.1595, lng: 126.8526 },
  { name: "목포", lat: 34.8118, lng: 126.3922 },
  { name: "여수", lat: 34.7604, lng: 127.6622 },
  { name: "순천", lat: 34.9506, lng: 127.4872 },
  { name: "나주", lat: 35.0158, lng: 126.7108 },
  { name: "광양", lat: 34.9407, lng: 127.6957 },
  { name: "담양", lat: 35.3211, lng: 126.9881 },
  { name: "무안", lat: 34.9908, lng: 126.4815 },
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
  { name: "거제", lat: 34.8806, lng: 128.6212 },
  { name: "통영", lat: 34.8544, lng: 128.4332 },
  { name: "양산", lat: 35.3349, lng: 129.0379 },
  { name: "밀양", lat: 35.5039, lng: 128.7464 },
  { name: "포항", lat: 36.019, lng: 129.3435 },
  { name: "경주", lat: 35.8562, lng: 129.2247 },
  { name: "구미", lat: 36.1195, lng: 128.3446 },
  { name: "안동", lat: 36.5684, lng: 128.7294 },
  { name: "영주", lat: 36.806, lng: 128.624 },
  { name: "김천", lat: 36.1396, lng: 128.1136 },
  { name: "영천", lat: 35.9733, lng: 128.9389 },
  { name: "제주", lat: 33.4996, lng: 126.5312 },
  { name: "서귀포", lat: 33.2541, lng: 126.5601 },
  { name: "애월", lat: 33.4625, lng: 126.3092 },
];

const EVENT_QUERY_KEYWORDS = [
  "카페 오픈이벤트",
  "카페 리뷰이벤트",
  "맛집 오픈이벤트",
] as const;

const EVENT_KEYWORD_PATTERN =
  /(리뷰\s*이벤트|방문\s*이벤트|오픈\s*이벤트|할인|무료|증정|팝업|한정|1\s*\+\s*1|coupon|discount|free|review|popup)/i;
const BENEFIT_PATTERN =
  /(\d{1,2}\s?%|\d{1,3}(?:,\d{3})*\s?원|1\s*\+\s*1|무료|증정|쿠폰|할인|사은품|서비스|coupon|discount|free|gift)/i;

const STORE_TYPE_WORDS = [
  "베이커리",
  "이자카야",
  "비스트로",
  "레스토랑",
  "브런치",
  "디저트",
  "팝업스토어",
  "팝업",
  "카페",
  "맛집",
  "주점",
  "포차",
  "분식",
  "식당",
  "다이닝",
] as const;

const EVENT_PHRASE_PATTERN =
  /(오픈\s*이벤트|리뷰\s*이벤트|방문\s*이벤트|체험단|할인\s*이벤트|할인\s*행사|1\s*\+\s*1|무료\s*증정|쿠폰\s*증정|오픈\s*기념|오픈\s*특가|신메뉴\s*출시|한정\s*판매|선착순|이벤트\s*중|이벤트\s*진행)/g;

const TITLE_NOISE_PATTERN =
  /(솔직\s*후기|내돈내산|존맛탱|존맛|JMT|핫\s?플레이스|핫플|블로그|체험|광고|협찬|추천|인스타|sns|소개|방문기|다녀온|다녀왔|후기|리뷰)/gi;

const GENERIC_TOKEN_NOISE = new Set([
  "이벤트",
  "오픈",
  "할인",
  "쿠폰",
  "무료",
  "증정",
  "한정",
  "사은품",
  "서비스",
  "신메뉴",
  "오늘",
  "내일",
  "주말",
  "평일",
  "오전",
  "오후",
  "진행",
  "중",
]);

export async function syncLocalEventDiscovery(
  options: LocalEventDiscoveryOptions,
): Promise<LocalEventDiscoveryResult> {
  const generatedAt = (options.now ?? new Date()).toISOString();
  const chunkCount = clampInt(Number(options.chunkCount ?? 1), 1, 64);
  const rawIndex = Number(options.chunkIndex ?? 0);
  const chunkIndex = Number.isFinite(rawIndex)
    ? ((Math.trunc(rawIndex) % chunkCount) + chunkCount) % chunkCount
    : 0;
  const regions =
    chunkCount === 1
      ? REGION_CENTERS
      : sliceChunk(REGION_CENTERS, chunkIndex, chunkCount);
  const result: LocalEventDiscoveryResult = {
    provider: "naver_blog_kakao_local",
    enabled: isEnabled(options.env.LOCAL_EVENT_PROVIDER_ENABLED),
    dryRun: options.dryRun ?? false,
    chunkIndex,
    chunkCount,
    regionsProcessed: regions.length,
    searchedQueries: 0,
    fetched: 0,
    candidates: 0,
    saved: 0,
    approved: 0,
    pending: 0,
    skipped: 0,
    skipReasons: {},
    errors: [],
    generatedAt,
  };
  const noteSkip = (reason: string): void => {
    result.skipped += 1;
    result.skipReasons[reason] = (result.skipReasons[reason] ?? 0) + 1;
  };

  if (!result.enabled) return result;
  if (!options.env.NAVER_CLIENT_ID || !options.env.NAVER_CLIENT_SECRET) {
    result.errors.push("naver_credentials_not_configured");
    return result;
  }
  if (!options.env.KAKAO_REST_API_KEY) {
    result.errors.push("kakao_local_key_not_configured");
    return result;
  }

  const maxQueries = clampInt(
    Number(options.env.LOCAL_EVENT_SEARCH_MAX_QUERIES ?? 1600),
    1,
    5000,
  );
  const maxKakaoLookups = clampInt(
    Number(options.env.LOCAL_EVENT_MAX_KAKAO_LOOKUPS ?? 18),
    1,
    500,
  );
  const blogDisplay = clampInt(
    Number(options.env.LOCAL_EVENT_BLOG_DISPLAY ?? 20),
    1,
    100,
  );

  const now = options.now ?? new Date();
  const seenBlogLinks = new Set<string>();
  const seenSourceIds = new Set<string>();
  let kakaoLookups = 0;

  outer: for (const region of regions) {
    for (const keyword of EVENT_QUERY_KEYWORDS) {
      if (result.searchedQueries >= maxQueries) break outer;
      result.searchedQueries += 1;
      const query = `${region.name} ${keyword}`;
      let blogItems: NaverBlogItem[];
      try {
        blogItems = await searchNaverBlog(options.env, query, blogDisplay);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown_error";
        result.errors.push(`naver_blog_search:${message.slice(0, 80)}`);
        noteSkip(`naver_blog_search_failed`);
        if (/Too many subrequests/i.test(message)) break outer;
        continue;
      }

      for (const blogItem of blogItems) {
        const link = canonicalUrl(blogItem.link);
        if (!link) {
          noteSkip("blog_link_invalid");
          continue;
        }
        if (seenBlogLinks.has(link)) {
          noteSkip("blog_link_duplicate");
          continue;
        }
        seenBlogLinks.add(link);
        result.fetched += 1;

        const titleText = cleanHtml(blogItem.title);
        const descText = cleanHtml(blogItem.description);
        const combined = [titleText, descText].filter(Boolean).join(". ");
        if (!combined) {
          noteSkip("blog_text_empty");
          continue;
        }
        if (!EVENT_KEYWORD_PATTERN.test(combined)) {
          noteSkip("no_event_keyword");
          continue;
        }
        const storeName = extractStoreNameFromBlog(
          titleText,
          descText,
          region.name,
        );
        if (!storeName) {
          noteSkip("no_store_name");
          continue;
        }
        if (kakaoLookups >= maxKakaoLookups) {
          noteSkip("kakao_lookup_budget_exhausted");
          continue;
        }

        try {
          kakaoLookups += 1;
          const outcome = await buildCandidateFromBlog({
            env: options.env,
            blogItem,
            link,
            titleText,
            descText,
            combined,
            storeName,
            region,
            keyword,
            generatedAt,
            now,
          });
          if (outcome.kind === "skip") {
            noteSkip(outcome.reason);
            continue;
          }
          const candidate = outcome.candidate;
          if (
            candidate.item.sourceId &&
            seenSourceIds.has(candidate.item.sourceId)
          ) {
            noteSkip("candidate_source_duplicate");
            continue;
          }
          if (candidate.item.sourceId)
            seenSourceIds.add(candidate.item.sourceId);

          result.candidates += 1;
          if (!options.dryRun) {
            await upsertLocalEvent(options.db, candidate.item, {
              provider: result.provider,
              query: candidate.query,
              blogItem: candidate.blogItem,
              storeName: candidate.storeName,
              kakaoPlace: candidate.kakaoPlace,
            });
          }
          result.saved += options.dryRun ? 0 : 1;
          if (candidate.item.status === "approved") result.approved += 1;
          if (candidate.item.status === "pending") result.pending += 1;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "unknown_error";
          noteSkip(`exception:${message.slice(0, 60)}`);
          result.errors.push(message);
        }
      }
    }
  }

  return result;
}

async function searchNaverBlog(
  env: LocalEventDiscoveryEnv,
  query: string,
  display: number,
): Promise<NaverBlogItem[]> {
  const baseUrl = env.NAVER_SEARCH_BASE_URL ?? "https://openapi.naver.com";
  const url = new URL("/v1/search/blog.json", baseUrl);
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(display));
  url.searchParams.set("sort", "date");

  const response = await fetch(url.toString(), {
    headers: {
      "X-Naver-Client-Id": env.NAVER_CLIENT_ID ?? "",
      "X-Naver-Client-Secret": env.NAVER_CLIENT_SECRET ?? "",
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`naver_blog_search_failed:${response.status}`);
  }
  const body = (await response.json()) as NaverBlogSearchResponse;
  return body.items ?? [];
}

async function searchKakaoKeyword(
  env: LocalEventDiscoveryEnv,
  query: string,
  region: RegionCenter,
): Promise<KakaoKeywordPlace[]> {
  const baseUrl = env.KAKAO_LOCAL_BASE_URL ?? "https://dapi.kakao.com";
  const radius = clampInt(
    Number(env.LOCAL_EVENT_KAKAO_RADIUS_METERS ?? 20000),
    100,
    20000,
  );
  const url = new URL("/v2/local/search/keyword.json", baseUrl);
  url.searchParams.set("query", query);
  url.searchParams.set("x", String(region.lng));
  url.searchParams.set("y", String(region.lat));
  url.searchParams.set("radius", String(radius));
  url.searchParams.set("size", "5");
  url.searchParams.set("sort", "accuracy");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY ?? ""}`,
    },
  });
  if (!response.ok) {
    throw new Error(`kakao_keyword_failed:${response.status}`);
  }
  const body = (await response.json()) as KakaoKeywordResponse;
  return body.documents ?? [];
}

async function buildCandidateFromBlog(input: {
  env: LocalEventDiscoveryEnv;
  blogItem: NaverBlogItem;
  link: string;
  titleText: string;
  descText: string;
  combined: string;
  storeName: string;
  region: RegionCenter;
  keyword: string;
  generatedAt: string;
  now: Date;
}): Promise<CandidateOutcome> {
  const {
    env,
    blogItem,
    link,
    titleText,
    descText,
    combined,
    storeName,
    region,
    keyword,
    generatedAt,
    now,
  } = input;

  const kakaoQuery = `${region.name} ${storeName}`;
  let kakaoPlaces: KakaoKeywordPlace[];
  try {
    kakaoPlaces = await searchKakaoKeyword(env, kakaoQuery, region);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return {
      kind: "skip",
      reason: `kakao_lookup_failed:${message.slice(0, 40)}`,
    };
  }
  if (kakaoPlaces.length === 0) {
    return { kind: "skip", reason: "kakao_lookup_empty" };
  }
  const selected = selectKakaoPlace(kakaoPlaces, storeName, region);
  if (!selected) {
    return { kind: "skip", reason: "kakao_match_below_threshold" };
  }

  const address = selected.road_address_name || selected.address_name || "";
  const lat = numberOrNull(selected.y) ?? 0;
  const lng = numberOrNull(selected.x) ?? 0;
  if (lat === 0 || lng === 0) {
    return { kind: "skip", reason: "kakao_no_coordinates" };
  }

  const benefit = extractBenefit(combined);
  const dates = extractDateRange(combined, now);
  const resolvedStoreName = cleanHtml(selected.place_name ?? "") || storeName;
  const structured = structureLocalEvent({
    sourceUrl: link,
    captionText: combined,
    storeName: resolvedStoreName,
    address,
    now,
  });
  const titleFallback = titleText || `${resolvedStoreName} ${keyword}`;
  const resolvedTitle = structured.title || titleFallback;
  const description = structured.description ?? (combined || null);
  const resolvedBenefit = benefit ?? structured.benefit;
  const endDate = dates.endDate ?? structured.endDate;
  const startDate = dates.startDate ?? structured.startDate ?? today(now);

  const confidenceScore = scoreCandidate({
    title: resolvedTitle,
    benefit: resolvedBenefit,
    storeName: resolvedStoreName,
    address,
    lat,
    lng,
    endDate,
    matchedKakaoCategory: selected.category_group_code ?? null,
    storeNameInTitle: nameMatchScore(resolvedStoreName, titleText) >= 0.6,
  });
  const threshold = clampNumber(
    Number(env.LOCAL_EVENT_AUTO_APPROVE_MIN_SCORE ?? 0.85),
    0.5,
    1,
  );
  const hasClearEndDate = Boolean(endDate);
  const expired = isExpired(endDate, now);
  const status: LocalEventStatus =
    confidenceScore >= threshold && !expired && hasClearEndDate
      ? "approved"
      : "pending";
  const needsReview = status !== "approved" || !hasClearEndDate;
  const dedupeKey =
    selected.id && selected.id.length > 0
      ? `kakao:${selected.id}`
      : `place:${normalizeName(resolvedStoreName)}|${normalizeName(address)}`;
  const sourceId = dedupeKey;

  return {
    kind: "ok",
    candidate: {
      blogItem,
      query: kakaoQuery,
      kakaoPlace: selected,
      storeName: resolvedStoreName,
      item: {
        id: `naver-blog:${stableHash(dedupeKey)}`,
        title: truncate(resolvedTitle, 200),
        eventType: inferLocalEventType(
          [resolvedTitle, description, resolvedBenefit]
            .filter(Boolean)
            .join(" "),
        ),
        category: "local_event",
        sourceId,
        startDate,
        endDate,
        status,
        storeName: truncate(resolvedStoreName, 200),
        venueName: truncate(resolvedStoreName, 200),
        address,
        lat,
        lng,
        distanceMeters: 0,
        source: "naver_blog",
        sourceUrl: link,
        imageUrl: null,
        benefit: resolvedBenefit ? truncate(resolvedBenefit, 500) : null,
        shortDescription: description ? truncate(description, 5000) : null,
        region: region.name,
        updatedAt: generatedAt,
        confidenceScore,
        needsReview,
        isSponsored: false,
        sponsorTier: null,
        paidUntil: null,
        priorityScore:
          status === "approved" ? Math.round(confidenceScore * 100) : 0,
      },
    },
  };
  // descText referenced for future debugging - currently rolled into combined upstream.
  void descText;
}

function selectKakaoPlace(
  places: KakaoKeywordPlace[],
  storeName: string,
  region: RegionCenter,
): KakaoKeywordPlace | null {
  let best: { place: KakaoKeywordPlace; score: number } | null = null;
  for (const place of places) {
    const candidateName = cleanHtml(place.place_name ?? "");
    if (!candidateName) continue;
    const nameScore = nameMatchScore(storeName, candidateName);
    if (nameScore < 0.4) continue;
    const lat = numberOrNull(place.y);
    const lng = numberOrNull(place.x);
    if (lat === null || lng === null) continue;
    const distance = distanceMeters(region.lat, region.lng, lat, lng);
    if (distance > 25000) continue;

    let score = 0;
    if (nameScore >= 0.9) score += 0.6;
    else if (nameScore >= 0.7) score += 0.45;
    else if (nameScore >= 0.5) score += 0.3;
    else score += 0.15;
    if (distance <= 3000) score += 0.3;
    else if (distance <= 10000) score += 0.2;
    else score += 0.05;
    if (
      place.category_group_code === "FD6" ||
      place.category_group_code === "CE7"
    ) {
      score += 0.1;
    }
    if (!best || score > best.score) {
      best = { place, score };
    }
  }
  return best && best.score >= 0.55 ? best.place : null;
}

function extractStoreNameFromBlog(
  title: string,
  description: string,
  regionName: string,
): string | null {
  return (
    extractStoreFromText(title, regionName) ??
    extractStoreFromText(description, regionName)
  );
}

function extractStoreFromText(text: string, regionName: string): string | null {
  if (!text) return null;
  let working = text;
  working = working.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, " ");
  working = working.replace(/[\[(<【〈{][^\])>】〉}]*[\])>】〉}]/g, " ");
  working = working.replace(/[#@][^\s]+/g, " ");
  working = working.replace(EVENT_PHRASE_PATTERN, " ");
  working = working.replace(TITLE_NOISE_PATTERN, " ");
  if (regionName) {
    working = working.replace(new RegExp(regionName, "g"), " ");
  }
  working = working.replace(/[`''""!?~|\\/=^*…·•★☆♥♡♪]/g, " ");
  working = working.replace(/\s+/g, " ").trim();
  if (!working) return null;

  const typeMatch = matchStoreTypePhrase(working);
  if (typeMatch && isAcceptableCandidate(typeMatch)) return typeMatch;

  const tokens = working
    .split(/[\s,.:;\-–—]+/)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 2 &&
        !GENERIC_TOKEN_NOISE.has(token) &&
        !/^\d+$/.test(token),
    );
  if (tokens.length === 0) return null;
  for (let take = Math.min(3, tokens.length); take >= 1; take -= 1) {
    const candidate = tokens.slice(0, take).join(" ").trim();
    if (isAcceptableCandidate(candidate)) return candidate;
  }
  return null;
}

function matchStoreTypePhrase(text: string): string | null {
  for (const type of STORE_TYPE_WORDS) {
    let index = text.indexOf(type);
    while (index >= 0) {
      const before = text.slice(0, index).trim();
      const beforeTokens = sanitizeTokens(before.split(/[\s,.:;\-–—]+/)).slice(
        -2,
      );
      if (beforeTokens.length >= 1) {
        const candidate = `${beforeTokens.join(" ")} ${type}`.trim();
        if (isAcceptableCandidate(candidate)) return candidate;
      }
      const after = text.slice(index + type.length).trim();
      const afterTokens = sanitizeTokens(after.split(/[\s,.:;\-–—]+/)).slice(
        0,
        2,
      );
      if (afterTokens.length >= 1) {
        const candidate = `${type} ${afterTokens.join(" ")}`.trim();
        if (isAcceptableCandidate(candidate)) return candidate;
      }
      index = text.indexOf(type, index + type.length);
    }
  }
  return null;
}

function sanitizeTokens(tokens: string[]): string[] {
  return tokens
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 2 &&
        !GENERIC_TOKEN_NOISE.has(token) &&
        !/^\d+$/.test(token) &&
        !STORE_TYPE_WORDS.includes(token as (typeof STORE_TYPE_WORDS)[number]),
    );
}

function isAcceptableCandidate(value: string): boolean {
  if (!value) return false;
  if (value.length < 2 || value.length > 40) return false;
  if (/^\d+$/.test(value)) return false;
  return true;
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
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()[\]{}"'`~!@#$%^&*_+=,./<>?:;|\\-]/g, "");
}

function distanceMeters(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const radius = 6371000;
  const dLat = ((toLat - fromLat) * Math.PI) / 180;
  const dLng = ((toLng - fromLng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((fromLat * Math.PI) / 180) *
      Math.cos((toLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function extractBenefit(text: string): string | null {
  const match = text.match(BENEFIT_PATTERN);
  if (!match?.[0]) return null;
  return match[0].trim();
}

function extractDateRange(
  text: string,
  now: Date,
): { startDate: string | null; endDate: string | null } {
  const isoRange = text.match(
    /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2}).{0,12}?(\d{4})?[.\-/](\d{1,2})[.\-/](\d{1,2})/,
  );
  if (isoRange) {
    const startYear = Number(isoRange[1]);
    const endYear = Number(isoRange[4] ?? isoRange[1]);
    return {
      startDate: formatDate(
        startYear,
        Number(isoRange[2]),
        Number(isoRange[3]),
      ),
      endDate: formatDate(endYear, Number(isoRange[5]), Number(isoRange[6])),
    };
  }

  const monthDayRange = text.match(
    /(\d{1,2})\s*월\s*(\d{1,2})\s*일?.{0,12}?(\d{1,2})\s*월\s*(\d{1,2})\s*일/,
  );
  if (monthDayRange) {
    const year = now.getFullYear();
    return {
      startDate: formatDate(
        year,
        Number(monthDayRange[1]),
        Number(monthDayRange[2]),
      ),
      endDate: formatDate(
        year,
        Number(monthDayRange[3]),
        Number(monthDayRange[4]),
      ),
    };
  }

  const sameMonthRange = text.match(
    /(\d{1,2})\s*월\s*(\d{1,2})\s*일?.{0,12}?(\d{1,2})\s*일/,
  );
  if (sameMonthRange) {
    const year = now.getFullYear();
    const month = Number(sameMonthRange[1]);
    return {
      startDate: formatDate(year, month, Number(sameMonthRange[2])),
      endDate: formatDate(year, month, Number(sameMonthRange[3])),
    };
  }

  const untilDate = text.match(
    /(\d{1,2})\s*월\s*(\d{1,2})\s*일?\s*(?:까지|마감)/,
  );
  if (untilDate) {
    const year = now.getFullYear();
    return {
      startDate: today(now),
      endDate: formatDate(year, Number(untilDate[1]), Number(untilDate[2])),
    };
  }

  if (/오늘\s*까지/.test(text)) {
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
  matchedKakaoCategory: string | null;
  storeNameInTitle: boolean;
}): number {
  let score = 0;
  if (value.title) score += 0.1;
  if (value.benefit) score += 0.2;
  if (value.storeName) score += 0.1;
  if (value.address && value.lat !== 0 && value.lng !== 0) score += 0.25;
  if (value.endDate) score += 0.15;
  if (
    value.matchedKakaoCategory === "FD6" ||
    value.matchedKakaoCategory === "CE7"
  ) {
    score += 0.1;
  }
  if (value.storeNameInTitle) score += 0.1;
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
    .replace(/&quot;/g, '"')
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

function sliceChunk<T>(
  items: readonly T[],
  chunkIndex: number,
  chunkCount: number,
): T[] {
  if (chunkCount <= 1 || items.length === 0) return [...items];
  const base = Math.floor(items.length / chunkCount);
  const remainder = items.length % chunkCount;
  const start = chunkIndex * base + Math.min(chunkIndex, remainder);
  const size = base + (chunkIndex < remainder ? 1 : 0);
  return items.slice(start, start + size);
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
