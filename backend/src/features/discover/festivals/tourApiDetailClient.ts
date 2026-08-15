interface TourApiDetailCommonItem {
  contentid?: string;
  homepage?: string;
  overview?: string;
  tel?: string;
  telname?: string;
  title?: string;
}

interface TourApiDetailImageItem {
  contentid?: string;
  originimgurl?: string;
  smallimageurl?: string;
  imgname?: string;
}

interface TourApiDetailIntroItem {
  eventstartdate?: string;
  eventenddate?: string;
  eventplace?: string;
  playtime?: string;
  usetimefestival?: string;
  discountinfofestival?: string;
  bookingplace?: string;
  agelimit?: string;
  program?: string;
  subevent?: string;
  sponsor1?: string;
  sponsor1tel?: string;
  sponsor2?: string;
  sponsor2tel?: string;
}

export interface TourApiDetail {
  description: string | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  venueName: string | null;
  admissionFee: string | null;
  discountInfo: string | null;
  bookingInfo: string | null;
  contactPhone: string | null;
  ageLimit: string | null;
  programInfo: string | null;
  organizerName: string | null;
}

export interface TourApiEventDates {
  startDate: string | null;
  endDate: string | null;
}

const DETAIL_PAGE_SIZE = 20;
// Cloudflare Workers caps concurrent in-flight fetch()es per invocation;
// exceeding it cancels the oldest stalled response ("stalled HTTP response
// was canceled to prevent deadlock"), which breaks any fetch reading that
// response's body. Fan-out across many URLs (area codes, cat3 codes, detail
// lookups) must all be throttled through mapWithConcurrency at this cap.
export const DETAIL_ENRICH_CONCURRENCY = 5;
let introErrorLogCount = 0;
let introSubrequestLimitCount = 0;
let introOtherErrorCount = 0;
let introEmptyDatesCount = 0;
let introOkCount = 0;

export class TourApiDetailClient {
  private readonly cache = new Map<string, Promise<TourApiDetail>>();
  private readonly introCache = new Map<string, Promise<TourApiEventDates>>();
  private readonly introItemCache = new Map<
    string,
    Promise<TourApiDetailIntroItem | null>
  >();

  constructor(
    private readonly serviceKey: string,
    private readonly baseUrl: string,
  ) {}

  eventDates(
    contentId: string,
    signal?: AbortSignal,
  ): Promise<TourApiEventDates> {
    const key = contentId.trim();
    if (!key) {
      return Promise.resolve({ startDate: null, endDate: null });
    }
    const cached = this.introCache.get(key);
    if (cached) return cached;
    const promise = this.fetchIntroItemCached(key, signal)
      .then((item) => {
        const dates = {
          startDate: clean(item?.eventstartdate),
          endDate: clean(item?.eventenddate),
        };
        if (dates.startDate && dates.endDate) {
          introOkCount += 1;
        } else {
          introEmptyDatesCount += 1;
        }
        return dates;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Too many subrequests")) {
          introSubrequestLimitCount += 1;
        } else {
          introOtherErrorCount += 1;
        }
        if (introErrorLogCount < 3) {
          introErrorLogCount += 1;
          console.warn(`detailIntro2 contentId=${key} failed: ${message}`);
        }
        return { startDate: null, endDate: null };
      });
    this.introCache.set(key, promise);
    return promise;
  }

  // areaBasedList2/searchKeyword2/searchFestival2 list responses never
  // include festival-specific fields (dates, venue, fee, booking, etc.);
  // only detailIntro2 (contentTypeId=15, 축제/공연/행사) carries them. Shared
  // via introItemCache so eventDates() and detail() never double-fetch the
  // same contentId's detailIntro2 within a provider run.
  private fetchIntroItemCached(
    contentId: string,
    signal?: AbortSignal,
  ): Promise<TourApiDetailIntroItem | null> {
    const cached = this.introItemCache.get(contentId);
    if (cached) return cached;
    const promise = this.fetchIntroItem(contentId, signal);
    this.introItemCache.set(contentId, promise);
    return promise;
  }

  private async fetchIntroItem(
    contentId: string,
    signal?: AbortSignal,
  ): Promise<TourApiDetailIntroItem | null> {
    const url = new URL("/B551011/KorService2/detailIntro2", this.baseUrl);
    setBaseParams(url, this.serviceKey);
    url.searchParams.set("contentId", contentId);
    url.searchParams.set("contentTypeId", "15");
    url.searchParams.set("numOfRows", "1");
    url.searchParams.set("pageNo", "1");

    const body = await fetchTourJson(url, signal);
    return extractFirstItem<TourApiDetailIntroItem>(body);
  }

  // 요금 backfill 전용 경로. detail()은 detailCommon2/detailImage2까지 부르지만
  // 요금은 detailIntro2 한 번이면 되므로 subrequest 예산을 아낀다.
  async admissionFee(
    contentId: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const key = contentId.trim();
    if (!key) return null;
    // 여기서 실패를 삼키면 호출자가 "요금 없음"과 "조회 실패"를 구분하지 못해
    // 실패한 행에 조회 완료 표식이 찍힌다. 예외는 그대로 올려보낸다.
    const intro = await this.fetchIntroItemCached(key, signal);
    return cleanHtml(intro?.usetimefestival);
  }

  // 사진 backfill 전용 경로. detailImage2는 목록 응답의 firstimage와 달리
  // 항목별 갤러리 전체를 준다. detail()은 첫 장만 쓰지만 여기서는 중복 없이
  // 전부 돌려준다.
  async galleryImages(
    contentId: string,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const key = contentId.trim();
    if (!key) return [];
    const items = await this.fetchImages(key, signal);
    const urls: string[] = [];
    for (const item of items) {
      const url = clean(item.originimgurl) ?? clean(item.smallimageurl);
      if (url && !urls.includes(url)) urls.push(url);
    }
    return urls;
  }

  detail(
    contentId: string,
    signal?: AbortSignal,
    hasImage = false,
  ): Promise<TourApiDetail> {
    const key = contentId.trim();
    if (!key) {
      return Promise.resolve(emptyDetail());
    }
    const cached = this.cache.get(key);
    if (cached) return cached;
    const promise = this.fetchDetail(key, hasImage, signal).catch(() =>
      emptyDetail(),
    );
    this.cache.set(key, promise);
    return promise;
  }

  private async fetchDetail(
    contentId: string,
    hasImage: boolean,
    signal?: AbortSignal,
  ): Promise<TourApiDetail> {
    // 리스트 응답(firstimage)에 이미 이미지가 있으면 enrichTourApiItems가
    // detail.imageUrl을 버리므로(item.imageUrl ?? detail.imageUrl), detailImage2
    // 호출은 순수 낭비다. 건너뛰어 subrequest 예산을 요금/할인 등 실제로
    // 쓰이는 필드에 돌린다.
    const [common, images, intro] = await Promise.all([
      this.fetchCommon(contentId, signal),
      hasImage ? Promise.resolve([]) : this.fetchImages(contentId, signal),
      this.fetchIntroItemCached(contentId, signal).catch(() => null),
    ]);
    return {
      description: cleanHtml(common?.overview),
      sourceUrl: extractFirstUrl(common?.homepage),
      imageUrl: bestImage(images),
      venueName: clean(intro?.eventplace),
      admissionFee: cleanHtml(intro?.usetimefestival),
      discountInfo: cleanHtml(intro?.discountinfofestival),
      bookingInfo: cleanHtml(intro?.bookingplace),
      contactPhone:
        clean(common?.tel) ??
        clean(intro?.sponsor1tel) ??
        clean(intro?.sponsor2tel),
      ageLimit: clean(intro?.agelimit),
      programInfo: combineProgramInfo(intro),
      organizerName: combineOrganizerName(intro),
    };
  }

  private async fetchCommon(
    contentId: string,
    signal?: AbortSignal,
  ): Promise<TourApiDetailCommonItem | null> {
    const url = new URL("/B551011/KorService2/detailCommon2", this.baseUrl);
    setBaseParams(url, this.serviceKey);
    url.searchParams.set("contentId", contentId);
    url.searchParams.set("numOfRows", "1");
    url.searchParams.set("pageNo", "1");

    const body = await fetchTourJson(url, signal);
    return extractFirstItem<TourApiDetailCommonItem>(body);
  }

  private async fetchImages(
    contentId: string,
    signal?: AbortSignal,
  ): Promise<TourApiDetailImageItem[]> {
    const url = new URL("/B551011/KorService2/detailImage2", this.baseUrl);
    setBaseParams(url, this.serviceKey);
    url.searchParams.set("contentId", contentId);
    url.searchParams.set("imageYN", "Y");
    url.searchParams.set("numOfRows", String(DETAIL_PAGE_SIZE));
    url.searchParams.set("pageNo", "1");

    const body = await fetchTourJson(url, signal);
    return extractItems<TourApiDetailImageItem>(body);
  }
}

export async function resolveEventDates<T extends { contentId: string }>(
  items: T[],
  client: TourApiDetailClient,
  signal: AbortSignal | undefined,
  maxItems: number,
): Promise<Array<T & { eventStartDate: string | null; eventEndDate: string | null }>> {
  const candidates = items.slice(0, maxItems);
  introSubrequestLimitCount = 0;
  introOtherErrorCount = 0;
  introEmptyDatesCount = 0;
  introOkCount = 0;
  const result = await mapWithConcurrency(candidates, DETAIL_ENRICH_CONCURRENCY, async (item) => {
    const dates = await client.eventDates(item.contentId, signal);
    return { ...item, eventStartDate: dates.startDate, eventEndDate: dates.endDate };
  });
  console.info(
    `resolveEventDates candidates=${candidates.length} ok=${introOkCount} emptyDates=${introEmptyDatesCount} subrequestLimit=${introSubrequestLimitCount} otherError=${introOtherErrorCount}`,
  );
  return result;
}

export async function enrichTourApiItems<
  T extends {
    contentId: string;
    startDate: string;
    description?: string | null;
    sourceUrl?: string | null;
    imageUrl: string | null;
    venueName?: string | null;
    admissionFee?: string | null;
    discountInfo?: string | null;
    bookingInfo?: string | null;
    contactPhone?: string | null;
    ageLimit?: string | null;
    programInfo?: string | null;
    organizerName?: string | null;
  },
>(
  items: T[],
  client: TourApiDetailClient,
  signal?: AbortSignal,
  maxItems?: number,
): Promise<T[]> {
  const toEnrich =
    maxItems !== undefined && items.length > maxItems
      ? selectSoonest(items, maxItems)
      : null;
  return mapWithConcurrency(items, DETAIL_ENRICH_CONCURRENCY, async (item) => {
    if (item.description && item.sourceUrl && item.imageUrl && item.venueName)
      return item;
    if (toEnrich && !toEnrich.has(item)) return item;
    const detail = await client.detail(
      item.contentId,
      signal,
      Boolean(item.imageUrl),
    );
    return {
      ...item,
      description: item.description ?? detail.description,
      sourceUrl: item.sourceUrl ?? detail.sourceUrl,
      imageUrl: item.imageUrl ?? detail.imageUrl,
      venueName: item.venueName ?? detail.venueName,
      admissionFee: item.admissionFee ?? detail.admissionFee,
      discountInfo: item.discountInfo ?? detail.discountInfo,
      bookingInfo: item.bookingInfo ?? detail.bookingInfo,
      contactPhone: item.contactPhone ?? detail.contactPhone,
      ageLimit: item.ageLimit ?? detail.ageLimit,
      programInfo: item.programInfo ?? detail.programInfo,
      organizerName: item.organizerName ?? detail.organizerName,
    };
  });
}

function emptyDetail(): TourApiDetail {
  return {
    description: null,
    sourceUrl: null,
    imageUrl: null,
    venueName: null,
    admissionFee: null,
    discountInfo: null,
    bookingInfo: null,
    contactPhone: null,
    ageLimit: null,
    programInfo: null,
    organizerName: null,
  };
}

function combineProgramInfo(
  intro: TourApiDetailIntroItem | null,
): string | null {
  const parts = [
    clean(intro?.playtime) ? `공연시간: ${clean(intro?.playtime)}` : null,
    cleanHtml(intro?.program) ? `프로그램: ${cleanHtml(intro?.program)}` : null,
    cleanHtml(intro?.subevent) ? `부대행사: ${cleanHtml(intro?.subevent)}` : null,
  ].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join("\n") : null;
}

function combineOrganizerName(
  intro: TourApiDetailIntroItem | null,
): string | null {
  const sponsor1 = clean(intro?.sponsor1);
  const sponsor2 = clean(intro?.sponsor2);
  if (sponsor1 && sponsor2) return `주최: ${sponsor1} / 주관: ${sponsor2}`;
  return sponsor1 ?? sponsor2 ?? null;
}

function selectSoonest<T extends { startDate: string }>(
  items: T[],
  maxItems: number,
): Set<T> {
  return new Set(
    [...items]
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(0, maxItems),
  );
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]);
      }
    }),
  );
  return results;
}

async function fetchTourJson(url: URL, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    signal,
    headers: {
      "User-Agent": "Mozilla/5.0 ParkingLotNavigator/1.0",
      Accept: "application/json,text/plain,*/*",
    },
  });
  if (!response.ok) throw new Error(`TourAPI detail failed: ${response.status}`);
  const body = (await response.json()) as {
    response?: {
      header?: { resultCode?: string; resultMsg?: string };
    };
  };
  const code = body.response?.header?.resultCode;
  if (code && code !== "0000") {
    throw new Error(
      `TourAPI detail failed: ${body.response?.header?.resultMsg ?? code}`,
    );
  }
  return body;
}

function setBaseParams(url: URL, serviceKey: string): void {
  url.searchParams.set("serviceKey", serviceKey.trim());
  url.searchParams.set("MobileOS", "ETC");
  url.searchParams.set("MobileApp", "ParkingLotNavigator");
  url.searchParams.set("_type", "json");
}

function extractFirstItem<T>(body: unknown): T | null {
  return extractItems<T>(body)[0] ?? null;
}

function extractItems<T>(body: unknown): T[] {
  const response = body as {
    response?: {
      body?: {
        items?: { item?: T[] | T } | T[] | T;
      };
    };
  };
  const rawItems = response.response?.body?.items;
  if (Array.isArray(rawItems)) return rawItems;
  if (isObject(rawItems) && "item" in rawItems) {
    const rawItem = rawItems.item;
    return Array.isArray(rawItem) ? rawItem : rawItem ? [rawItem] : [];
  }
  return rawItems ? [rawItems as T] : [];
}

function bestImage(items: TourApiDetailImageItem[]): string | null {
  for (const item of items) {
    const image = clean(item.originimgurl) ?? clean(item.smallimageurl);
    if (image) return image;
  }
  return null;
}

function extractFirstUrl(value: unknown): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const href = /href\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1];
  if (href) return normalizeUrlToken(href);
  const text = cleanHtml(raw);
  if (!text) return null;
  for (const token of text.split(/\s+/)) {
    const url = normalizeUrlToken(token);
    if (url) return url;
  }
  return null;
}

// homepage often arrives as label text ("공식 홈페이지 www.foo.org"), several
// links across lines, or a scheme-less bare domain rather than a single
// clean URL. Scan tokens in order and normalize the first URL-shaped one —
// bare domains get https:// prepended so the image agent's `LIKE 'http%'`
// filter can still find them; label words without a dot never match and are
// skipped.
function normalizeUrlToken(token: string): string | null {
  const trimmed = token.replace(/^["'(<]+|["')>.,;]+$/g, "");
  if (!trimmed) return null;
  if (/^https?:\/\/\S+$/i.test(trimmed)) return trimmed;
  if (/^(?:[a-z0-9가-힣-]+\.)+[a-z]{2,}(?:\/\S*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

function cleanHtml(value: unknown): string | null {
  const text = clean(value);
  if (!text) return null;
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 && text !== "null" ? text : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
